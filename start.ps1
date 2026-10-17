# Starts World's Hardest Game on this PC and shows a QR code.
# Friends on the same Wi-Fi scan it, then join the race you host.
$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'

function Invoke-Native {
  param(
    [Parameter(Mandatory = $true)][string]$File,
    [Parameter(Mandatory = $true)][string[]]$NativeArgs,
    [switch]$Quiet
  )
  # Flags such as -d must arrive in an array. PowerShell would otherwise treat -d as -Debug.
  # Continue: Windows PowerShell treats Docker stderr warnings as fatal when ErrorAction is Stop.
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $output = & $File @NativeArgs 2>&1
    $code = $LASTEXITCODE
    if (-not $Quiet) {
      foreach ($line in @($output)) { Write-Host "$line" }
    }
    return $code
  } finally {
    $ErrorActionPreference = $previous
  }
}

$Root = Split-Path -Parent $MyInvocation.MyCommand.Path
$PlayDir = Join-Path $Root 'play'
Set-Location $Root

function Read-EnvFile([string]$Path) {
  $map = @{}
  if (-not (Test-Path -LiteralPath $Path)) { return $map }
  foreach ($line in Get-Content -LiteralPath $Path) {
    $t = $line.Trim()
    if ($t.Length -eq 0 -or $t.StartsWith('#')) { continue }
    $eq = $t.IndexOf('=')
    if ($eq -lt 1) { continue }
    $map[$t.Substring(0, $eq).Trim()] = $t.Substring($eq + 1).Trim()
  }
  return $map
}

function Get-LanIPv4 {
  $skip = 'vEthernet|WSL|Hyper-V|VirtualBox|VMware|Loopback|Bluetooth|Default Switch|Npcap'
  $routes = @(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue |
    Where-Object { $_.NextHop -and $_.NextHop -ne '0.0.0.0' } |
    Sort-Object RouteMetric, InterfaceMetric)
  foreach ($route in $routes) {
    $adapter = Get-NetAdapter -InterfaceIndex $route.InterfaceIndex -ErrorAction SilentlyContinue
    if (-not $adapter -or $adapter.Status -ne 'Up') { continue }
    $label = "$($adapter.Name) $($adapter.InterfaceDescription)"
    if ($label -match $skip) { continue }
    $ip = @(Get-NetIPAddress -InterfaceIndex $route.InterfaceIndex -AddressFamily IPv4 -ErrorAction SilentlyContinue |
      Where-Object { $_.IPAddress -notlike '127.*' -and $_.IPAddress -notlike '169.254.*' }) |
      Select-Object -First 1
    if ($ip) {
      return [pscustomobject]@{ Address = $ip.IPAddress; Adapter = $adapter.Name }
    }
  }
  throw 'No Wi-Fi or Ethernet address found. Connect this PC to the same network as the phones, then run this again.'
}

function Open-Target([string]$Target) {
  # explorer opens both the QR page and http links, including when the file has no app association.
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    Start-Process -FilePath 'explorer.exe' -ArgumentList $Target
  } catch {
    Write-Host "Open this yourself: $Target"
  } finally {
    $ErrorActionPreference = $previous
  }
}

function Stop-PackagedApi {
  $previous = $ErrorActionPreference
  $ErrorActionPreference = 'Continue'
  try {
    $apiId = @(& docker @('compose', 'ps', '-q', 'api') 2>&1 | Where-Object { "$_" -match '^[0-9a-f]+$' })
    $code = $LASTEXITCODE
  } finally {
    $ErrorActionPreference = $previous
  }
  if ($code -ne 0) { throw 'Docker could not list the game containers.' }
  if ($apiId) {
    Write-Host 'Stopping the Docker copy of the game so phones can reach this PC...'
    $code = Invoke-Native docker @('compose', 'stop', 'api')
    if ($code -ne 0) { throw 'Could not stop the Docker copy of the game.' }
  }
}

