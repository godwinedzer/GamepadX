@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0check_requirements.ps1"
exit /b %ERRORLEVEL%
