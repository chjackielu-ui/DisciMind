@echo off
chcp 65001 >nul
setlocal
title DisciMind - 一键启动
set "PROJECT_ROOT=%~dp0"

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_ROOT%scripts\judge-package\Start-DisciMind.ps1"
set "START_EXIT_CODE=%ERRORLEVEL%"

if not "%START_EXIT_CODE%"=="0" (
  echo.
  echo [失败] DisciMind 未能启动，请根据上方中文提示处理后重试。
  echo 运行日志位于 .judge-runtime\logs 目录。
  echo.
  pause
  exit /b %START_EXIT_CODE%
)

timeout /t 2 /nobreak >nul
exit /b 0
