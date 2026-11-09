[CmdletBinding()]
param(
    [Parameter(Mandatory)][ValidatePattern('^[a-f0-9]{32}$')][string]$Job,
    [ValidatePattern('^(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})$')][string]$Version,
    [ValidateRange(1024,65535)][int]$Port=8765,
    [switch]$Launch,
    [switch]$Recover
)

$ErrorActionPreference='Stop'
$root=if ($Recover) { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../..')) }
      else { [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..')) }
$powershell=Join-Path $PSHOME 'powershell.exe'
if ($Launch) {
    # A separate hidden console lets the web request finish before shutdown.
    Start-Process -FilePath $powershell -WorkingDirectory $root -WindowStyle Hidden -ArgumentList @(
        '-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File','scripts/update-windows.ps1',
        '-Job',$Job,'-Version',$Version,'-Port',$Port
    )
    exit
}

$updates=Join-Path $root '.office-update'
$pending=Join-Path $updates 'pending'
$maintenance=Join-Path $updates 'maintenance'
$jobDir=Join-Path $updates $Job
$state=Join-Path $jobDir 'state'
$data=Join-Path $root 'data'
$serverState=Join-Path $data 'local-server.json'
$snapshot=Join-Path $jobDir 'data-before-update'
$staged=Join-Path $jobDir 'stage/office'
$previous=Join-Path $jobDir 'previous'
$failed=Join-Path $jobDir 'failed'
$plan=Join-Path $jobDir 'plan.json'
$log=Join-Path $jobDir 'update.log'
$archive=Join-Path $jobDir 'package.zip'
$managed=@('app','public','scripts','docs','runtime/windows','LICENSE','README.md','.htaccess','Start Office.bat','Stop Office.bat','start-local.sh')

function Set-Phase([string]$Phase) {
    $temp=$state+'.tmp'
    [IO.File]::WriteAllText($temp,$Phase)
    if ([IO.File]::Exists($state)) { [IO.File]::Replace($temp,$state,[NullString]::Value) }
    else { [IO.File]::Move($temp,$state) }
}

function Invoke-OfficeScript([string]$Name,[string[]]$Options=@()) {
    & $powershell -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $root "scripts/$Name.ps1") @Options
    if ($LASTEXITCODE -ne 0) { throw "Office $Name failed." }
}

function Stop-OfficeWorkers {
    if (!(Test-Path -LiteralPath $serverState)) { return }
    $running=Get-Content -Raw -LiteralPath $serverState | ConvertFrom-Json
    if ($running.port -ne $Port) { throw 'Office is running on a different port.' }
    $ids=if ($running.type -eq 'apache') { @($running.processes.pid) } else { @($running.pid) }
    $workers=@(Get-Process -Id $ids -ErrorAction SilentlyContinue)
    Invoke-OfficeScript 'stop-windows'
    foreach ($worker in $workers) {
        if (!$worker.WaitForExit(10000)) { throw 'An Office worker did not exit.' }
    }
}

function Start-OfficeWorkers {
    $options=@('-NoBrowser','-Port',[string]$Port)
    if ($restart.developmentServer) { $options+='-DevelopmentServer' }
    Invoke-OfficeScript 'start-windows' $options
    $health=Invoke-RestMethod -Uri "http://127.0.0.1:$Port/api.php?r=status" -TimeoutSec 5 `
        -Headers @{'X-Office-Update-Health'=$Job}
    if ($health.setup -ne $false) { throw 'Office started without the existing workspace.' }
}

function Move-OfficeComponent([string]$Source,[string]$Destination) {
    [IO.Directory]::CreateDirectory([IO.Path]::GetDirectoryName($Destination)) | Out-Null
    if ([IO.Directory]::Exists($Source)) { [IO.Directory]::Move($Source,$Destination) }
    else { [IO.File]::Move($Source,$Destination) }
}

function Restore-Office {
    $script:restart=Get-Content -Raw -LiteralPath $plan | ConvertFrom-Json
    $script:Port=[int]$restart.port
    $env:OFFICE_UPDATE_HEALTH=$Job
    if (Test-Path -LiteralPath $serverState) {
        # If the old server never stopped, there is nothing to restore.
        if (!(Test-Path -LiteralPath $previous) -and !(Test-Path -LiteralPath $snapshot)) { return }
        Stop-OfficeWorkers
    }
    foreach ($item in $restart.components) {
        $target=Join-Path $root $item.path
        $old=Join-Path $previous $item.path
        $movedNew=Join-Path $failed $item.path
        if (Test-Path -LiteralPath $old) {
            if (Test-Path -LiteralPath $target) { Move-OfficeComponent $target $movedNew }
            Move-OfficeComponent $old $target
        } elseif (!$item.existed -and (Test-Path -LiteralPath $target)) {
            Move-OfficeComponent $target $movedNew
        }
    }
    if (Test-Path -LiteralPath (Join-Path $jobDir 'snapshot-ready')) {
        if (Test-Path -LiteralPath $snapshot) {
            if (Test-Path -LiteralPath $data) { Move-OfficeComponent $data (Join-Path $failed 'data') }
            Move-OfficeComponent $snapshot $data
        }
    }
    Start-OfficeWorkers
}

function Clear-UpdateMarkers {
    foreach ($marker in @($maintenance,$pending)) {
        if ([IO.File]::Exists($marker) -and [IO.File]::ReadAllText($marker) -ceq $Job) { [IO.File]::Delete($marker) }
    }
}

if (![IO.File]::Exists($pending) -or [IO.File]::ReadAllText($pending) -cne $Job) { throw 'The requested Office update is no longer pending.' }
[IO.Directory]::CreateDirectory($jobDir) | Out-Null
$guard=[IO.File]::Open((Join-Path $jobDir 'worker.lock'),'OpenOrCreate','ReadWrite','None')
$transcript=$false
try {
    Start-Transcript -LiteralPath $log -Append | Out-Null
    $transcript=$true
    if ($Recover) {
        if ([IO.File]::Exists($state) -and [IO.File]::ReadAllText($state) -in @('complete','failed')) {
            Clear-UpdateMarkers
            return
        }
        if (Test-Path -LiteralPath $maintenance) { Restore-Office }
        Set-Phase 'failed'
        Clear-UpdateMarkers
        return
    }
    Set-Phase 'downloading'
    $php=Join-Path $root 'runtime/windows/php.exe'
    $ca=Join-Path $root 'runtime/windows/cacert.pem'
    $packageScript=Join-Path $root 'scripts/update-package.php'
    $phpOptions=@('-c',(Join-Path $root 'runtime/windows/php.ini'),'-d',('extension_dir='+(Join-Path $root 'runtime/windows/ext')),'-d',"curl.cainfo=$ca")
    $env:OFFICE_DATA_DIR=$data
    & $php @phpOptions $packageScript download $Version $Job
    if ($LASTEXITCODE -ne 0) { throw 'Could not download and verify the signed release.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    [IO.Compression.ZipFile]::ExtractToDirectory($archive,(Join-Path $jobDir 'stage'))
    if ((Get-Content -Raw -LiteralPath (Join-Path $staged 'app/VERSION')).Trim() -cne $Version -or
        !(Test-Path -LiteralPath (Join-Path $staged 'app/windows-release')) -or
        !(Test-Path -LiteralPath (Join-Path $staged 'runtime/windows/php.exe')) -or
        (Get-FileHash -LiteralPath (Join-Path $staged 'app/release-key.pem')).Hash -cne (Get-FileHash -LiteralPath (Join-Path $root 'app/release-key.pem')).Hash) {
        throw 'The staged ZIP is not a compatible signed Windows release.'
    }
    if (Test-Path -LiteralPath (Join-Path $staged 'runtime/apache')) { $managed+='runtime/apache' }
    $components=foreach ($path in $managed) {
        if (!(Test-Path -LiteralPath (Join-Path $staged $path))) { throw "Missing release component: $path" }
        @{path=$path;existed=(Test-Path -LiteralPath (Join-Path $root $path))}
    }
    $running=Get-Content -Raw -LiteralPath $serverState | ConvertFrom-Json
    if ($running.port -ne $Port) { throw 'Office is running on a different port.' }
    if ((Get-Item -LiteralPath $data -Force).Attributes -band [IO.FileAttributes]::ReparsePoint) {
        throw 'Automatic updates require a regular data directory inside the Office folder.'
    }
    $restart=@{port=$Port;developmentServer=($running.type -ne 'apache');components=@($components)}
    $restart | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath $plan -Encoding UTF8
    Set-Phase 'waiting'
    [IO.File]::WriteAllText($maintenance,$Job)
    & $php @phpOptions $packageScript drain
    if ($LASTEXITCODE -ne 0) { throw 'Active Office requests did not finish in time.' }
    Stop-OfficeWorkers
    Set-Phase 'installing'
    $copyMode='/COPY:DAT'
    if ((New-Object IO.DriveInfo([IO.Path]::GetPathRoot($data))).DriveFormat -eq 'NTFS') {
        [IO.Directory]::CreateDirectory($snapshot) | Out-Null
        Set-Acl -LiteralPath $snapshot -AclObject (Get-Acl -LiteralPath $data)
        $copyMode='/COPY:DATS'
    }
    & robocopy.exe $data $snapshot /E $copyMode /DCOPY:DAT /XJ /SL /R:0 /W:0
    if ($LASTEXITCODE -ge 8) { throw 'Could not create the private recovery snapshot.' }
    [IO.File]::WriteAllText((Join-Path $jobDir 'snapshot-ready'),'1')
    foreach ($item in $components) {
        $target=Join-Path $root $item.path
        if ($item.existed) { Move-OfficeComponent $target (Join-Path $previous $item.path) }
        Move-OfficeComponent (Join-Path $staged $item.path) $target
    }
    $env:OFFICE_UPDATE_HEALTH=$Job
    Start-OfficeWorkers
    Set-Phase 'complete'
    Clear-UpdateMarkers
} catch {
    Write-Host $_
    if ($Recover) {
        Set-Phase 'recovery'
        throw
    }
    try {
        if (Test-Path -LiteralPath $maintenance) { Restore-Office }
        Set-Phase 'failed'
        Clear-UpdateMarkers
    } catch {
        Write-Host $_
        Set-Phase 'recovery'
        throw
    }
    exit 1
} finally {
    if ($transcript) { Stop-Transcript | Out-Null }
    $guard.Dispose()
    if ([IO.File]::Exists($archive)) { [IO.File]::Delete($archive) }
}
