@echo off
setlocal
set "PROJECT_DIR=%~dp0.."

echo ============================================
echo  Incident Mgmt Setup
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
    echo [ERROR] Node.js is not installed.
    echo Install the LTS version from https://nodejs.org and run this again.
    pause
    exit /b 1
)

echo Node.js version:
node -v
echo.

echo Installing packages (npm install)...
cd /d "%PROJECT_DIR%"
call npm install
if errorlevel 1 (
    echo [ERROR] npm install failed.
    pause
    exit /b 1
)

echo.
echo Creating desktop shortcut...
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0create-shortcut.ps1"

echo.
echo Done. Double-click the desktop icon to launch the app.
pause
