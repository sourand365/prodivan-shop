@echo off
chcp 65001 >nul
title Globovets updater
set "GLOBOVETS_DIR=%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0UPDATE_GLOBOVTSY.ps1"
if errorlevel 1 goto failed
echo.
echo Update finished. Press any key to close.
pause >nul
exit /b 0
:failed
echo.
echo Update failed. Read the PowerShell error above.
pause >nul
exit /b 1
