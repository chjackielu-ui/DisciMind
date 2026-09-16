@echo off
chcp 65001 >nul
setlocal
title DisciMind - 一键部署
set "PROJECT_ROOT=%~dp0"

echo.
echo ================================================================
echo   DisciMind（学研智擎）评委版一键部署
echo ================================================================
echo   将自动准备便携环境、数据库、依赖、演示数据和可用的 Judge0。
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_ROOT%scripts\judge-package\Install-Environment.ps1"
set "DEPLOY_EXIT_CODE=%ERRORLEVEL%"

if not "%DEPLOY_EXIT_CODE%"=="0" (
  echo.
  echo [失败] 部署未完成，请查看 .judge-runtime\logs\install-environment.log
  pause
  exit /b %DEPLOY_EXIT_CODE%
)

echo.
echo [完成] 现在可以双击“一键启动.bat”。
pause
exit /b 0
