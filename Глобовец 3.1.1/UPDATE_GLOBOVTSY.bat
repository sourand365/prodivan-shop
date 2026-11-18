@echo off
chcp 65001 >nul
title Globovets updater
set "GLOBOVETS_DIR=%~dp0"

echo.
echo === GLOBOVETS 3.1.1 LAUNCHER ===
echo Downloading the latest updater from GitHub...

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12; $url='https://raw.githubusercontent.com/sourand365/prodivan-shop/main/Глобовец 3.1.1/UPDATE_GLOBOVTSY.ps1'; $tmp=Join-Path $env:TEMP 'GLOBOVETS_311_UPDATER_LATEST.ps1'; Invoke-WebRequest -UseBasicParsing -Uri $url -OutFile $tmp; $body=Get-Content -LiteralPath $tmp -Raw; if ($body -notmatch 'Downloading Globovets 3.1.1 files from GitHub') { throw 'Downloaded updater version check failed.' }; Copy-Item -LiteralPath $tmp -Destination '%~dp0UPDATE_GLOBOVTSY.ps1' -Force; Write-Host 'Updater refreshed successfully.' -ForegroundColor Green } catch { Write-Host ('LAUNCHER ERROR: ' + $_.Exception.Message) -ForegroundColor Red; exit 1 }"
if errorlevel 1 goto failed

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0UPDATE_GLOBOVTSY.ps1"
if errorlevel 1 goto failed

echo.
echo Update finished. Press any key to close.
pause >nul
exit /b 0

:failed
echo.
echo Update failed. Read the PowerShell error above.
pause
exit /b 1
