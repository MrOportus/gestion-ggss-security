$ErrorActionPreference = "Continue"

Write-Host "--- 1. conflictService.unit.test.ts ---"
npx vitest run lib/phase4/__tests__/conflictService.unit.test.ts

Write-Host "--- 2. transferCallable.emulator.test.ts ---"
npx vitest run lib/phase4/__tests__/transferCallable.emulator.test.ts

Write-Host "--- 3. phase4b.emulator.test.ts ---"
npx vitest run lib/phase4/__tests__/phase4b.emulator.test.ts

Write-Host "--- 4. phase4.rules.test.ts ---"
npx vitest run lib/phase4/__tests__/phase4.rules.test.ts

Write-Host "--- 5. test-concurrency-4b.cjs ---"
node scripts/test-concurrency-4b.cjs

Write-Host "--- 6. Build ---"
npm run build

Write-Host "--- 7. Typecheck ---"
npx tsc --noEmit
