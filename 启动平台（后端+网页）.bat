@echo off
title Electric Sim Platform (:3001)
cd /d "%~dp0"

rem ================= 1) 已经在运行就直接打开浏览器 =================
netstat -ano | findstr /R /C:":3001 .*LISTENING" >nul 2>nul
if not errorlevel 1 (
  echo.
  echo   服务已经在运行：http://127.0.0.1:3001
  echo   无需重复启动，正在为你打开浏览器...
  echo.
  echo   如果页面打不开，说明旧实例已失效，先结束它再运行本文件：
  echo     taskkill /F /IM node.exe
  echo.
  start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 1; Start-Process 'http://127.0.0.1:3001'"
  ping -n 4 127.0.0.1 >nul
  exit /b 0
)

rem ================= 2) 找可用的 Node.js =================
set "NODE="
if exist "D:\hclaw\node\node.exe" set "NODE=D:\hclaw\node\node.exe"
if not defined NODE if exist "%ProgramFiles%\nodejs\node.exe" set "NODE=%ProgramFiles%\nodejs\node.exe"
if not defined NODE (
  where node >nul 2>nul
  if not errorlevel 1 set "NODE=node"
)
if not defined NODE (
  echo.
  echo   [错误] 没找到可用的 Node.js（需要 22 或更高版本）。
  echo   请先安装 Node.js 22 LTS： https://nodejs.org
  echo.
  pause
  exit /b 1
)

echo.
echo   Node 路径 : %NODE%
for /f "delims=" %%v in ('"%NODE%" -v') do echo   Node 版本 : %%v
echo.

rem ================= 3) 首次运行先构建前端 =================
if not exist "dist\index.html" (
  echo   首次运行，正在构建前端，请稍候（约 30 秒）...
  "%NODE%" node_modules\vite\bin\vite.js build
  if errorlevel 1 (
    echo.
    echo   [错误] 前端构建失败，请检查上面的报错信息。
    pause
    exit /b 1
  )
  echo.
)

rem ================= 4) 启动后端 =================
echo   正在启动： http://127.0.0.1:3001
echo   使用期间请不要关闭本窗口；关掉本窗口等于停止服务。
echo.
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://127.0.0.1:3001'"
"%NODE%" server\index.js

echo.
echo   服务已退出。按任意键关闭本窗口。
pause >nul