@echo off
setlocal
title GLOBOVETS 3.1.1 FIXED UPDATE
echo.
echo === GLOBOVETS 3.1.1 FIXED LAUNCHER ===
echo.
set "SCRIPT=%TEMP%\UPDATE_GLOBOVETS_311_FIXED.ps1"
echo Downloading the corrected updater...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/sourand365/prodivan-shop/main/UPDATE_GLOBOVETS_311_FIXED.ps1' -OutFile $env:TEMP\UPDATE_GLOBOVETS_311_FIXED.ps1"
if errorlevel 1 goto failed
if not exist "%SCRIPT%" goto failed
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
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
