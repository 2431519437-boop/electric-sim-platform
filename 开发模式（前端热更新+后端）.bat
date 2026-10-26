@echo off
title Electric Sim Platform - DEV (5173 + 3001)
cd /d "%~dp0"

set "NODE="
if exist "D:\hclaw\node\node.exe" set "NODE=D:\hclaw\node\node.exe"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE (
  where node >nul 2>nul
  if not errorlevel 1 set "NODE=node"
)
if not defined NODE (
  echo   [错误] 没找到可用的 Node.js（需要 22 或更高版本）。
  pause
  exit /b 1
)

echo.
echo   开发模式：后端 3001 + 前端热更新 5173
echo   Node: %NODE%
echo.

netstat -ano | findstr /R /C:":3001 .*LISTENING" >nul 2>nul
if errorlevel 1 (
  echo   正在新窗口启动后端 3001 ...
  start "backend-3001" cmd /k ""%NODE%" --no-warnings server\index.js"
  ping -n 4 127.0.0.1 >nul
) else (
  echo   后端 3001 已在运行，复用现有实例。
)

echo   正在启动前端 dev（本窗口，改代码自动刷新）...
echo   打开地址： http://127.0.0.1:5173
echo   关闭本窗口等于停止前端。
echo.
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 3; Start-Process 'http://127.0.0.1:5173'"
"%NODE%" node_modules\vite\bin\vite.js

echo.
echo   前端已停止。按任意键关闭。
pause >nul