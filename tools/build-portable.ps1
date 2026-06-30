param(
  [string]$NodeVersion = "",
  [string]$OutputParent = "",
  [switch]$SkipBrowserInstall
)

$ErrorActionPreference = "Stop"

$SourcePortableRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path

function Test-FolderWritable([string]$Folder) {
  try {
    New-Item -ItemType Directory -Force -Path $Folder | Out-Null
    $probe = Join-Path $Folder ("write-test-" + [guid]::NewGuid().ToString("N") + ".tmp")
    [System.IO.File]::WriteAllText($probe, "ok")
    Remove-Item -LiteralPath $probe -Force
    return $true
  }
  catch {
    return $false
  }
}

if (-not $OutputParent) {
  $candidateParent = Split-Path $SourcePortableRoot -Parent
  if (Test-FolderWritable $candidateParent) {
    $OutputParent = $candidateParent
  }
  else {
    $OutputParent = Join-Path $env:USERPROFILE "BlogBackupPortable"
  }
}

New-Item -ItemType Directory -Force -Path $OutputParent | Out-Null
$OutputParent = (Resolve-Path $OutputParent).Path
$BuildRoot = Join-Path $OutputParent "portable-build"
$PortableRoot = Join-Path $BuildRoot "BlogBackup"

if (Test-Path $BuildRoot) {
  $resolvedTarget = (Resolve-Path $BuildRoot).Path
  if (-not $resolvedTarget.StartsWith($OutputParent, [System.StringComparison]::OrdinalIgnoreCase)) {
    throw "Refusing to remove staging folder outside output parent: $resolvedTarget"
  }
  Remove-Item -LiteralPath $resolvedTarget -Recurse -Force
}

New-Item -ItemType Directory -Force -Path $BuildRoot | Out-Null
New-Item -ItemType Directory -Force -Path $PortableRoot | Out-Null
foreach ($relativePath in @("app", "tools", "README.html", "Start Backup.bat")) {
  $source = Join-Path $SourcePortableRoot $relativePath
  if (Test-Path $source) {
    Copy-Item -LiteralPath $source -Destination $PortableRoot -Recurse -Force
  }
}

$ServerDir = Join-Path $PortableRoot "app\server"
$RuntimeDir = Join-Path $PortableRoot "app\runtime"
$NodeDir = Join-Path $RuntimeDir "node"
$BrowsersDir = Join-Path $PortableRoot "app\browsers"
$ZipPath = Join-Path $OutputParent "BlogBackup.zip"
$TempDir = Join-Path $env:TEMP ("blog-backup-build-" + [guid]::NewGuid().ToString("N"))

function Get-LatestLtsNodeVersion {
  $index = Invoke-RestMethod "https://nodejs.org/dist/index.json"
  $release = $index | Where-Object {
    $_.lts -ne $false -and $_.files -contains "win-x64-zip"
  } | Select-Object -First 1

  if (-not $release) {
    throw "Could not find a Windows x64 Node.js LTS release."
  }

  return $release.version
}

function Invoke-Step($Message, [scriptblock]$Block) {
  Write-Host ""
  Write-Host "==> $Message" -ForegroundColor Cyan
  & $Block
}

function Assert-NativeSuccess([string]$CommandName) {
  if ($LASTEXITCODE -ne 0) {
    throw "$CommandName failed with exit code $LASTEXITCODE."
  }
}

New-Item -ItemType Directory -Force -Path $RuntimeDir, $BrowsersDir | Out-Null

if (-not $NodeVersion) {
  $NodeVersion = Get-LatestLtsNodeVersion
}

Invoke-Step "Using Node.js $NodeVersion" {
  if (-not (Test-Path (Join-Path $NodeDir "node.exe"))) {
    New-Item -ItemType Directory -Force -Path $TempDir | Out-Null
    $nodeZip = Join-Path $TempDir "node.zip"
    $nodeUrl = "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-x64.zip"
    Invoke-WebRequest -Uri $nodeUrl -OutFile $nodeZip
    Expand-Archive -Path $nodeZip -DestinationPath $TempDir -Force
    $expandedNodeDir = Get-ChildItem -Path $TempDir -Directory | Where-Object { $_.Name -like "node-*-win-x64" } | Select-Object -First 1
    if (-not $expandedNodeDir) {
      throw "Node.js ZIP did not contain the expected folder."
    }
    if (Test-Path $NodeDir) {
      Remove-Item -LiteralPath $NodeDir -Recurse -Force
    }
    New-Item -ItemType Directory -Force -Path $NodeDir | Out-Null
    Get-ChildItem -LiteralPath $expandedNodeDir.FullName -Force | Move-Item -Destination $NodeDir
  }
  & (Join-Path $NodeDir "node.exe") --version
  Assert-NativeSuccess "node --version"
}

$env:Path = "$NodeDir;$env:Path"
$env:PLAYWRIGHT_BROWSERS_PATH = $BrowsersDir
$env:npm_config_update_notifier = "false"

Invoke-Step "Installing app dependencies" {
  Push-Location $ServerDir
  try {
    & (Join-Path $NodeDir "npm.cmd") install --omit=dev
    Assert-NativeSuccess "npm install"
  }
  finally {
    Pop-Location
  }
}

if (-not $SkipBrowserInstall) {
  Invoke-Step "Installing Playwright Chromium into app\browsers" {
    Push-Location $ServerDir
    try {
      & (Join-Path $NodeDir "node.exe") (Join-Path $ServerDir "node_modules\playwright\cli.js") install chromium
      Assert-NativeSuccess "playwright install chromium"
    }
    finally {
      Pop-Location
    }
  }
}

Invoke-Step "Clearing local archive data from packaged copy" {
  foreach ($relativePath in @("archive", "exports", "logs")) {
    $target = Join-Path $PortableRoot $relativePath
    if (Test-Path $target) {
      Remove-Item -LiteralPath $target -Recurse -Force
    }
  }
}

Invoke-Step "Preparing writable folders" {
  New-Item -ItemType Directory -Force -Path `
    (Join-Path $PortableRoot "archive\blogs"), `
    (Join-Path $PortableRoot "archive\data"), `
    (Join-Path $PortableRoot "exports"), `
    (Join-Path $PortableRoot "logs") | Out-Null
}

Invoke-Step "Creating BlogBackup.zip" {
  if (Test-Path $ZipPath) {
    Remove-Item -LiteralPath $ZipPath -Force
  }
  Compress-Archive -Path $PortableRoot -DestinationPath $ZipPath -Force
  Write-Host "Created $ZipPath" -ForegroundColor Green
}

if (Test-Path $TempDir) {
  Remove-Item -LiteralPath $TempDir -Recurse -Force
}

if (Test-Path $BuildRoot) {
  Remove-Item -LiteralPath $BuildRoot -Recurse -Force
}
