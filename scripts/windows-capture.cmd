@echo off
rem MarsCity: install (first time), build, self-check and run the remaining convergence capture on Windows.
rem Double-click, or run from a terminal. Progress: shots\final-capture-converge.log. Stop: create shots\final\STOP
cd /d "%~dp0.."
if not exist node_modules\vite\package.json (
  call npm ci
  if errorlevel 1 goto fail
)
call npm run build
if errorlevel 1 goto fail
node scripts\check-env.mjs
if errorlevel 1 goto fail
node scripts\converge-batch.mjs --serve --groups scripts\converge-remaining.json --passes 2 --gpu NVIDIA
if errorlevel 1 goto fail
echo.
echo Done. See shots\final-capture-converge.log and shots\final\report.json
pause
exit /b 0
:fail
echo.
echo Stopped because of the error above. Fix it and run this file again; finished shots are kept.
pause
exit /b 1
