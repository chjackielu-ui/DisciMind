@echo off
chcp 65001 >nul
setlocal
title DisciMind - 一键安装环境
set "PROJECT_ROOT=%~dp0"

echo.
echo ================================================================
echo   DisciMind（学研智擎）评委版环境安装
echo ================================================================
echo   首次安装需要连接互联网，通常需要 10 至 30 分钟。
echo   运行环境只会写入当前项目目录，不会修改系统 PATH。
echo.

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File "%PROJECT_ROOT%scripts\judge-package\Install-Environment.ps1"
set "INSTALL_EXIT_CODE=%ERRORLEVEL%"

if not "%INSTALL_EXIT_CODE%"=="0" (
  echo.
  echo [失败] 环境安装未完成，请根据上方中文提示处理后重试。
  echo 安装日志位于 .judge-runtime\logs\install-environment.log
  echo.
  pause
  exit /b %INSTALL_EXIT_CODE%
)

echo.
echo [完成] 请关闭本窗口，然后双击“一键启动.bat”。
echo.
pause
exit /b 0
