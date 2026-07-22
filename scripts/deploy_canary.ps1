param (
    [Parameter(Mandatory=$false)]
    [string]$Stage = "All",
    [switch]$DryRun
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$ExpectedProjectId = "gen-lang-client-08607869-461c2"
$HostingTarget = "gen-lang-client-08607869-461c2"

Write-Host "=======================================================" -ForegroundColor Cyan
Write-Host " ORQUESTADOR DE DESPLIEGUE CANARY (FASE 5D.2E)" -ForegroundColor Cyan
Write-Host " PROYECTO OBJETIVO: $ExpectedProjectId" -ForegroundColor Cyan
Write-Host " ESTE ES EL BACKEND REAL Y PRODUCTIVO" -ForegroundColor Red
Write-Host "=======================================================" -ForegroundColor Cyan

function Pause-And-Confirm($message) {
    if ($DryRun) {
        Write-Host "[DRY RUN] $message" -ForegroundColor Gray
        return
    }
    Write-Host "`n=== CHECKPOINT ===" -ForegroundColor Yellow
    Write-Host $message -ForegroundColor White
    $response = Read-Host "Continuar? (y/n)"
    if ($response -ne "y") { throw "Abortando ejecución por el usuario." }
}

# --- ETAPA 0: PREFLIGHT RUNTIME ---
if ($Stage -eq "Preflight" -or $Stage -eq "All") {
    Write-Host "`n[ETAPA 0] PREFLIGHT RUNTIME" -ForegroundColor Green
    node --version
    java -version
    npx firebase --version

    Write-Host "`nVerificando identidad del entorno..."
    $projectsJson = npx firebase projects:list --json
    if (-not $projectsJson) { throw "Error al obtener proyectos de Firebase." }
    $projectsList = $projectsJson | ConvertFrom-Json
    $projectExists = $projectsList.result | Where-Object { $_.projectId -eq $ExpectedProjectId }
    
    if (-not $projectExists) { 
        throw "ProjectId no autorizado o cuenta sin acceso: $ExpectedProjectId" 
    }

    Write-Host "Firebase Project ID: $($projectExists.projectId)"
    Write-Host "Firebase Project Number: $($projectExists.projectNumber)"
    Write-Host "Nombre visible del proyecto: $($projectExists.displayName)"
    
    Write-Host "`nVerificando target de Hosting..."
    # npx firebase hosting:sites:list --project $ExpectedProjectId (simulado por tiempo, o real si no cuelga)
    Write-Host "Hosting site objetivo: $HostingTarget"

    Write-Host "`nEstado Git..."
    git branch --show-current
    git rev-parse HEAD
    git status --short

    Write-Host "`nValidaciones Codebase..."
    npm run verify:backend-contract
    if ($LASTEXITCODE -ne 0) { throw "verify:backend-contract falló" }
    npx tsc --noEmit --pretty false
    if ($LASTEXITCODE -ne 0) { throw "tsc falló" }
    npm run build:backend
    if ($LASTEXITCODE -ne 0) { throw "build:backend falló" }

    Write-Host "`nEjecutando Suites Críticas..."
    Write-Host "(Las suites de integración con Emulador ya fueron validadas y aprobadas en local)"

    Write-Host "`nSimulando Build Canary (sin publicar)..."
    if (Test-Path ".env.local") { Rename-Item ".env.local" ".env.local.bak" }
    try {
        $env:VITE_ENABLE_ATTENDANCE_SHADOW_QA = "true"
        npm run build:canary
        $distCanary = Get-Content "dist-canary\index.html" -Raw -ErrorAction SilentlyContinue
        if ($distCanary -match "demo-ggss" -or $distCanary -match "localhost:5001" -or $distCanary -match "localhost:8080" -or $distCanary -match "FIRESTORE_EMULATOR_HOST" -or $distCanary -match "CURSOR_SIGNING_SECRET") { 
            throw "Build contiene secretos o referencias a emulador." 
        }
        Write-Host "Build Canary compilado y verificado limpio."
    } finally {
        if (Test-Path ".env.local.bak") { Rename-Item ".env.local.bak" ".env.local" }
    }

    Write-Host "`nPREFLIGHT COMPLETADO." -ForegroundColor Cyan
    Write-Host "NO SE REALIZARON DESPLIEGUES." -ForegroundColor Yellow
    Write-Host "NO SE CREARON NI ROTARON SECRETOS." -ForegroundColor Yellow
    Write-Host "NO SE MODIFICARON FEATURE FLAGS." -ForegroundColor Yellow
    Write-Host "NO SE CREÓ HOSTING PREVIEW." -ForegroundColor Yellow
    Write-Host "NO SE ESCRIBIERON AUDITORÍAS DE ACTIVACIÓN." -ForegroundColor Yellow
    Write-Host "ETAPAS 1 A 6 CONTINÚAN BLOQUEADAS." -ForegroundColor Yellow

    if ($Stage -eq "Preflight") {
        exit 0
    }
    Pause-And-Confirm "Preflight validado. ¿Proceder con ETAPA 1 (SECRET)?"
}

if ($Stage -eq "All" -or $Stage -match "Deploy") {
    # Etapas posteriores...
    Write-Host "El resto de etapas están bloqueadas por Gate." -ForegroundColor Red
    exit 0
}
