$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

if (-not $env:LICENSE_API_URL) {
    Write-Warning "LICENSE_API_URL is not set. Release builds should point at your license server."
}

& (Join-Path $Root "scripts\build-portable-python.ps1")

# Do not pass the updater key into `tauri build` on Windows — an empty
# password hangs on an interactive prompt. Bundle first, then sign.
$signingKey = $env:TAURI_SIGNING_PRIVATE_KEY
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue

$version = (Get-Content (Join-Path $Root "package.json") -Raw | ConvertFrom-Json).version
$exe = Join-Path $Root "src-tauri\target\release\bundle\nsis\Profile Generator_${version}_x64-setup.exe"

if ($env:TAURI_BUNDLES) {
    cmd /c "npm run tauri -- build --bundles $env:TAURI_BUNDLES"
} else {
    cmd /c "npm run tauri build"
}
$buildCode = $LASTEXITCODE

if (-not (Test-Path -LiteralPath $exe)) {
    throw "Tauri build finished without $exe (exit $buildCode)."
}

if ($buildCode -ne 0) {
    Write-Host "tauri build exited $buildCode but the installer exists; signing next."
}

if ($signingKey) {
    $env:TAURI_SIGNING_PRIVATE_KEY = $signingKey
}
$localKey = Join-Path $env:USERPROFILE ".tauri\profile-generator.key"
if ($env:TAURI_SIGNING_PRIVATE_KEY -or (Test-Path $localKey)) {
    & (Join-Path $Root "scripts\sign-updater-artifacts.ps1")
} else {
    Write-Warning "No updater signing key. Installer is at $exe"
}
