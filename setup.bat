@echo off
setlocal enabledelayedexpansion

:: ============================================================
:: AI Character Engine — Windows Setup
:: ============================================================
:: One-click setup: installs dependencies, detects your LLM
:: provider, and generates engine.config.json.
::
:: Usage: setup.bat
:: ============================================================

echo.
echo  ========================================
echo   AI Character Engine - Setup
echo  ========================================
echo.

:: ------------------------------------------------------------
:: Step 1: Check Node.js
:: ------------------------------------------------------------
echo [1/5] Checking Node.js...

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo.
    echo  ERROR: Node.js is not installed or not in PATH.
    echo.
    echo  Download Node.js 20+ from: https://nodejs.org
    echo  After installing, restart your terminal and run setup.bat again.
    echo.
    goto :end
)

for /f "tokens=1 delims=v" %%a in ('node --version') do set NODE_VER=%%a
for /f "tokens=1 delims=." %%a in ('node --version') do set NODE_MAJOR=%%a
set NODE_MAJOR=%NODE_MAJOR:v=%

if %NODE_MAJOR% lss 20 (
    echo.
    echo  ERROR: Node.js %NODE_VER% is too old. Version 20+ is required.
    echo  Download from: https://nodejs.org
    echo.
    goto :end
)

echo  Found Node.js %NODE_MAJOR% - OK

:: ------------------------------------------------------------
:: Step 2: Install dependencies
:: ------------------------------------------------------------
echo.
echo [2/5] Installing dependencies...

call npm install
if %errorlevel% neq 0 (
    echo.
    echo  ERROR: npm install failed.
    echo.
    echo  Common fix for better-sqlite3 build errors on Windows:
    echo    1. Install Visual Studio Build Tools:
    echo       https://visualstudio.microsoft.com/visual-cpp-build-tools/
    echo    2. Select "Desktop development with C++" workload
    echo    3. Run setup.bat again
    echo.
    goto :end
)

echo  Dependencies installed - OK

:: ------------------------------------------------------------
:: Step 3: Build TypeScript
:: ------------------------------------------------------------
echo.
echo [3/5] Building TypeScript...

call npm run build
if %errorlevel% neq 0 (
    echo.
    echo  ERROR: TypeScript build failed. Check the errors above.
    echo.
    goto :end
)

echo  Build complete - OK

:: ------------------------------------------------------------
:: Step 4: Detect inference provider
:: ------------------------------------------------------------
echo.
echo [4/5] Detecting LLM provider...

set PROVIDER=none
set PROVIDER_NAME=
set PROVIDER_URL=
set PROVIDER_MODEL_HEAVY=default
set PROVIDER_MODEL_MID=default
set PROVIDER_MODEL_LIGHT=default
set PROVIDER_CONCURRENCY=10
set PROVIDER_TIMEOUT=30000

:: Check vLLM (port 8100)
echo  Checking vLLM on port 8100...
powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://127.0.0.1:8100/health' -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel% equ 0 (
    set PROVIDER=vllm
    set PROVIDER_NAME=vLLM
    set PROVIDER_URL=http://127.0.0.1:8100/v1
    set PROVIDER_MODEL_HEAVY=default
    set PROVIDER_MODEL_MID=default
    set PROVIDER_MODEL_LIGHT=default
    set PROVIDER_CONCURRENCY=64
    set PROVIDER_TIMEOUT=60000
    echo  Found vLLM - DETECTED
    goto :provider_found
)

:: Check Ollama (port 11434)
echo  Checking Ollama on port 11434...
powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:11434/v1/models' -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel% equ 0 (
    set PROVIDER=ollama
    set PROVIDER_NAME=Ollama
    set PROVIDER_MODEL_HEAVY=qwen2.5:7b
    set PROVIDER_MODEL_MID=qwen2.5:7b
    set PROVIDER_MODEL_LIGHT=qwen2.5:1.5b
    set PROVIDER_CONCURRENCY=10
    set PROVIDER_TIMEOUT=30000
    echo  Found Ollama - DETECTED
    goto :provider_found
)

