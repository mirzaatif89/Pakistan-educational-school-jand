@echo off
echo ========================================
echo School Management System - Quick Start
echo ========================================
echo.

echo [1/4] Checking MySQL Server...
timeout /t 2 /nobreak >nul

echo [2/4] Installing Dependencies...
call npm install
if %errorlevel% neq 0 (
    echo ERROR: Failed to install dependencies
    echo Please ensure Node.js is installed
    pause
    exit /b 1
)

echo.
echo [3/4] Starting Backend Server...
echo Server will run on http://localhost:3000
echo.
echo Press Ctrl+C to stop the server
echo.

node backend\server.js

pause
