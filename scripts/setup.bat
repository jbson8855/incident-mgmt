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
echo Opening Windows Firewall port 3001 (for access from other devices)...
netsh advfirewall firewall show rule name="Incident Mgmt (3001)" >nul 2>nul
if errorlevel 1 (
    netsh advfirewall firewall add rule name="Incident Mgmt (3001)" dir=in action=allow protocol=TCP localport=3001 >nul 2>nul
    if errorlevel 1 (
        echo [WARN] Could not add the firewall rule automatically ^(admin rights required^).
        echo        Right-click setup.bat and "Run as administrator", or add the rule manually:
        echo        netsh advfirewall firewall add rule name="Incident Mgmt (3001)" dir=in action=allow protocol=TCP localport=3001
    ) else (
        echo Firewall rule added.
    )
) else (
    echo Firewall rule already exists.
)

echo.
echo Done. Double-click the desktop icon to launch the app.
echo Other devices on the same network can connect using this PC's LAN IP shown when the app starts.
pause