:: Check LM Studio (port 1234)
echo  Checking LM Studio on port 1234...
powershell -Command "try { $r = Invoke-WebRequest -Uri 'http://localhost:1234/v1/models' -TimeoutSec 3 -UseBasicParsing -ErrorAction Stop; exit 0 } catch { exit 1 }" >nul 2>&1
if %errorlevel% equ 0 (
    set PROVIDER=lmstudio
    set PROVIDER_NAME=LM Studio
    set PROVIDER_URL=http://localhost:1234/v1
    set PROVIDER_MODEL_HEAVY=default
    set PROVIDER_MODEL_MID=default
    set PROVIDER_MODEL_LIGHT=default
    set PROVIDER_CONCURRENCY=4
    set PROVIDER_TIMEOUT=30000
    echo  Found LM Studio - DETECTED
    goto :provider_found
)

:: No provider found — guide user
echo.
echo  No LLM provider detected.
echo.
echo  The easiest way to get started is with Ollama:
echo    1. Download from https://ollama.com
echo    2. Run: ollama pull qwen2.5:7b
echo    3. Run setup.bat again
echo.
echo  Or for maximum performance, use vLLM:
echo    1. pip install vllm
echo    2. python -m vllm.entrypoints.openai.api_server --model Salesforce/xLAM-2-1b-fc-r --port 8100
echo    3. Run setup.bat again
echo.

set /p WAIT_CHOICE="Install Ollama and continue? (y/n): "
if /i "!WAIT_CHOICE!" neq "y" goto :end

echo.
echo  Please install Ollama from https://ollama.com
echo  Then run: ollama pull qwen2.5:7b
echo  Then run setup.bat again.
echo.
goto :end

:provider_found

:: ------------------------------------------------------------
:: Step 5: Generate config
:: ------------------------------------------------------------
echo.
echo [5/5] Generating engine.config.json...

if exist engine.config.json (
    echo  engine.config.json already exists — skipping.
    echo  Delete it and re-run setup.bat to regenerate.
    goto :success
)

:: Generate the config file
if "%PROVIDER%"=="vllm" (
    (
        echo {
        echo   "database": { "path": "./data/engine.db" },
        echo   "inference": {
        echo     "type": "vllm",
        echo     "baseUrl": "%PROVIDER_URL%",
        echo     "models": { "heavy": "default", "mid": "default", "light": "default" },
        echo     "maxConcurrency": 64,
        echo     "timeoutMs": 60000,
        echo     "maxRetries": 2
        echo   },
        echo   "logging": { "level": "info", "pretty": true }
        echo }
    ) > engine.config.json
) else if "%PROVIDER%"=="ollama" (
    (
        echo {
        echo   "database": { "path": "./data/engine.db" },
        echo   "inference": {
        echo     "type": "ollama",
        echo     "models": { "heavy": "qwen2.5:7b", "mid": "qwen2.5:7b", "light": "qwen2.5:1.5b" },
        echo     "maxConcurrency": 10,
        echo     "timeoutMs": 30000,
        echo     "maxRetries": 2
        echo   },
        echo   "logging": { "level": "info", "pretty": true }
        echo }
    ) > engine.config.json
) else if "%PROVIDER%"=="lmstudio" (
    (
        echo {
        echo   "database": { "path": "./data/engine.db" },
        echo   "inference": {
        echo     "type": "lmstudio",
        echo     "baseUrl": "%PROVIDER_URL%",
        echo     "models": { "heavy": "default", "mid": "default", "light": "default" },
        echo     "maxConcurrency": 4,
        echo     "timeoutMs": 30000,
        echo     "maxRetries": 2
        echo   },
        echo   "logging": { "level": "info", "pretty": true }
        echo }
    ) > engine.config.json
)

echo  Generated engine.config.json for %PROVIDER_NAME%

:success

:: ------------------------------------------------------------
:: Done!
:: ------------------------------------------------------------
echo.
echo  ========================================
echo   Setup Complete!
echo  ========================================
echo.
echo  Provider: %PROVIDER_NAME%
echo.
echo  Next steps:
echo    1. Run the starter demo:
echo       npm run demo:starter
echo.
echo    2. Run the tavern sample:
echo       npm run demo:sample
echo.
echo    3. Read the quick-start guide:
echo       QUICKSTART.md
echo.
echo    4. Start the HTTP API (for non-Node.js games):
echo       npm run demo:api
echo.

:end
endlocal
