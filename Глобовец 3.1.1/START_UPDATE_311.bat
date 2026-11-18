@echo off
echo.
echo === GLOBOVETS 3.1.1 UPDATE LAUNCHER ===
echo.
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "UPDATE_GLOBOVTSY.ps1"
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
