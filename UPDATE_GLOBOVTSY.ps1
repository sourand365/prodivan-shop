$ErrorActionPreference = 'Stop'
$root = [Environment]::GetEnvironmentVariable('GLOBOVETS_DIR')
if (-not $root) { $root = (Get-Location).Path }
$root = (Resolve-Path $root).Path

Write-Host ''
Write-Host '=== GLOBOVETS UPDATE ===' -ForegroundColor Cyan
Read-Host 'Stop the bot with Ctrl+C, then press Enter'

if (-not (Test-Path (Join-Path $root 'package.json')) -or -not (Test-Path (Join-Path $root 'index.js'))) {
  $entered = Read-Host 'Enter the full path to the globovets-standalone folder'
  if (-not $entered -or -not (Test-Path (Join-Path $entered 'package.json'))) {
    throw 'Project folder not found.'
  }
  $root = (Resolve-Path $entered).Path
}

$required = @('index.js', 'legacy.js')
$coreRequired = @('index.js', 'legacy.js', 'package.json')
foreach ($file in $coreRequired) {
  if (-not (Test-Path (Join-Path $root $file))) {
    throw "Required project file is missing: $file"
  }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = Join-Path (Split-Path $root -Parent) ("globovets-backup-" + $stamp)
$backup = Join-Path $backupRoot 'project'
New-Item -ItemType Directory -Path $backup -Force | Out-Null

Write-Host 'Creating project backup...' -ForegroundColor Yellow
$exclude = @(
  (Join-Path $root 'node_modules'),
  (Join-Path $root '.git'),
  (Join-Path $root 'data\backups')
)
& robocopy $root $backup /E /XD $exclude /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) {
  throw 'Backup failed. Update cancelled.'
}

$hadLock = Test-Path (Join-Path $root 'package-lock.json')
$temp = Join-Path $env:TEMP ("globovets-update-" + $stamp)
New-Item -ItemType Directory -Path $temp -Force | Out-Null
$base = 'https://raw.githubusercontent.com/sourand365/prodivan-shop/main/'

try {
  Write-Host 'Downloading update files from GitHub...' -ForegroundColor Yellow
  foreach ($file in $required) {
    $relativeUrl = $file -replace '\\','/'
    $tempFile = Join-Path $temp $file
    New-Item -ItemType Directory -Path (Split-Path $tempFile -Parent) -Force | Out-Null
    Invoke-WebRequest -Uri ($base + $relativeUrl) -OutFile $tempFile -UseBasicParsing
    if ((Get-Item $tempFile).Length -lt 10) {
      throw "Downloaded file is empty or damaged: $file"
    }
  }

  foreach ($file in $required) {
    $source = Join-Path $temp $file
    $destination = Join-Path $root $file
    New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
    Copy-Item $source $destination -Force
  }

  Write-Host 'Installing dependencies...' -ForegroundColor Yellow
  Push-Location $root
  & npm install
  if ($LASTEXITCODE -ne 0) {
    throw 'npm install failed.'
  }

  Write-Host 'Checking file syntax...' -ForegroundColor Yellow
  & npm run check
  if ($LASTEXITCODE -ne 0) {
    throw 'npm run check failed.'
  }
  Pop-Location

  Write-Host ''
  Write-Host 'UPDATE COMPLETED SUCCESSFULLY!' -ForegroundColor Green
  Write-Host ('Backup: ' + $backupRoot)
  Write-Host 'The .env file and SQLite database were not overwritten.'
  Write-Host 'Restart the bot with: npm start'
}
catch {
  if ((Get-Location).Path -eq $root) {
    Pop-Location
  }

  Write-Host ''
  Write-Host ('ERROR: ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host 'Restoring original project files from backup...' -ForegroundColor Yellow

  foreach ($file in $required) {
    $saved = Join-Path $backup $file
    if (Test-Path $saved) {
      Copy-Item $saved (Join-Path $root $file) -Force
    }
  }

  $savedLock = Join-Path $backup 'package-lock.json'
  if ($hadLock -and (Test-Path $savedLock)) {
    Copy-Item $savedLock (Join-Path $root 'package-lock.json') -Force
  }
  elseif (-not $hadLock) {
    Remove-Item (Join-Path $root 'package-lock.json') -Force -ErrorAction SilentlyContinue
  }

  Write-Host 'Original index.js, legacy.js and package.json have been restored.'
  Write-Host 'The SQLite database and .env file were not changed.'
  exit 1
}
finally {
  if (Test-Path $temp) {
    Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue
  }
}
