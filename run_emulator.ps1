$ErrorActionPreference = "Stop"
$env:JAVA_HOME = "$PWD\.tmp\jdk-17.0.2"
$env:PATH = "$env:JAVA_HOME\bin;$env:PATH"

Write-Host "Checking Java version..."
java -version

Write-Host "Checking Firebase CLI version..."
npx firebase --version

Write-Host "Running Firebase Emulator Suite with Vitest sequentially..."
npx firebase emulators:exec --project demo-ggss --only firestore,functions,auth "npx vitest run --no-file-parallelism crossBranchConflict saveProgramacionValidated shadowAttendanceResolver nocturnalClosure phase5b5_autoclose.emulator.test.ts forceCloseAttendance.emulator.test.ts phase5b5_rules.emulator.test.ts"
