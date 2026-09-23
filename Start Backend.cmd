@echo off
cd /d "%~dp0backend"
if not exist ".venv\Scripts\python.exe" python -m venv .venv
if not exist ".venv\Scripts\python.exe" goto failed
".venv\Scripts\python.exe" -m pip install -r requirements.txt
if errorlevel 1 goto failed
".venv\Scripts\python.exe" run.py --demo-feed
pause
exit /b
:failed
echo Setup failed. Install Python 3.14 and check your internet connection.
pause
exit /b 1
