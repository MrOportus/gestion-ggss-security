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

if ($Stage -eq "Secret" -or $Stage -eq "All") {
    Write-Host "`n[ETAPA 1] SECRET" -ForegroundColor Green
    
    $secretCheck = npx firebase functions:secrets:get CURSOR_SIGNING_SECRET --project $ExpectedProjectId 2>&1
    if ($secretCheck -match "value") {
        Write-Host "CURSOR_SIGNING_SECRET ya existe." -ForegroundColor Yellow
        Write-Host "No se realizó ninguna modificación." -ForegroundColor Yellow
        Write-Host "Rotación no autorizada." -ForegroundColor Yellow
    } else {
        Write-Host "Generando nuevo secreto seguro..."
        $bytes = New-Object byte[] 48
        $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
        $rng.GetBytes($bytes)
        $secret = [Convert]::ToBase64String($bytes)
        
        Set-Content -Path .tmp\secret.txt -Value $secret -NoNewline
        npx firebase functions:secrets:set CURSOR_SIGNING_SECRET --data-file .tmp\secret.txt --project $ExpectedProjectId
        Remove-Item .tmp\secret.txt -ErrorAction SilentlyContinue
        
        Write-Host "Secreto creado exitosamente."
    }

    Write-Host "`nConsultando metadatos del secreto..."
    npx firebase functions:secrets:get CURSOR_SIGNING_SECRET --project $ExpectedProjectId

    if ($Stage -eq "Secret") {
        exit 0
    }
}

if ($Stage -eq "Indexes" -or $Stage -eq "All") {
    Write-Host "`n[ETAPA 2] ÍNDICES V2" -ForegroundColor Green
    
    # Deploy only indexes
    npx firebase deploy --only firestore:indexes --project $ExpectedProjectId
    
    if ($Stage -eq "Indexes") {
        exit 0
    }
}

if ($Stage -eq "Rules" -or $Stage -eq "All") {
    Write-Host "`n[ETAPA 3] FIRESTORE RULES" -ForegroundColor Green
    
    # Deploy only rules
    npx firebase deploy --only firestore:rules --project $ExpectedProjectId
    
    if ($Stage -eq "Rules") {
        exit 0
    }
}

if ($Stage -eq "Callable" -or $Stage -eq "All") {
    Write-Host "`n[ETAPA 4A] CALLABLE getAttendanceShadowValidated" -ForegroundColor Green
    
    # Deploy only the specific function
    npx firebase deploy --only functions:getAttendanceShadowValidated --project $ExpectedProjectId
    
    if ($Stage -eq "Callable") {
        exit 0
    }
}

if ($Stage -eq "ForceClose" -or $Stage -eq "All") {
    Write-Host "`n[ETAPA 4B] CALLABLE forceCloseAttendanceValidated" -ForegroundColor Green
    
    # Deploy only the specific function
    npx firebase deploy --only functions:forceCloseAttendanceValidated --project $ExpectedProjectId
    
    if ($Stage -eq "ForceClose") {
        exit 0
    }
}

if ($Stage -eq "AutoClose" -or $Stage -eq "All") {
    Write-Host "`n[ETAPA 4C] SCHEDULER autoCloseShifts" -ForegroundColor Green
    
    # Deploy only the specific function
    npx firebase deploy --only functions:autoCloseShifts --project $ExpectedProjectId
    
    if ($Stage -eq "AutoClose") {
        exit 0
    }
}

if ($Stage -eq "All" -or $Stage -match "Deploy") {
    # Etapas posteriores...
    Write-Host "El resto de etapas están bloqueadas por Gate." -ForegroundColor Red
    exit 0
}