try {
  $code = Invoke-Native docker @('info') -Quiet
  if ($code -ne 0) {
    throw 'Docker is not running. Start Docker Desktop, wait until it is ready, then run this again.'
  }

  $envFile = Read-EnvFile (Join-Path $Root '.env')
  $password = if ($envFile.ContainsKey('POSTGRES_PASSWORD') -and $envFile['POSTGRES_PASSWORD']) { $envFile['POSTGRES_PASSWORD'] } else { 'whg-local-dev' }
  $dbPort = if ($envFile.ContainsKey('DB_PORT') -and $envFile['DB_PORT']) { $envFile['DB_PORT'] } else { '5433' }
  $apiPort = if ($envFile.ContainsKey('API_PORT') -and $envFile['API_PORT']) { $envFile['API_PORT'] } else { '8080' }
  $lan = Get-LanIPv4
  $url = "http://$($lan.Address):$apiPort"

  if (-not (Test-Path -LiteralPath (Join-Path $Root 'server\node_modules\express'))) {
    Write-Host 'Installing the game server (once)...'
    $code = Invoke-Native npm @('ci', '--prefix', (Join-Path $Root 'server'))
    if ($code -ne 0) { throw 'Could not install the game server.' }
  }
  if (-not (Test-Path -LiteralPath (Join-Path $PlayDir 'node_modules\qrcode'))) {
    Write-Host 'Installing the QR code tool (once)...'
    $code = Invoke-Native npm @('install', '--prefix', $PlayDir, '--omit=dev')
    if ($code -ne 0) { throw 'Could not install the QR code tool.' }
  }

  Write-Host 'Starting the database...'
  $code = Invoke-Native docker @('compose', 'up', '-d', 'db')
  if ($code -ne 0) { throw 'Could not start the database. Start Docker Desktop, then run this again.' }
  Stop-PackagedApi

  $ready = $false
  for ($i = 0; $i -lt 45; $i++) {
    $code = Invoke-Native docker @('compose', 'exec', '-T', 'db', 'pg_isready', '-U', 'whg', '-d', 'whg') -Quiet
    if ($code -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 1
  }
  if (-not $ready) { throw 'The database did not become ready. Run start.bat again in a moment.' }

  Write-Host ''
  Write-Host 'Scan this with a phone on the same Wi-Fi:'
  # Not through Invoke-Native: capturing node's output makes Windows PowerShell decode it with
  # the console's old code page (437 or 850), which turns the QR's block characters into junk.
  # Left uncaptured, node writes them to the console itself.
  & node (Join-Path $PlayDir 'show_qr.js') $url (Join-Path $PlayDir 'join.html')
  if ($LASTEXITCODE -ne 0) { throw 'Could not draw the QR code.' }

  Write-Host "  $url"
  Write-Host "  via $($lan.Adapter)"
  Write-Host ''
  Write-Host 'On this PC: pick a name, then tap Host.'
  Write-Host 'Friends: pick a name, tap Join, and type the 4-letter room code.'
  Write-Host 'If Windows asks to allow Node.js on private networks, click Allow.'
  Write-Host 'Close this window to stop the game.'
  Write-Host ''

  $env:DATABASE_URL = "postgres://whg:$([uri]::EscapeDataString($password))@127.0.0.1:${dbPort}/whg"
  $env:PORT = "$apiPort"
  $env:HOST = '0.0.0.0'
  $env:PUBLIC_URL = $url
  $env:GAME_DIR = $Root

  $node = Start-Process -FilePath 'node' -ArgumentList 'server/src/index.js' -WorkingDirectory $Root -NoNewWindow -PassThru
  $up = $false
  try {
    for ($i = 0; $i -lt 40; $i++) {
      if ($node.HasExited) { throw 'The game server stopped while starting. See the messages above.' }
      try {
        $health = Invoke-RestMethod -Uri "http://127.0.0.1:${apiPort}/api/health" -TimeoutSec 2
        if ($health.ok) { $up = $true; break }
      } catch { }
      Start-Sleep -Seconds 1
    }
    if (-not $up) { throw 'The game did not start in time. See the messages above.' }
    if ($health.publicUrl -and $health.publicUrl -ne $url) {
      Write-Host "Lobby link is $($health.publicUrl). Friends should still scan the QR code above."
    }

    try {
      Invoke-RestMethod -Uri "$url/api/health" -TimeoutSec 3 | Out-Null
    } catch {
      Write-Host "This PC opened the game, but $url did not answer yet."
      Write-Host 'If a phone cannot load it, allow Node.js through Windows Firewall for private networks.'
    }

    Open-Target (Join-Path $PlayDir 'join.html')
    Open-Target "http://127.0.0.1:${apiPort}/"
    Wait-Process -Id $node.Id
  } finally {
    if (-not $node.HasExited) {
      Stop-Process -Id $node.Id -Force -ErrorAction SilentlyContinue
      $node.WaitForExit(5000) | Out-Null
    }
  }
} catch {
  Write-Host ''
  Write-Host $_.Exception.Message -ForegroundColor Red
  Write-Host ''
  Read-Host 'Press Enter to close' | Out-Null
  exit 1
}
