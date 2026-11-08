[CmdletBinding()]
param(
    [string]$WindowsRuntimeArchive,
    [Parameter(Mandatory)][ValidatePattern('^[0-9a-fA-F]{64}$')][string]$ExpectedSha256,
    [string]$ApacheRuntimeArchive,
    [string]$ApacheExpectedSha256
)

$ErrorActionPreference = 'Stop'
$officeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (!$WindowsRuntimeArchive) { $WindowsRuntimeArchive = Join-Path $officeRoot '.runtime/php.zip' }
if ([bool]$ApacheRuntimeArchive -ne [bool]$ApacheExpectedSha256) {
    throw 'Supply both the Apache archive and its publisher SHA-256 to include Apache.'
}

$version = (Get-Content -LiteralPath (Join-Path $officeRoot 'app/VERSION') -Raw).Trim()
if ($version -cnotmatch '\A(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\z') {
    throw 'Set app/VERSION to a major.minor.patch version, such as 0.1.0.'
}
$tag = "v$version"
$dist = Join-Path $officeRoot 'dist'
$release = Join-Path $dist "release-$tag"
if (Test-Path -LiteralPath $release) { throw "Release output already exists at $release. Move it before rebuilding $tag." }

$staging = Join-Path $dist ('.release-' + [Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $staging -Force | Out-Null
$windowsZip = "portable-office-$tag-windows.zip"
$hostingZip = "portable-office-$tag-hosting.zip"
$packager = Join-Path $PSScriptRoot 'package.ps1'
$windowsOptions = @{
    WindowsRuntimeArchive = $WindowsRuntimeArchive
    ExpectedSha256 = $ExpectedSha256
    ApacheRuntimeArchive = $ApacheRuntimeArchive
    ApacheExpectedSha256 = $ApacheExpectedSha256
    DestinationPath = Join-Path $staging $windowsZip
}

& $packager @windowsOptions
& $packager -DestinationPath (Join-Path $staging $hostingZip)

$checksums = foreach ($asset in @($hostingZip, $windowsZip)) {
    $hash = (Get-FileHash -LiteralPath (Join-Path $staging $asset) -Algorithm SHA256).Hash.ToLowerInvariant()
    "$hash  $asset"
}
$checksums | Set-Content -LiteralPath (Join-Path $staging 'SHA256SUMS.txt') -Encoding Ascii
[IO.Directory]::Move($staging, $release)

Write-Host "Suggested GitHub tag: $tag"
Write-Host "Upload the ZIPs and SHA256SUMS.txt from $release"
