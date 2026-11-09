param(
    [Parameter(Mandatory)][string]$WindowsRuntimeArchive,
    [Parameter(Mandatory)][string]$ExpectedSha256,
    [string]$ApacheRuntimeArchive,
    [string]$ApacheExpectedSha256,
    [int]$Port=8778
)

# Run in PowerShell 7. All installations and data belong to this isolated fixture.
$ErrorActionPreference='Stop'
$root=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$fixture=Join-Path $root ('.runtime/update test '+[guid]::NewGuid().ToString('N'))
$source=Join-Path $fixture 'source'
$office=Join-Path $fixture 'installation with spaces'
$release=Join-Path $fixture 'release'
New-Item -ItemType Directory -Path $source,$office,$release | Out-Null
$previousNodePath=$env:NODE_PATH
$env:NODE_PATH=Join-Path $root 'node_modules'
$private=Join-Path $fixture 'test-private.pem'
$public=Join-Path $fixture 'test-public.pem'
$signer=[Security.Cryptography.RSA]::Create(3072)
$base="http://127.0.0.1:$Port/api.php?r="
$started=$false

function Invoke-Office([string]$Route,$Payload) {
    Invoke-RestMethod -Uri ($base+$Route) -Method Post -WebSession $session -ContentType 'application/json' `
        -Headers @{'X-CSRF-Token'=$script:csrf} -Body ($Payload | ConvertTo-Json -Depth 5) -TimeoutSec 10
}

function Wait-Update([string]$Job) {
    $deadline=(Get-Date).AddMinutes(3)
    do {
        Start-Sleep -Milliseconds 500
        try { $progress=Invoke-RestMethod -Uri ($base+"update-progress&job=$Job") -TimeoutSec 2 }
        catch { continue }
        if ($progress.phase -in @('complete','failed','recovery')) { return $progress }
    } while ((Get-Date) -lt $deadline)
    $stateFile=Join-Path $office ".office-update/$Job/state"
    $lastPhase=if (Test-Path -LiteralPath $stateFile) { Get-Content -LiteralPath $stateFile }
    throw "Update did not report a final state (last phase: $lastPhase). See $office/.office-update/$Job/update.log."
}

function Assert-Workspace {
    $records=Invoke-RestMethod -Uri ($base+'records&kind=tasks') -WebSession $session
    if ($records.records[0].title -cne 'Keep this task') { throw 'The update lost a workspace record.' }
    if ((Get-Content -Raw -LiteralPath (Join-Path $office 'data/secret.key')) -cne 'fixture-secret') { throw 'The private key file was not preserved.' }
}

try {
    [IO.File]::WriteAllText($private,$signer.ExportPkcs8PrivateKeyPem())
    [IO.File]::WriteAllText($public,$signer.ExportSubjectPublicKeyInfoPem())
    foreach ($name in @('app','public','scripts','frontend','docs','runtime','package.json','tsconfig.json','LICENSE','README.md','.htaccess','Start Office.bat','Stop Office.bat','start-local.sh')) {
        if ($name -eq 'runtime') {
            $runtime=Join-Path $source 'runtime/windows'
            New-Item -ItemType Directory -Path $runtime | Out-Null
            foreach ($file in @('php.ini','README.md','cacert.pem')) {
                Copy-Item -LiteralPath (Join-Path $root "runtime/windows/$file") -Destination $runtime
            }
        } else { Copy-Item -LiteralPath (Join-Path $root $name) -Destination $source -Recurse }
    }
    [IO.File]::WriteAllText((Join-Path $source 'app/VERSION'),'0.1.1')
    $options=@{
        WindowsRuntimeArchive=(Resolve-Path -LiteralPath $WindowsRuntimeArchive).Path;ExpectedSha256=$ExpectedSha256
        ReleasePublicKeyFile=$public;SigningKeyFile=$private
    }
    if ($ApacheRuntimeArchive) {
        $options.ApacheRuntimeArchive=(Resolve-Path -LiteralPath $ApacheRuntimeArchive).Path
        $options.ApacheExpectedSha256=$ApacheExpectedSha256
    }
    & (Join-Path $source 'scripts/release.ps1') @options
    $built=Join-Path $source 'dist/release-v0.1.1'
    $zipName='portable-office-v0.1.1-windows.zip'
    Copy-Item -Path (Join-Path $built '*') -Destination $release
    Expand-Archive -LiteralPath (Join-Path $release $zipName) -DestinationPath $office
    $office=Join-Path $office 'office'
    [IO.File]::WriteAllText((Join-Path $office 'app/VERSION'),'0.1.0')

    # Substitute only the network transport in the fixture. Real manifest
    # signature verification, archive hashing, and process restart still run.
    $transport=@'
    $name=basename($url);
    $fixture=dirname(__DIR__,3).'/release/'.$name;
    if (!is_file($fixture)) return 404;
    $body=file_get_contents($fixture);
    if (strlen($body)>$limit || $write($body)!==strlen($body)) throw new RuntimeException('Fixture download failed.');
    return 200;
'@
    $transportFile=Join-Path $office 'app/updates.php'
    $original=[IO.File]::ReadAllText($transportFile)
    $declaration='function office_update_fetch(string $url, callable $write, int $limit, int $seconds): int {'
    [IO.File]::WriteAllText($transportFile,$original.Replace($declaration,$declaration+"`n"+$transport+"`n"))

    & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $office 'scripts/start-windows.ps1') -NoBrowser -Port $Port
    if ($LASTEXITCODE -ne 0) { throw 'Could not start the test installation.' }
    $started=$true
    $status=Invoke-RestMethod -Uri ($base+'status') -SessionVariable session
    $script:csrf=$status.csrf
    $password='fixture-office-password'
    $token=(Get-Content -Raw -LiteralPath (Join-Path $office 'data/setup-token.txt')).Trim()
    $auth=Invoke-Office 'setup' @{token=$token;password=$password}
    $script:csrf=$auth.csrf
    Invoke-Office 'save' @{kind='tasks';title='Keep this task';body='';meta=@{}} | Out-Null
    [IO.File]::WriteAllText((Join-Path $office 'data/secret.key'),'fixture-secret')
    $check=Invoke-RestMethod -Uri ($base+'update-check') -WebSession $session
    if (!$check.canInstall -or $check.latest -cne '0.1.1') { throw 'A valid signed update was not offered.' }

    $manifest=Join-Path $release 'office-update.json'
    $signed=[IO.File]::ReadAllText($manifest)
    $badSignature=$signed | ConvertFrom-Json
    $badSignature.signature=[Convert]::ToBase64String([byte[]]::new(384))
    [IO.File]::WriteAllText($manifest,($badSignature | ConvertTo-Json -Compress))
    $check=Invoke-WebRequest -Uri ($base+'update-check') -WebSession $session -SkipHttpErrorCheck
    if ($check.StatusCode -ne 503 -or $check.Content -notmatch 'signature') { throw 'The update check accepted a bad signature.' }
    [IO.File]::WriteAllText($manifest,$signed)

    $zip=Join-Path $release $zipName
    $stream=[IO.File]::Open($zip,'Open','ReadWrite')
    try {
        $first=$stream.ReadByte()
        $stream.Position=0
        $stream.WriteByte($first -bxor 1)
    } finally { $stream.Dispose() }
    $rejected=Invoke-Office 'update-install' @{version='0.1.1'}
    if ((Wait-Update $rejected.job).phase -ne 'failed') { throw 'The updater accepted a ZIP with the wrong hash.' }
    Assert-Workspace
    Copy-Item -LiteralPath (Join-Path $built $zipName) -Destination $zip -Force

    # A validly signed package fails the health check after altering the DB.
    # The updater must restore both the previous code and the original data.
    $archive=[IO.Compression.ZipFile]::Open($zip,[IO.Compression.ZipArchiveMode]::Update)
    try {
        $entry=$archive.GetEntry('office/public/api.php')
        $entry.Delete()
        $entry=$archive.CreateEntry('office/public/api.php')
        $writer=[IO.StreamWriter]::new($entry.Open())
        try {
            $writer.Write('<?php require dirname(__DIR__)."/app/bootstrap.php"; if(isset($_SERVER["HTTP_X_OFFICE_UPDATE_HEALTH"])){db()->exec("DELETE FROM records");} http_response_code(500);')
        } finally { $writer.Dispose() }
    } finally { $archive.Dispose() }
    $envelope=$signed | ConvertFrom-Json
    $payload=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($envelope.payload)) | ConvertFrom-Json
    $payload.assets.windows.sha256=(Get-FileHash -LiteralPath $zip).Hash.ToLowerInvariant()
    $payload.assets.windows.size=(Get-Item -LiteralPath $zip).Length
    $bytes=[Text.Encoding]::UTF8.GetBytes(($payload | ConvertTo-Json -Depth 5 -Compress))
    $envelope.payload=[Convert]::ToBase64String($bytes)
    $envelope.signature=[Convert]::ToBase64String($signer.SignData($bytes,[Security.Cryptography.HashAlgorithmName]::SHA256,[Security.Cryptography.RSASignaturePadding]::Pkcs1))
    [IO.File]::WriteAllText($manifest,($envelope | ConvertTo-Json -Compress))
    $broken=Invoke-Office 'update-install' @{version='0.1.1'}
    $rolledBack=Wait-Update $broken.job
    if ($rolledBack.phase -ne 'failed' -or $rolledBack.installed -cne '0.1.0') { throw 'The failed startup did not roll back.' }
    Assert-Workspace

    Copy-Item -LiteralPath (Join-Path $built $zipName) -Destination $zip -Force
    [IO.File]::WriteAllText($manifest,$signed)
    $queued=Invoke-Office 'update-install' @{version='0.1.1'}
    $installed=Wait-Update $queued.job
    if ($installed.phase -ne 'complete' -or $installed.installed -cne '0.1.1') { throw 'The valid signed update did not install.' }
    Assert-Workspace
    if (!(Test-Path -LiteralPath (Join-Path $office ".office-update/$($queued.job)/data-before-update/office.sqlite"))) {
        throw 'The successful update did not leave a recovery snapshot.'
    }
    Write-Output "PASS signed update, tampered manifest and ZIP, failed startup rollback, and preserved workspace on port $Port."
} finally {
    if ($started -and (Test-Path -LiteralPath (Join-Path $office 'scripts/stop-windows.ps1'))) {
        & powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File (Join-Path $office 'scripts/stop-windows.ps1')
    }
    $env:NODE_PATH=$previousNodePath
    $signer.Dispose()
    if ([IO.File]::Exists($private)) { [IO.File]::Delete($private) }
}
