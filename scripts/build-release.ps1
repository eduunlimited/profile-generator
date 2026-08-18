$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$keyPath = Join-Path $env:USERPROFILE ".tauri\profile-generator.key"
if (Test-Path $keyPath) {
    $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content $keyPath -Raw
    Write-Host "Loaded Tauri signing key from $keyPath"
} else {
    Write-Warning "No Tauri signing key at $keyPath. Updater artifact generation may fail."
}

if (-not $env:LICENSE_API_URL) {
    Write-Warning "LICENSE_API_URL is not set. Release builds should point at your license server."
}

& (Join-Path $Root "scripts\build-portable-python.ps1")
npm run tauri build
