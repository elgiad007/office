param([string]$PhpBinary='php',[string]$PhpExtensionDir,[string]$NodeModuleManifest,[string]$BrowserChannel,[int]$Port=8787)
$ErrorActionPreference='Stop'
$officeRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$officeTestData=Join-Path $officeRoot ('.runtime\browser-'+[Guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $officeTestData -Force | Out-Null
$officeArgs=@()
if($PhpExtensionDir){ $officeArgs+=@('-d',('extension_dir="'+[IO.Path]::GetFullPath($PhpExtensionDir)+'"'),'-d','extension=pdo_sqlite','-d','extension=openssl','-d','extension=curl') }
$officeArgs+=@('-S',"127.0.0.1:$Port",'-t',('"'+(Join-Path $officeRoot 'public')+'"'))
$env:OFFICE_DATA_DIR=$officeTestData
$env:OFFICE_TEST_DATA=$officeTestData
$env:OFFICE_TEST_URL="http://127.0.0.1:$Port/"
if($NodeModuleManifest){$env:OFFICE_NODE_MODULES=$NodeModuleManifest}
if($BrowserChannel){$env:OFFICE_BROWSER_CHANNEL=$BrowserChannel}
$officeServer=Start-Process -FilePath $PhpBinary -ArgumentList $officeArgs -WorkingDirectory $officeRoot -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $officeTestData 'out.log') -RedirectStandardError (Join-Path $officeTestData 'server.log')
try {
    for($officeAttempt=0;$officeAttempt -lt 30;$officeAttempt++){
        if($officeServer.HasExited){throw 'Test server exited before becoming ready.'}
        try{$officeStatus=Invoke-RestMethod -Uri ($env:OFFICE_TEST_URL+'api.php?r=status') -TimeoutSec 1;if($officeStatus.setup){break}}catch{Start-Sleep -Milliseconds 150}
    }
    & node (Join-Path $PSScriptRoot 'browser.mjs')
    if($LASTEXITCODE -ne 0){throw 'Browser checks failed. Screenshots are in test-results/.'}
} finally { if(-not $officeServer.HasExited){$officeServer.Kill();$officeServer.WaitForExit()};Remove-Item Env:OFFICE_DATA_DIR -ErrorAction SilentlyContinue }
