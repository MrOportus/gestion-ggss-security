@echo off
set PATH=C:\Program Files\Eclipse Adoptium\jdk-17.0.6.10-hotspot\bin;%PATH%

echo Running crossBranchConflict unit tests...
call npx vitest run lib/phase4/__tests__/crossBranchConflict.unit.test.ts
if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%

echo Running saveProgramacionValidated emulator tests...
call npx firebase emulators:exec "npx vitest run lib/phase5/__tests__/saveProgramacionValidated.emulator.test.ts" --only firestore,functions --project demo-ggss
if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%

echo Running rules tests...
call npx firebase emulators:exec "npx vitest run lib/phase5/__tests__/hotfix5c1_featureflags.rules.test.ts" --only firestore --project demo-ggss
if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%

echo Running build...
call npm run build
if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%

echo Running tsc...
call npx tsc --noEmit --pretty false
if %ERRORLEVEL% neq 0 exit /b %ERRORLEVEL%

echo ALL DONE SUCCESSFULLY.
