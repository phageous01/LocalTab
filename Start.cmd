@echo off
cd /d "%~dp0"
set "BUNDLED_PY=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
if exist "%BUNDLED_PY%" (
  "%BUNDLED_PY%" server.py --host 0.0.0.0 --port 8767 --open
) else (
  py -3 server.py --host 0.0.0.0 --port 8767 --open
)
pause
