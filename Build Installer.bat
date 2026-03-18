@echo off
echo ================================================
echo   DJ Clip Studio -- Build Windows Installer
echo ================================================
echo.

:: Check Node.js is installed
node --version >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo ERROR: Node.js is not installed.
    echo Download from https://nodejs.org and install, then re-run this script.
    pause
    exit /b 1
)

echo [1/3] Installing dependencies...
call npm install
if %ERRORLEVEL% neq 0 (
    echo ERROR: npm install failed.
    pause
    exit /b 1
)

echo.
echo [2/3] Building and packaging installer...
echo This may take several minutes on first run.
echo.
call npx tsx script/build.electron.ts
if %ERRORLEVEL% neq 0 (
    echo.
    echo ERROR: Build failed. See error above.
    pause
    exit /b 1
)

echo.
echo [3/3] Done!
echo ================================================
echo   Installer ready in the  release\  folder.
echo   Share  "DJ Clip Studio Setup 1.0.0.exe"
echo ================================================
echo.
pause
