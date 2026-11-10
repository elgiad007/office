[CmdletBinding()]
param(
    [string]$WindowsRuntimeArchive,
    [string]$ExpectedSha256,
    [string]$ApacheRuntimeArchive,
    [string]$ApacheExpectedSha256,
    [string]$ReleasePublicKeyFile,
    [string]$SigningKeyFile
)

$ErrorActionPreference = 'Stop'
$officeRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if (!$WindowsRuntimeArchive) {
    $WindowsRuntimeArchive = Join-Path $officeRoot '.runtime/php.zip'
    if (!$PSBoundParameters.ContainsKey('ExpectedSha256')) {
        $checksumFile = Join-Path $officeRoot '.runtime/.env'
        if (Test-Path -LiteralPath $checksumFile -PathType Leaf) {
            $checksumEntry = Select-String -LiteralPath $checksumFile -Pattern '^\s*OFFICE_PHP_SHA256\s*=\s*(.*?)\s*$' | Select-Object -Last 1
            if ($checksumEntry) {
                $ExpectedSha256 = $checksumEntry.Matches[0].Groups[1].Value
                if ($ExpectedSha256 -notmatch '^[0-9a-fA-F]{64}$') {
                    throw 'Set OFFICE_PHP_SHA256 in .runtime/.env to the 64-character SHA-256 published for .runtime/php.zip.'
                }
            }
        }
        if (!$ExpectedSha256) {
            $ExpectedSha256 = Read-Host 'Enter the published SHA-256 for .runtime/php.zip'
        }
    }
}
if ($ExpectedSha256 -notmatch '^[0-9a-fA-F]{64}$') {
    throw 'Supply the published 64-character SHA-256 for the Windows PHP archive with -ExpectedSha256.'
}
if ([bool]$ApacheRuntimeArchive -ne [bool]$ApacheExpectedSha256) {
    throw 'Supply both the Apache archive and its publisher SHA-256 to include Apache.'
}
if ([bool]$ReleasePublicKeyFile -ne [bool]$SigningKeyFile) { throw 'Supply both release signing key files, or omit both for a manual release.' }
if ($SigningKeyFile -and $PSVersionTable.PSVersion.Major -lt 7) { throw 'Signed release builds require PowerShell 7.' }

$version = (Get-Content -LiteralPath (Join-Path $officeRoot 'app/VERSION') -Raw).Trim()
if ($version -cnotmatch '\A(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\.(0|[1-9][0-9]{0,8})\z') {
    throw 'Set app/VERSION to a major.minor.patch version, such as 0.1.0.'
}
$tag = "v$version"
$dist = Join-Path $officeRoot 'dist'
$release = Join-Path $dist "release-$tag"
New-Item -ItemType Directory -Path $dist -Force | Out-Null
$lockPath = Join-Path $dist ".release-$tag.lock"
try {
    $releaseLock = [IO.File]::Open($lockPath, 'OpenOrCreate', 'ReadWrite', 'None')
} catch [IO.IOException] {
    throw "Could not lock the release folder for $tag. Check whether another build is running. $($_.Exception.Message)"
}

$buildId = [Guid]::NewGuid().ToString('N')
$staging = Join-Path $dist ".release-$buildId"
$backup = Join-Path $dist ".previous-release-$tag-$buildId"
try {
    $existing = Get-Item -LiteralPath $release -Force -ErrorAction SilentlyContinue
    if ($existing) {
        if (!$existing.PSIsContainer -or ($existing.Attributes -band [IO.FileAttributes]::ReparsePoint)) {
            throw "Release output path is not a regular directory: $release"
        }
        $answer = Read-Host "Release $tag already exists. Overwrite it? [y/N]"
        if ($answer -notmatch '^\s*y(es)?\s*$') {
            Write-Host "Build canceled. Existing release kept at $release"
            return
        }
    }

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
        ReleasePublicKeyFile = $ReleasePublicKeyFile
    }

    & $packager @windowsOptions
    & $packager -DestinationPath (Join-Path $staging $hostingZip) -ReleasePublicKeyFile $ReleasePublicKeyFile

    $assets=@{}
    $checksums = foreach ($platform in @('hosting','windows')) {
        $name="portable-office-$tag-$platform.zip"
        $file=Get-Item -LiteralPath (Join-Path $staging $name)
        $hash=(Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        $assets[$platform]=@{sha256=$hash;size=$file.Length}
        "$hash  $name"
    }
    $checksums | Set-Content -LiteralPath (Join-Path $staging 'SHA256SUMS.txt') -Encoding Ascii
    if ($SigningKeyFile) {
        $payload=[Text.Encoding]::UTF8.GetBytes((@{format=1;version=$version;assets=$assets} | ConvertTo-Json -Depth 5 -Compress))
        $signer=[Security.Cryptography.RSA]::Create()
        $verifier=[Security.Cryptography.RSA]::Create()
        try {
            $signer.ImportFromPem((Get-Content -Raw -LiteralPath $SigningKeyFile))
            $verifier.ImportFromPem((Get-Content -Raw -LiteralPath $ReleasePublicKeyFile))
            $algorithm=[Security.Cryptography.HashAlgorithmName]::SHA256
            $padding=[Security.Cryptography.RSASignaturePadding]::Pkcs1
            $signature=$signer.SignData($payload,$algorithm,$padding)
            if ($signer.KeySize -lt 3072 -or !$verifier.VerifyData($payload,$signature,$algorithm,$padding)) {
                throw 'Use a matching RSA signing key pair of at least 3072 bits.'
            }
            @{payload=[Convert]::ToBase64String($payload);signature=[Convert]::ToBase64String($signature)} |
                ConvertTo-Json -Compress | Set-Content -LiteralPath (Join-Path $staging 'office-update.json') -Encoding Ascii
        } finally {
            $signer.Dispose()
            $verifier.Dispose()
        }
    }
    if ($existing) { [IO.Directory]::Move($release, $backup) }
    try {
        [IO.Directory]::Move($staging, $release)
    } catch {
        if ($existing) {
            try { [IO.Directory]::Move($backup, $release) }
            catch { throw "Could not restore the previous release automatically. It is saved at $backup. $($_.Exception.Message)" }
        }
        throw
    }
    if ($existing) { Remove-Item -LiteralPath $backup -Recurse -Force -ErrorAction Continue }

    Write-Host "Suggested GitHub tag: $tag"
    Write-Host "Upload the ZIPs, SHA256SUMS.txt, and office-update.json (if signed) from $release"
} finally {
    try {
        if (Test-Path -LiteralPath $staging -PathType Container) {
            Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction Continue
        }
    } finally { $releaseLock.Dispose() }
}
