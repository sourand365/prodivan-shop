$ErrorActionPreference = 'Stop'
$root = [Environment]::GetEnvironmentVariable('GLOBOVETS_DIR')
if (-not $root) { $root = (Get-Location).Path }
$root = (Resolve-Path $root).Path
Write-Host ''
Write-Host '=== ОБНОВЛЕНИЕ ГЛОБОВЦЕВ ===' -ForegroundColor Cyan
Read-Host 'Сначала останови бота (Ctrl+C в его окне), затем нажми Enter'
if (-not (Test-Path (Join-Path $root 'package.json')) -or -not (Test-Path (Join-Path $root 'index.js'))) {
  $entered = Read-Host 'Укажи полный путь к папке globovets-standalone'
  if (-not $entered -or -not (Test-Path (Join-Path $entered 'package.json'))) { throw 'Папка проекта не найдена.' }
  $root = (Resolve-Path $entered).Path
}
$required = @(
  'index.js',
  'legacy.js',
  'package.json',
  'assets\complaint-audio-01.b64',
  'assets\complaint-audio-02.b64',
  'assets\complaint-audio-03.b64',
  'assets\complaint-audio-04a.b64',
  'assets\complaint-audio-04b.b64',
  'assets\complaint-audio-04c.b64'
)
$coreRequired = @('index.js','legacy.js','package.json')
foreach ($file in $coreRequired) { if (-not (Test-Path (Join-Path $root $file))) { throw "В папке проекта отсутствует $file" } }
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$backupRoot = Join-Path (Split-Path $root -Parent) ("globovets-backup-" + $stamp)
$backup = Join-Path $backupRoot 'project'
New-Item -ItemType Directory -Path $backup -Force | Out-Null
Write-Host 'Создаю резервную копию проекта...' -ForegroundColor Yellow
$exclude = @((Join-Path $root 'node_modules'), (Join-Path $root '.git'), (Join-Path $root 'data\backups'))
& robocopy $root $backup /E /XD $exclude /R:1 /W:1 /NFL /NDL /NJH /NJS | Out-Null
if ($LASTEXITCODE -ge 8) { throw 'Не удалось создать резервную копию. Обновление отменено.' }
$hadLock = Test-Path (Join-Path $root 'package-lock.json')
$temp = Join-Path $env:TEMP ("globovets-update-" + $stamp)
New-Item -ItemType Directory -Path $temp -Force | Out-Null
$base = 'https://raw.githubusercontent.com/sourand365/prodivan-shop/24716847e061294fa8f597e0e4f06db40103a8b7/globovets-standalone/'
try {
  Write-Host 'Скачиваю файлы обновления из GitHub...' -ForegroundColor Yellow
  foreach ($file in $required) {
    $relativeUrl = $file -replace '\\','/'
    $tempFile = Join-Path $temp $file
    New-Item -ItemType Directory -Path (Split-Path $tempFile -Parent) -Force | Out-Null
    Invoke-WebRequest -Uri ($base + $relativeUrl) -OutFile $tempFile -UseBasicParsing
    if ((Get-Item $tempFile).Length -lt 10) { throw "Получен пустой или повреждённый файл: $file" }
  }
  foreach ($file in $required) {
    $source = Join-Path $temp $file
    $destination = Join-Path $root $file
    New-Item -ItemType Directory -Path (Split-Path $destination -Parent) -Force | Out-Null
    Copy-Item $source $destination -Force
  }
  Write-Host 'Устанавливаю зависимости...' -ForegroundColor Yellow
  Push-Location $root
  & npm install
  if ($LASTEXITCODE -ne 0) { throw 'npm install завершился с ошибкой.' }
  Write-Host 'Проверяю синтаксис файлов...' -ForegroundColor Yellow
  & npm run check
  if ($LASTEXITCODE -ne 0) { throw 'Проверка npm run check не пройдена.' }
  Pop-Location
  Write-Host ''
  Write-Host 'ОБНОВЛЕНИЕ УСПЕШНО ЗАВЕРШЕНО!' -ForegroundColor Green
  Write-Host 'Резервная копия: ' $backupRoot
  Write-Host 'Файл .env и база data\globovets.sqlite не перезаписывались.'
  Write-Host 'Перезапусти бота командой npm start.'
} catch {
  if ((Get-Location).Path -eq $root) { Pop-Location }
  Write-Host ''
  Write-Host ('ОШИБКА: ' + $_.Exception.Message) -ForegroundColor Red
  Write-Host 'Возвращаю исходные файлы из резервной копии...' -ForegroundColor Yellow
  foreach ($file in $required) {
    $saved = Join-Path $backup $file
    if (Test-Path $saved) { Copy-Item $saved (Join-Path $root $file) -Force }
  }
  $savedLock = Join-Path $backup 'package-lock.json'
  if ($hadLock -and (Test-Path $savedLock)) { Copy-Item $savedLock (Join-Path $root 'package-lock.json') -Force }
  elseif (-not $hadLock) { Remove-Item (Join-Path $root 'package-lock.json') -Force -ErrorAction SilentlyContinue }
  Write-Host 'Исходные index.js, legacy.js и package.json восстановлены.'
  Write-Host 'База SQLite и .env не изменялись.'
  exit 1
} finally {
  if (Test-Path $temp) { Remove-Item $temp -Recurse -Force -ErrorAction SilentlyContinue }
}
