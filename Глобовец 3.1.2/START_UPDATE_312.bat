@echo off
setlocal
title GLOBOVETS 3.1.2 UPDATE
echo.
echo === GLOBOVETS 3.1.2 UPDATE ===
echo.
set "SCRIPT=%TEMP%\UPDATE_GLOBOVETS_312.ps1"
echo Downloading the 3.1.2 updater...
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri 'https://raw.githubusercontent.com/sourand365/prodivan-shop/main/%D0%93%D0%BB%D0%BE%D0%B2%D0%B5%D1%86%203.1.2/UPDATE_GLOBOVTSY.ps1' -OutFile $env:TEMP\UPDATE_GLOBOVETS_312.ps1"
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
