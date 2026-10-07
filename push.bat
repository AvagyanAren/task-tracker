@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo === Otpravka Tempo na GitHub ===
echo.

where git >nul 2>nul
if errorlevel 1 goto nogit

if exist ".git" goto hasrepo
echo Pervyj raz: sozdayu lokalnyj repozitorij...
git init -b main
if errorlevel 1 goto initfallback
goto hasrepo

:initfallback
git init
git checkout -b main

:hasrepo
git remote remove origin >nul 2>nul
git remote add origin https://github.com/AvagyanAren/task-tracker.git

echo Ne popadut v repozitorij: data\tracker.json, data\toggl-sample.csv, node_modules, dist
echo.

git add -A
git diff --cached --quiet
if not errorlevel 1 goto nocommit

set "MSG=%~1"
if "%MSG%"=="" set "MSG=Tempo - treker vremeni"
git commit -m "%MSG%"
if errorlevel 1 goto commitfail

:nocommit
git push -u origin main
if errorlevel 1 goto pushfail

echo.
echo GOTOVO: https://github.com/AvagyanAren/task-tracker
goto end

:nogit
echo [OSHIBKA] Git ne najden. Ustanovite: https://git-scm.com/download/win
goto end

:commitfail
echo.
echo [OSHIBKA] Ne udalos sozdat kommit. Esli Git prosit imya i pochtu, vypolnite:
echo   git config --global user.name "Your Name"
echo   git config --global user.email "you@example.com"
echo i zapustite push.bat eshyo raz.
goto end

:pushfail
echo.
echo [OSHIBKA] Push ne proshyol. Skopirujte tekst vyshe i prishlite mne.

:end
echo.
pause
