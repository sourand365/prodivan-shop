@echo off
chcp 65001 >nul
title Обновление Глобовцев
set "GLOBOVETS_DIR=%~dp0"
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%~dp0UPDATE_GLOBOVTSY.ps1"
echo.
if errorlevel 1 (
  echo Обновление завершилось с ошибкой. Смотри сообщение выше.
) else (
  echo Готово. Нажми любую клавишу для выхода.
)
pause >nul
