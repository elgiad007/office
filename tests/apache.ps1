$ErrorActionPreference='Stop'
$officeRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$officeTestData=Join-Path $officeRoot ('.runtime\apache smoke '+[Guid]::NewGuid().ToString('N'))
$officeTestPublic=Join-Path $officeTestData 'public'
New-Item -ItemType Directory -Path $officeTestPublic -Force|Out-Null
$officeProbe=@'
<?php
header('Content-Type: application/json');
if(isset($_GET['slow'])){file_put_contents(getenv('OFFICE_DATA_DIR').'/slow-started','1');usleep(2500000);}
echo json_encode(['csrf'=>'probe','pid'=>getmypid()]);
'@
Set-Content -LiteralPath (Join-Path $officeTestPublic 'api.php') -Value $officeProbe -Encoding ASCII
Set-Content -LiteralPath (Join-Path $officeTestData 'private.txt') -Value 'private test marker' -Encoding ASCII
$officeReservation=New-Object Net.Sockets.TcpListener([Net.IPAddress]::Loopback,0)
$officeReservation.Start();$officePort=([Net.IPEndPoint]$officeReservation.LocalEndpoint).Port;$officeReservation.Stop()
$officeClient=New-Object Net.Http.HttpClient
$officeClient.Timeout=[TimeSpan]::FromSeconds(10)
try{
    & (Join-Path $officeRoot 'scripts/start-apache.ps1') -Port $officePort -NoBrowser -DataDirectory $officeTestData -PublicDirectory $officeTestPublic
    $officeState=Get-Content -Raw -LiteralPath (Join-Path $officeTestData 'local-server.json')|ConvertFrom-Json
    & (Join-Path $officeRoot 'scripts/start-apache.ps1') -Port $officePort -NoBrowser -DataDirectory $officeTestData -PublicDirectory $officeTestPublic
    if((Get-Content -Raw -LiteralPath (Join-Path $officeTestData 'local-server.json')|ConvertFrom-Json).pid -ne $officeState.pid){throw 'Repeated start did not reuse the server.'}
    $officeSlow=$officeClient.GetStringAsync("http://127.0.0.1:$officePort/api.php?slow=1")
    $officeWait=[Diagnostics.Stopwatch]::StartNew()
    while(!(Test-Path -LiteralPath (Join-Path $officeTestData 'slow-started'))){if($officeWait.ElapsedMilliseconds -gt 3000){throw 'Slow request did not start.'};Start-Sleep -Milliseconds 25}
    $officeWatch=[Diagnostics.Stopwatch]::StartNew()
    $officeFast=$officeClient.GetStringAsync("http://127.0.0.1:$officePort/api.php?r=status").GetAwaiter().GetResult()
    $officeWatch.Stop()
    if($officeSlow.IsCompleted -or $officeWatch.ElapsedMilliseconds -gt 1200){throw 'A slow PHP request blocked another PHP worker.'}
    Write-Host "PASS PHP request during a 2.5-second operation completed in $($officeWatch.ElapsedMilliseconds) ms."
    $officeSlow.GetAwaiter().GetResult()|Out-Null
    $officeDenied=$officeClient.GetAsync("http://127.0.0.1:$officePort/private.txt").GetAwaiter().GetResult()
    if([int]$officeDenied.StatusCode -ne 404){throw 'A file outside the public directory was exposed.'}
    & (Join-Path $officeRoot 'scripts/stop-windows.ps1') -DataDirectory $officeTestData
    foreach($officeIdentity in $officeState.processes){if(Get-Process -Id $officeIdentity.pid -ErrorAction SilentlyContinue){throw 'A server process remained after shutdown.'}}
    Write-Host 'PASS portable Apache: concurrent PHP, paths with spaces, repeated start, private files, owned-process shutdown.'
}finally{
    $officeClient.Dispose()
    if(Test-Path -LiteralPath (Join-Path $officeTestData 'local-server.json')){& (Join-Path $officeRoot 'scripts/stop-windows.ps1') -DataDirectory $officeTestData}
}
