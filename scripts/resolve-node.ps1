param([string]$NodeExecutable)

if (!$NodeExecutable) {
    $settingsFile = Join-Path $PSScriptRoot '../.runtime/.env'
    if (Test-Path -LiteralPath $settingsFile -PathType Leaf) {
        $entry = Select-String -LiteralPath $settingsFile -Pattern '^\s*OFFICE_NODE_EXE\s*=\s*(.*?)\s*$' | Select-Object -Last 1
        if ($entry) { $NodeExecutable = $entry.Matches[0].Groups[1].Value }
    }
}

if ($NodeExecutable) {
    $nodeFile = Get-Item -LiteralPath $NodeExecutable -ErrorAction SilentlyContinue
    if ($nodeFile -isnot [IO.FileInfo] -or $nodeFile.Extension -ine '.exe') {
        throw "Node.js executable not found at '$NodeExecutable'. Set -NodeExecutable or OFFICE_NODE_EXE in .runtime/.env to the full path to node.exe."
    }
    return $nodeFile.FullName
}

$nodeCommand = Get-Command node.exe -CommandType Application -ErrorAction SilentlyContinue
if (!$nodeCommand) {
    throw 'Node.js is required to build Office. Add Node.js to PATH and open a new terminal, or set OFFICE_NODE_EXE in .runtime/.env to the full path to node.exe. You can also pass -NodeExecutable.'
}
return $nodeCommand.Path
