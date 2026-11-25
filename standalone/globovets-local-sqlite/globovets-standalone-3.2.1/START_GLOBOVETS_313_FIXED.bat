@echo off
setlocal
title GLOBOVETS 3.1.3 UPDATE
echo.
echo === GLOBOVETS 3.1.3 UPDATE ===
echo.
set "URL=https://raw.githubusercontent.com/sourand365/prodivan-shop/main/UPDATE_GLOBOVETS_313.ps1"
set "SCRIPT=%TEMP%\UPDATE_GLOBOVETS_313.ps1"
del "%SCRIPT%" >nul 2>&1
echo Download URL:
echo %URL%
echo.
echo Downloading the 3.1.3 updater...
where curl.exe >nul 2>&1
if not errorlevel 1 (
  curl.exe -fL --retry 2 --retry-delay 1 "%URL%" -o "%SCRIPT%"
) else (
  powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -Command "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; Invoke-WebRequest -UseBasicParsing -Uri '%URL%' -OutFile '%SCRIPT%'"
)
if errorlevel 1 goto failed
if not exist "%SCRIPT%" goto failed
for %%A in ("%SCRIPT%") do if %%~zA LSS 100 goto failed
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%SCRIPT%"
if errorlevel 1 goto failed
echo.
echo Update finished. Press any key to close.
pause >nul
exit /b 0
:failed
echo.
echo Could not download or run the updater.
echo Check the URL printed above and the error message.
pause
exit /b 1
