@echo off
REM Pokemon VNPET - Quick Start Script with Chat Feature (Windows)

echo 🎮 Pokemon VNPET - Starting with Chat Feature...
echo.

REM Check if Node.js is installed
where node >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ❌ Node.js is not installed. Please install Node.js first.
    pause
    exit /b 1
)

echo ✅ Node.js is installed
node -v
echo.

REM Setup Server
echo 📦 Setting up Server...
cd apps\server

if not exist ".env" (
    echo ⚠️  No .env file found. Creating from .env.example...
    copy .env.example .env
    echo    Please edit apps\server\.env with your configuration
)

if not exist "node_modules" (
    echo 📥 Installing server dependencies...
    call npm install
) else (
    echo ✅ Server dependencies already installed
)

cd ..\..

REM Setup Client
echo.
echo 📦 Setting up Client...
cd apps\client

if not exist ".env" (
    echo ⚠️  No .env file found. Creating from .env.example...
    copy .env.example .env
)

if not exist "node_modules" (
    echo 📥 Installing client dependencies...
    call npm install
) else (
    echo ✅ Client dependencies already installed
)

cd ..\..

REM Start both server and client
echo.
echo 🚀 Starting server and client...
echo.
echo    Server: http://localhost:5000
echo    Client: http://localhost:5173
echo.
echo 💬 Chat feature is enabled!
echo.
echo Press Ctrl+C to stop both servers
echo.

REM Start using npm workspaces
call npm run dev

echo.
echo 👋 Servers stopped. Goodbye!
pause
