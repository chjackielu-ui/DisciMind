@echo off
chcp 65001 >nul
setlocal
title DisciMind - 一键停止
set "PROJECT_ROOT=%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_ROOT%scripts\judge-package\Stop-DisciMind.ps1"
set "STOP_EXIT_CODE=%ERRORLEVEL%"

if not "%STOP_EXIT_CODE%"=="0" pause
exit /b %STOP_EXIT_CODE%
