@echo off
setlocal

cd /d "%~dp0"

if not exist "%~dp0iniciar-app.vbs" (
  echo ERROR: Falta iniciar-app.vbs
  pause
  exit /b 1
)

start "" wscript "%~dp0iniciar-app.vbs"

endlocal
