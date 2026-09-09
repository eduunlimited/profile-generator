# Signs the versioned NSIS installer and writes updater assets:
#   release-assets/ProfileGenerator_<ver>_x64-setup.exe
#   release-assets/ProfileGenerator_<ver>_x64-setup.exe.sig
#   release-assets/latest.json
$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
Set-Location $Root

$version = (Get-Content (Join-Path $Root "package.json") -Raw | ConvertFrom-Json).version
if (-not $version) { throw "Could not read version from package.json." }

$repo = $env:GITHUB_REPOSITORY
if (-not $repo) { $repo = "eduunlimited/profile-generator" }
$tag = if ($env:RELEASE_TAG) { $env:RELEASE_TAG } else { "v$version" }

$nsisName = "Profile Generator_${version}_x64-setup.exe"
$exe = Join-Path $Root "src-tauri\target\release\bundle\nsis\$nsisName"
if (-not (Test-Path -LiteralPath $exe)) {
    throw "NSIS installer not found: $exe"
}

$keyFile = Join-Path $env:TEMP "tauri-updater-sign.key"
$cleanupKey = $false
if ($env:TAURI_SIGNING_PRIVATE_KEY) {
    [System.IO.File]::WriteAllText($keyFile, $env:TAURI_SIGNING_PRIVATE_KEY.Trim())
    $cleanupKey = $true
} else {
    $localKey = Join-Path $env:USERPROFILE ".tauri\profile-generator.key"
    if (-not (Test-Path $localKey)) {
        throw "No TAURI_SIGNING_PRIVATE_KEY env and no key at $localKey."
    }
    $keyFile = $localKey
}

$tauri = Join-Path $Root "node_modules\@tauri-apps\cli\tauri.js"
$sigPath = "$exe.sig"
if (Test-Path -LiteralPath $sigPath) {
    Remove-Item -LiteralPath $sigPath -Force
}

Write-Host "Signing $nsisName"
# `-f` and TAURI_SIGNING_PRIVATE_KEY cannot be set together.
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY -ErrorAction SilentlyContinue
Remove-Item Env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD -ErrorAction SilentlyContinue
node $tauri signer sign -f $keyFile --password= -- $exe
if (-not (Test-Path -LiteralPath $sigPath)) {
    throw "Signer did not write $sigPath"
}

if ($cleanupKey) {
    Remove-Item -LiteralPath $keyFile -Force -ErrorAction SilentlyContinue
}

$assetName = "ProfileGenerator_${version}_x64-setup.exe"
$outDir = Join-Path $Root "release-assets"
New-Item -ItemType Directory -Force -Path $outDir | Out-Null
Copy-Item -LiteralPath $exe -Destination (Join-Path $outDir $assetName) -Force
Copy-Item -LiteralPath $sigPath -Destination (Join-Path $outDir "$assetName.sig") -Force

$latestPath = Join-Path $outDir "latest.json"
$env:UPDATER_VERSION = $version
$env:UPDATER_TAG = $tag
$env:UPDATER_REPO = $repo
$env:UPDATER_ASSET = $assetName
$env:UPDATER_SIG_FILE = $sigPath
$env:UPDATER_LATEST = $latestPath
node -e "const fs=require('fs'); const signature=fs.readFileSync(process.env.UPDATER_SIG_FILE,'utf8').trim(); const manifest={version:process.env.UPDATER_VERSION,notes:'Profile Generator '+process.env.UPDATER_VERSION,pub_date:new Date().toISOString(),platforms:{'windows-x86_64':{signature,url:'https://github.com/'+process.env.UPDATER_REPO+'/releases/download/'+process.env.UPDATER_TAG+'/'+process.env.UPDATER_ASSET}}}; fs.writeFileSync(process.env.UPDATER_LATEST, JSON.stringify(manifest,null,2));"
Write-Host "Wrote updater assets for $tag in $outDir"
