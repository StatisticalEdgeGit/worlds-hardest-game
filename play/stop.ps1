# Stops the game server started by start.bat, and the database container.
$ErrorActionPreference = 'Stop'

$PlayDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$Root = (Resolve-Path (Join-Path $PlayDir '..')).Path
Set-Location $Root

Get-CimInstance Win32_Process -Filter "Name = 'node.exe'" | ForEach-Object {
  if ($_.CommandLine -and $_.CommandLine -like '*server*index.js*') {
    Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue
  }
}

& docker compose stop 2>&1 | ForEach-Object { Write-Host "$_" }
if ($LASTEXITCODE -ne 0) {
  Write-Host 'Could not stop the database. Is Docker running?' -ForegroundColor Red
  Read-Host 'Press Enter to close' | Out-Null
  exit 1
}

Write-Host 'Game stopped.'
Start-Sleep -Seconds 2
