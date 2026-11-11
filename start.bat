@echo off
chcp 65001 >nul
cd /d "%~dp0"
if not exist "app\data" mkdir "app\data"
if exist "app\data\address.txt" del /q "app\data\address.txt"
echo Starting Study Assistant (Node.js)...
start "Study Assistant Server" /min node app\server.js
timeout /t 2 >nul
if exist "app\data\address.txt" (
  for /f "usebackq delims=" %%A in ("app\data\address.txt") do start "" "%%A"
  echo Browser opened.
) else (
  echo Server is starting. Check the minimized "Study Assistant Server" window for the URL.
)
timeout /t 3 >nul
