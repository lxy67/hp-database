@echo off
setlocal enabledelayedexpansion

echo ========================================
echo   HP Database Setup Script
echo ========================================
echo.

:: Check if psql is installed
where psql >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] PostgreSQL (psql) is not installed or not in PATH
    pause
    exit /b 1
)

:: Check if Python is installed
python --version >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Python is not installed or not in PATH
    pause
    exit /b 1
)

:: Check if required Python packages are installed
echo Checking Python dependencies...
pip install -r requirements.txt
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to install Python dependencies
    pause
    exit /b 1
)

:: Create database if it doesn't exist
echo.
echo Creating database...
psql -U postgres -c "SELECT 1 FROM pg_database WHERE datname = 'hpdata'" | find "1" >nul
if %ERRORLEVEL% neq 0 (
    echo Creating new database 'hpdata'...
    psql -U postgres -c "CREATE DATABASE hpdata;"
    if %ERRORLEVEL% neq 0 (
        echo [ERROR] Failed to create database
        pause
        exit /b 1
    )
) else (
    echo Database 'hpdata' already exists
)

:: Initialize database schema
echo.
echo Initializing database schema...
psql -U postgres -d hpdata -f init_db.sql
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to initialize database schema
    pause
    exit /b 1
)

:: Import data from CSV
echo.
echo Importing data from CSV...
python import_data.py
if %ERRORLEVEL% neq 0 (
    echo [ERROR] Failed to import data from CSV
    pause
    exit /b 1
)

echo.
echo ========================================
echo   Setup completed successfully!
echo   You can now start the server with:
echo   npm start
echo ========================================
echo.

pause
