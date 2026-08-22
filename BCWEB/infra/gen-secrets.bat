@echo off
REM Generate the .env secrets on Windows. Double-click, or run from a terminal.
REM
REM A thin launcher rather than batch doing the work: this has to read a template, match
REM commented-out keys and write UTF-8 with LF endings, and batch does none of those
REM without quoting games that break the first time a value contains a special character.
REM The logic lives in gen-secrets.ps1 beside this file.
REM
REM   gen-secrets.bat                 -> infra\compose\.env.exempletest
REM   gen-secrets.bat -DryRun         -> show what it would set, write nothing
REM   gen-secrets.bat -Force          -> replace an existing output file
REM   gen-secrets.bat -Out C:\x\.env  -> somewhere else

setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0gen-secrets.ps1" %*
set RC=%ERRORLEVEL%

REM Only pause for a double-click (no console arguments and an interactive window),
REM so the same file stays usable from a script without hanging it.
if "%~1"=="" (
  echo.
  pause
)
exit /b %RC%
