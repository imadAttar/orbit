# Orbit session-state hook - writes Claude Code hook payload to ~/.orbit/session-state.json
# which Orbit's filesystem watcher picks up to update UI indicators.
$ErrorActionPreference = 'Stop'
$targetDir = Join-Path $env:USERPROFILE '.orbit'
if (-not (Test-Path $targetDir)) {
    New-Item -ItemType Directory -Force -Path $targetDir | Out-Null
}
# Claude Code emits UTF-8 JSON. PowerShell defaults stdin to the OEM codepage,
# which corrupts non-ASCII (e.g. accented project names). Read raw bytes and
# write them through unchanged so the payload round-trips verbatim.
$stdin = [System.Console]::OpenStandardInput()
$mem = New-Object System.IO.MemoryStream
$stdin.CopyTo($mem)
$target = Join-Path $targetDir 'session-state.json'
[System.IO.File]::WriteAllBytes($target, $mem.ToArray())
