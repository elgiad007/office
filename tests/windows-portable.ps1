param([int]$Port=8775,[switch]$CleanupOnly)
$ErrorActionPreference='Stop'
$officeRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
if($CleanupOnly){
    foreach($officeTestDirectory in Get-ChildItem -LiteralPath (Join-Path $officeRoot '.runtime') -Directory -Filter 'portable smoke test *'){
        foreach($officeTestCopy in @('office','copied office')){
            $officeCleanupApp=Join-Path $officeTestDirectory.FullName $officeTestCopy
            if(Test-Path -LiteralPath (Join-Path $officeCleanupApp 'data\local-server.json')){ & (Join-Path $officeCleanupApp 'Stop Office.bat') }
        }
    }
    exit 0
}
$officeSmoke=Join-Path $officeRoot ('.runtime\portable smoke test '+[Guid]::NewGuid().ToString('N'))
Expand-Archive -LiteralPath (Join-Path $officeRoot 'dist\portable-office-windows.zip') -DestinationPath $officeSmoke
$officeExtracted=Join-Path $officeSmoke 'office'
$officeUrl="http://127.0.0.1:$Port/api.php?r="
$officeStarted=$false
try {
    $officeStartOutput = & (Join-Path $officeExtracted 'Start Office.bat') -NoBrowser -Port $Port
    if($LASTEXITCODE -ne 0){throw ($officeStartOutput -join "`n")}
    $officeStarted=$true
    $officeStatus=Invoke-RestMethod -Uri ($officeUrl+'status') -SessionVariable officeWebSession
    if(-not $officeStatus.setup){throw 'Windows release unexpectedly contains an initialized database.'}
    $officeToken=(Get-Content -Raw -LiteralPath (Join-Path $officeExtracted 'data\setup-token.txt')).Trim()
    $officeAuth=Invoke-RestMethod -Method Post -Uri ($officeUrl+'setup') -WebSession $officeWebSession -ContentType 'application/json' -Headers @{'X-CSRF-Token'=$officeStatus.csrf} -Body (@{token=$officeToken;password='portable-smoke-test-password'} | ConvertTo-Json)
    $officeRecord=Invoke-RestMethod -Method Post -Uri ($officeUrl+'save') -WebSession $officeWebSession -ContentType 'application/json' -Headers @{'X-CSRF-Token'=$officeAuth.csrf} -Body (@{kind='tasks';title='Portable path test';body='A folder with spaces works.';meta=@{}} | ConvertTo-Json)
    if($officeRecord.record.title -ne 'Portable path test'){throw 'Could not persist a record in the extracted bundle.'}
    $officePidBefore=(Get-Content -Raw -LiteralPath (Join-Path $officeExtracted 'data\local-server.json') | ConvertFrom-Json).pid
    $officeStartOutput = & (Join-Path $officeExtracted 'Start Office.bat') -NoBrowser -Port $Port
    if($LASTEXITCODE -ne 0){throw ($officeStartOutput -join "`n")}
    $officePidAfter=(Get-Content -Raw -LiteralPath (Join-Path $officeExtracted 'data\local-server.json') | ConvertFrom-Json).pid
    if($officePidBefore -ne $officePidAfter){throw 'Launching twice should reuse the existing process.'}
    & (Join-Path $officeExtracted 'Stop Office.bat') | Out-Null
    if($LASTEXITCODE -ne 0){throw 'The portable stop script failed.'}
    $officeStarted=$false
    if(Test-Path -LiteralPath (Join-Path $officeExtracted 'data\local-server.json')){throw 'Stop should remove its process state.'}
    # Copy rather than move: this test never deletes or relocates user files.
    $officeCopy=Join-Path $officeSmoke 'copied office'
    Copy-Item -LiteralPath $officeExtracted -Destination $officeCopy -Recurse
    $officeExtracted=$officeCopy
    $officeStartOutput = & (Join-Path $officeExtracted 'Start Office.bat') -NoBrowser -Port $Port
    if($LASTEXITCODE -ne 0){throw ($officeStartOutput -join "`n")}
    $officeStarted=$true
    $officeRecords=Invoke-RestMethod -Uri ($officeUrl+'records&kind=tasks') -WebSession $officeWebSession
    if($officeRecords.records[0].title -ne 'Portable path test'){throw 'The copied folder did not preserve its database.'}
    Write-Output 'PASS Windows portable ZIP: actual batch launch/stop, bundled PHP/SQLite, owner setup, persistence, paths with spaces, repeated launch reuse, and copy-folder portability.'
} finally {
    if($officeStarted){ & (Join-Path $officeExtracted 'Stop Office.bat') | Out-Null }
}
