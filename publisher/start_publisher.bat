@echo off
REM Manual/troubleshooting launcher - shows the log in a console window.
REM Normal operation is the "Budget OS Publisher" scheduled task, which runs
REM this headless at sign-in. That task holds a single-instance lock, so stop it
REM first:  schtasks /End /TN "Budget OS Publisher"
cd /d "%~dp0"
python publish.py
pause
