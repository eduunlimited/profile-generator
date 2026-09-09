# Builds a portable Python + Camoufox runtime for bundling into the Tauri installer.
# Output: src-tauri/resources/python-win/

$ErrorActionPreference = "Stop"

$Root = Split-Path -Parent (Split-Path -Parent $MyInvocation.MyCommand.Path)
$OutDir = Join-Path $Root "src-tauri\resources\python-win"
$Requirements = Join-Path $Root "requirements-camoufox.txt"
$PythonVersion = "3.12.8"
$EmbeddableUrl = "https://www.python.org/ftp/python/$PythonVersion/python-$PythonVersion-embed-amd64.zip"
$GetPipUrl = "https://bootstrap.pypa.io/get-pip.py"
$TempDir = Join-Path $env:TEMP "epgs-python-build"

Write-Host "Building portable Python runtime for Profile Generator..."
Write-Host "Output: $OutDir"

$pythonExe = Join-Path $OutDir "python.exe"
if ($env:FORCE_PYTHON_REBUILD -ne "1" -and (Test-Path $pythonExe)) {
    Write-Host "Portable Python already exists at $OutDir. Skipping rebuild (set FORCE_PYTHON_REBUILD=1 to force)."
    exit 0
}

if (Test-Path $OutDir) {
    Remove-Item -Recurse -Force $OutDir
}
New-Item -ItemType Directory -Force -Path $OutDir | Out-Null

if (Test-Path $TempDir) {
    Remove-Item -Recurse -Force $TempDir
}
New-Item -ItemType Directory -Force -Path $TempDir | Out-Null

$ZipPath = Join-Path $TempDir "python-embed.zip"
Write-Host "Downloading Python $PythonVersion embeddable..."
Invoke-WebRequest -Uri $EmbeddableUrl -OutFile $ZipPath
Expand-Archive -Path $ZipPath -DestinationPath $OutDir -Force

# Enable site-packages in embeddable python
$PthFile = Get-ChildItem -Path $OutDir -Filter "python*._pth" | Select-Object -First 1
if ($PthFile) {
    $pthContent = Get-Content $PthFile.FullName
    $pthContent = $pthContent | ForEach-Object { $_ -replace "^#import site", "import site" }
    if ($pthContent -notcontains "Lib\site-packages") {
        $pthContent += "Lib\site-packages"
    }
    Set-Content -Path $PthFile.FullName -Value $pthContent
}

New-Item -ItemType Directory -Force -Path (Join-Path $OutDir "Lib\site-packages") | Out-Null

$GetPipPath = Join-Path $TempDir "get-pip.py"
Write-Host "Bootstrapping pip..."
Invoke-WebRequest -Uri $GetPipUrl -OutFile $GetPipPath
& (Join-Path $OutDir "python.exe") $GetPipPath --no-warn-script-location

Write-Host "Installing Camoufox dependencies..."
& (Join-Path $OutDir "python.exe") -m pip install --upgrade pip --no-warn-script-location
& (Join-Path $OutDir "python.exe") -m pip install -r $Requirements --no-warn-script-location

$CamoufoxCache = Join-Path $OutDir "camoufox-cache"
New-Item -ItemType Directory -Force -Path $CamoufoxCache | Out-Null
$env:PLAYWRIGHT_BROWSERS_PATH = $CamoufoxCache
$env:CAMOUFOX_CACHE_DIR = $CamoufoxCache

Write-Host "Fetching Camoufox browser binaries (this may take a few minutes)..."
& (Join-Path $OutDir "python.exe") -m camoufox fetch

Write-Host "Verifying Camoufox..."
$CheckScript = Join-Path $Root "scripts\camoufox\check_camoufox.py"
$checkOutput = & (Join-Path $OutDir "python.exe") $CheckScript 2>&1
Write-Host $checkOutput
if ($LASTEXITCODE -ne 0 -and ($checkOutput -notmatch '"ready"\s*:\s*true')) {
    throw "Camoufox verification failed."
}

Remove-Item -Recurse -Force $TempDir
Write-Host "Portable Python runtime ready at $OutDir"
