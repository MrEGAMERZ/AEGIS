# Aegis - one-shot demo starter for the VLM host (friend's laptop)
# Usage:
#   powershell -ExecutionPolicy Bypass -File start-demo.ps1          # real mode (Ollama + qwen3-vl)
#   powershell -ExecutionPolicy Bypass -File start-demo.ps1 -Mock    # no model needed, fake actions
# Options:
#   -Mock          skip Ollama checks, run the gateway with deterministic fake actions
#   -Port <int>    gateway port (default 8000)
#   -Model <name>  Ollama vision model id (default qwen3-vl:8b)
[cmdletbinding()]
param(
  [switch]$Mock,
  [int]$Port = 8000,
  [string]$Model = "qwen3-vl:8b"
)

$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path   # the server/ folder

function Section($t) { Write-Host ""; Write-Host "== $t ==" -ForegroundColor Cyan }

# --- 0. Node -----------------------------------------------------------------
Section "Prerequisites"
if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
  Write-Host "Node.js not found. Install Node 18+ first: https://nodejs.org" -ForegroundColor Red
  exit 1
}
Write-Host "node: $(node --version)"

# --- 1. Model (skip in mock mode) -------------------------------------------
if ($Mock) {
  Write-Host "Mock mode: no VLM required." -ForegroundColor Yellow
} else {
  if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    Write-Host "Ollama not found. Install it from https://ollama.com/download" -ForegroundColor Red
    Write-Host "  (then rerun this script; or use -Mock to demo without a model)"
    exit 1
  }
  Write-Host "ollama: $(ollama --version)"

  Section "Model check"
  $have = ollama list 2>$null
  if ($have -notmatch [regex]::Escape($Model)) {
    Write-Host "Pulling $Model (a few GB, one-time). This can take a while..." -ForegroundColor Yellow
    ollama pull $Model
    if ($LASTEXITCODE -ne 0) {
      Write-Host "pull failed - check network, or use -Mock" -ForegroundColor Red
      exit 1
    }
  } else {
    Write-Host "$Model already pulled."
  }
}

# --- 2. LAN IP ---------------------------------------------------------------
Section "Network"
$ip = $null
try {
  $ip = (Get-NetIPAddress -AddressFamily IPv4 -ErrorAction Stop |
    Where-Object { $_.IPAddress -notlike "169.254*" -and $_.IPAddress -ne "127.0.0.1" -and $_.PrefixOrigin -ne "WellKnown" } |
    Sort-Object InterfaceMetric | Select-Object -First 1).IPAddress
} catch {}
if (-not $ip -and (Get-Command ipconfig -ErrorAction SilentlyContinue)) {
  $ip = (ipconfig | Select-String "IPv4.*: ([\d\.]+)" | ForEach-Object { $_.Matches[0].Groups[1].Value } | Select-Object -First 1)
}
if (-not $ip) { $ip = "<your-LAN-IP>" }
Write-Host "Your LAN IP: $ip"
Write-Host "The extension on the demo laptop will call: http://$ip`:$Port" -ForegroundColor Green

# --- 3. Firewall hint ---------------------------------------------------------
Section "Firewall"
Write-Host "If the browser laptop gets a timeout, open the port (admin PowerShell on THIS machine):"
Write-Host "  New-NetFirewallRule -DisplayName 'Aegis' -Direction Inbound -LocalPort $Port -Protocol TCP -Action Allow" -ForegroundColor Yellow

# --- 4. Start the gateway -----------------------------------------------------
Section "Starting Aegis gateway (HOST=0.0.0.0, port $Port)"
$env:HOST = "0.0.0.0"
$env:PORT = "$Port"
$env:UPSTREAM_MODEL = $Model
if ($Mock) { $env:MOCK = "1" }
Write-Host "Ctrl+C to stop."
Write-Host "Health check here:      http://$ip`:$Port/health"
Write-Host "From the demo laptop:   http://$ip`:$Port/health"
& node "$root\index.js"