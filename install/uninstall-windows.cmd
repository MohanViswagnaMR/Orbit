@echo off
rem Double-click to remove Orbit from Windows. Your data is kept.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0uninstall.ps1"
echo.
pause
