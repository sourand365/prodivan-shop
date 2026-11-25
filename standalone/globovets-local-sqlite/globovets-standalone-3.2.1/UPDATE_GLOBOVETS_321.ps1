$ErrorActionPreference = 'Stop'
$root = [Environment]::GetEnvironmentVariable('GLOBOVETS_DIR')
if (-not $root) { $root = (Get-Location).Path }
$root = (Resolve-Path $root).Path

Write-Host ''
Write-Host '=== ОБНОВЛЕНИЕ ГЛОБОВЦА 3.2.1 ===' -ForegroundColor Cyan
Read-Host 'Сначала останови бота (Ctrl+C), затем нажми Enter'

if (-not (Test-Path (Join-Path $root 'package.json')) -or -not (Test-Path (Join-Path $root 'index.js'))) {
  $entered = Read-Host 'Укажи полный путь к папке globovets-standalone'
  if (-not $entered -or -not (Test-Path (Join-Path $entered 'package.json'))) {
    throw 'Папка проекта не найдена.'
  }
  $root = (Resolve-Path $entered).Path
}

$required = @('index.js', 'legacy.js', 'package.json')
foreach ($file in $required) {
  if (-not (Test-Path (Join-Path $root $file))) { throw "В проекте отсутствует $file" }
}

$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = Join-Path (Split-Path $root -Parent) ("globovets-backup-3.2.1-" + $stamp)
$backup = Join-Path $backupRoot 'project'
New-Item -ItemType Directory -Path $backup -Force | Out-Null

Write-Host 'Создаю резервную копию...' -ForegroundColor Yellow
$exclude = @((Join-Path $root 'node_modules'), (Join-Path $root '.git'), (Join-Path $root 'data\backups'))
& robocopy $root $backup /E /XD $exclude /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'Резервная копия не создана. Обновление отменено.' }

$hadLock = Test-Path (Join-Path $root 'package-lock.json')
$temp = Join-Path $env:TEMP ("globovets-update-321-" + $stamp)
New-Item -ItemType Directory -Path $temp -Force | Out-Null
$repoPath = 'standalone/globovets-local-sqlite/globovets-standalone-3.2.1'
$baseUrl = 'https://raw.githubusercontent.com/sourand365/prodivan-shop/main/' + $repoPath + '/'

try {
  [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
  foreach ($file in $required) {
    Write-Host ('Скачиваю ' + $file + '...')
    $destination = Join-Path $temp $file
    Invoke-WebRequest -UseBasicParsing -Uri ($baseUrl + $file) -OutFile $destination
    if (-not (Test-Path $destination) -or (Get-Item $destination).Length -lt 10) {
      throw ("Файл скачан пустым или повреждён: " + $file)
    }
  }

  foreach ($file in $required) {
    Copy-Item (Join-Path $temp $file) (Join-Path $root $file) -Force
  }

  Push-Location $root
  Write-Host 'Устанавливаю зависимости...' -ForegroundColor Yellow
  & npm install
  if ($LASTEXITCODE -ne 0) { throw 'npm install завершился с ошибкой.' }

  Write-Host 'Проверяю синтаксис...' -ForegroundColor Yellow
  & npm run check
  if ($LASTEXITCODE -ne 0) { throw 'Проверка npm run check не пройдена.' }
  Pop-Location

  Write-Host ''
  Write-Host 'ОБНОВЛЕНИЕ ГЛОБОВЦА 3.2.1 ЗАВЕРШЕНО!' -ForegroundColor Green
  Write-Host ('Резервная копия: ' + $backupRoot)
  Write-Host 'Файл .env и база data\globovets.sqlite не перезаписывались.'
  Write-Host 'Запуск: npm start'
}
catch {
  if ((Get-Location).Path -eq $root) { Pop-Location }
  Write-Host ''
  Write-Host ('ОШИБКА: ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host 'Восстанавливаю исходные файлы...' -ForegroundColor Yellow
  foreach ($file in $required) {
    $saved = Join-Path $backup $file
    if (Test-Path $saved) { Copy-Item $saved (Join-Path $root $file) -Force }
  }
  if ($hadLock) {
    $savedLock = Join-Path $backup 'package-lock.json'
    if (Test-Path $savedLock) { Copy-Item $savedLock (Join-Path $root 'package-lock.json') -Force }
  } else {
    Remove-Item (Join-Path $root 'package-lock.json') -Force -ErrorAction SilentlyContinue
  }
  Write-Host 'Исходные файлы восстановлены. База и .env не изменялись.'
  exit 1
}
finally {
  if (Test-Path $temp) { Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue }
}
