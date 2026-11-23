@echo off
cd /d "%~dp0"
set "PYTHON=%LocalAppData%\Python\pythoncore-3.14-64\python.exe"
if not exist "%PYTHON%" set "PYTHON=python"
title Cinema AI

if not exist "%~dp0frontend\dist\index.html" (
  where npm >nul 2>nul
  if not errorlevel 1 (
    echo Building React frontend...
    pushd "%~dp0frontend"
    if not exist "node_modules\" call npm install
    call npm run build
    popd
  ) else (
    echo npm not found — install Node.js so start.bat can build the React UI.
  )
)

"%PYTHON%" "%~dp0server.py"
pause