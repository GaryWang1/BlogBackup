@echo off
setlocal
cd /d "%~dp0"

set "ROOT=%~dp0"
set "NODE_EXE=%ROOT%app\runtime\node\node.exe"
set "PLAYWRIGHT_BROWSERS_PATH=%ROOT%app\browsers"
set "NODE_ENV=production"
set "BLOG_BACKUP_PORT=3000"

title Blog Backup Tool

if not exist "%NODE_EXE%" (
  where node >nul 2>nul
  if errorlevel 1 (
    echo Blog Backup cannot start because the portable Node runtime is missing:
    echo %NODE_EXE%
    echo.
    echo Rebuild the portable ZIP by running tools\build-portable.ps1 from the project folder.
    echo.
    pause
    exit /b 1
  )
  set "NODE_EXE=node"
)

echo Starting Blog Backup Tool...
echo The web interface will open at http://localhost:3000
echo.

"%NODE_EXE%" "%ROOT%app\server\server.js"

echo.
echo Blog Backup Tool stopped.
pause
