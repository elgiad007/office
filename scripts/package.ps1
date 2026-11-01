param([string]$WindowsRuntimeArchive, [string]$ExpectedSha256,[string]$ApacheRuntimeArchive,[string]$ApacheExpectedSha256)
$ErrorActionPreference='Stop'
$officeRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
& node (Join-Path $PSScriptRoot 'frontend.mjs') --check
if($LASTEXITCODE -ne 0){throw 'Frontend checks failed. Install development dependencies with pnpm install, then run pnpm build.'}
$officeDist=Join-Path $officeRoot 'dist'
$officeBuild=Join-Path $officeDist ('build-'+[Guid]::NewGuid().ToString('N'))
$officePackage=Join-Path $officeBuild 'office'
New-Item -ItemType Directory -Path $officePackage -Force | Out-Null
foreach($officeFile in @('LICENSE','README.md','.htaccess','Start Office.bat','Stop Office.bat','start-local.sh','app','public','docs','scripts')) {
    Copy-Item -LiteralPath (Join-Path $officeRoot $officeFile) -Destination $officePackage -Recurse
}
New-Item -ItemType Directory -Path (Join-Path $officePackage 'runtime\windows') -Force | Out-Null
foreach($officeRuntimeFile in @('php.ini','README.md','cacert.pem')) {
    Copy-Item -LiteralPath (Join-Path $officeRoot ('runtime\windows\'+$officeRuntimeFile)) -Destination (Join-Path $officePackage 'runtime\windows')
}
New-Item -ItemType Directory -Path (Join-Path $officePackage 'data') -Force | Out-Null
$officeZipName='portable-office-hosting.zip'
if ($WindowsRuntimeArchive) {
    if (-not $ExpectedSha256 -or (Get-FileHash -LiteralPath $WindowsRuntimeArchive -Algorithm SHA256).Hash -ne $ExpectedSha256) { throw 'A matching official SHA-256 is required for the Windows runtime archive.' }
    Expand-Archive -LiteralPath $WindowsRuntimeArchive -DestinationPath (Join-Path $officePackage 'runtime\windows') -Force
    $officeZipName='portable-office-windows.zip'
}
if($ApacheRuntimeArchive){
    if(!$WindowsRuntimeArchive){throw 'Apache packaging requires the Windows PHP runtime too.'}
    if(!$ApacheExpectedSha256 -or (Get-FileHash -LiteralPath $ApacheRuntimeArchive -Algorithm SHA256).Hash -ne $ApacheExpectedSha256){throw 'A matching publisher SHA-256 is required for the Apache archive.'}
    Expand-Archive -LiteralPath $ApacheRuntimeArchive -DestinationPath (Join-Path $officePackage 'runtime\apache') -Force
}
Compress-Archive -LiteralPath $officePackage -DestinationPath (Join-Path $officeDist $officeZipName) -Force
Write-Host (Join-Path $officeDist $officeZipName)
# Keep the clean extracted build for inspection. No user data or credentials are copied.
