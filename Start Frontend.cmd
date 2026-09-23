@echo off
cd /d "%~dp0frontend"
if not exist "..\backend\data\api-key.txt" (
 echo Start Backend.cmd first and wait for the backend to start.
 pause
 exit /b 1
)
echo Open http://localhost:3002 in your browser after the server starts.
node server.mjs
pause
