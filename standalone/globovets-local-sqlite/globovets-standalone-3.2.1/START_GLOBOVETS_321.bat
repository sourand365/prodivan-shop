@echo off
setlocal
title GLOBOVETS 3.2.1 UPDATE
echo.
echo === ОБНОВЛЕНИЕ ГЛОБОВЦА 3.2.1 ===
echo.
set "URL=https://raw.githubusercontent.com/sourand365/prodivan-shop/main/standalone/globovets-local-sqlite/globovets-standalone-3.2.1/UPDATE_GLOBOVETS_321.ps1"
set "SCRIPT=%TEMP%\UPDATE_GLOBOVETS_321.ps1"
del "%SCRIPT%" >nul 2>&1
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
echo Обновление завершено. Нажми любую клавишу.
pause >nul
exit /b 0
:failed
echo.
echo Не удалось скачать или запустить обновлятор.
pause
exit /b 1
