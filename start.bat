@echo off
cd /d "%~dp0"

start "YOLO Dataset Manager - Backend" cmd /k "cd backend && C:\Users\suyash.sunam\venvs\dm-backend\Scripts\python.exe -m uvicorn app.main:app --port 8000"
start "YOLO Dataset Manager - Frontend" cmd /k "cd frontend && npm run dev -- --host"

timeout /t 4 /nobreak >nul
start http://localhost:5173
