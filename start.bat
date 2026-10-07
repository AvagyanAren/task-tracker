@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo === Tempo - трекер времени ===
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ОШИБКА] Node.js не найден.
  echo Установите LTS-версию с https://nodejs.org и запустите этот файл заново.
  echo.
  pause
  exit /b 1
)

echo Проверяю зависимости (первый раз или после обновления - 1-2 минуты)...
call npm install --no-audit --no-fund
if errorlevel 1 (
  echo.
  echo [ОШИБКА] npm install не удался. Скопируйте текст выше.
  pause
  exit /b 1
)

echo.
echo Собираю интерфейс...
call npm run build
if errorlevel 1 (
  echo.
  echo [ОШИБКА] Не удалось собрать интерфейс. Скопируйте текст выше.
  pause
  exit /b 1
)

echo.
echo Трекер запущен: http://localhost:4321
echo НЕ ЗАКРЫВАЙТЕ это окно - пока оно открыто, трекер работает.
echo Данные хранятся в файле data\tracker.json (копия - data\tracker.json.bak)
echo Остановить: Ctrl+C
echo.
start "" http://localhost:4321
call npm start
pause
