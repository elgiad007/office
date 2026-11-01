# Apache's Windows distribution is supplied by Apache Lounge. Versions and
# checksums are pinned together; binaries stay out of Git.
$ErrorActionPreference='Stop'
$officeRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$officeArchive=Join-Path $officeRoot '.runtime\apache.zip'
New-Item -ItemType Directory -Path (Split-Path $officeArchive) -Force | Out-Null
& curl.exe --fail --proto '=https' --output $officeArchive 'https://www.apachelounge.com/download/VS18/binaries/httpd-2.4.69-261002-Win64-VS18.zip'
if($LASTEXITCODE -ne 0){throw 'Apache download failed.'}
# https://www.apachelounge.com/download/VS18/binaries/httpd-2.4.69-261002-Win64-VS18.zip.txt
if((Get-FileHash -LiteralPath $officeArchive -Algorithm SHA256).Hash -ne '77D715D0D9CEE731E2251E7DDC2090A7A8E6D41FEDEF2E9827CD918593C5A652'){throw 'Apache checksum mismatch; nothing was extracted.'}
if(Test-Path -LiteralPath (Join-Path $officeRoot 'data\local-server.json')){throw 'Stop Office before installing or replacing Apache.'}
Expand-Archive -LiteralPath $officeArchive -DestinationPath (Join-Path $officeRoot 'runtime\apache') -Force
Write-Host 'Portable Apache installed. Start Office.bat now uses Apache with four PHP workers.'
