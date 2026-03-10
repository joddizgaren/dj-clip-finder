@echo off
title DJ Clip Studio
cd /d "%~dp0"

echo.
echo  ============================================
echo   DJ Clip Studio — Starting...
echo  ============================================
echo.
echo  The browser will open automatically in 8 seconds.
echo  Keep this window open while using the app.
echo  Close it to stop the server.
echo.

:: Open browser after 8 seconds (background, no extra window)
start /b "" cmd /c "timeout /t 8 /nobreak > nul && start http://localhost:5000"

:: Start the server in this window
set NODE_ENV=development
npx tsx --env-file=.env server/index.ts
