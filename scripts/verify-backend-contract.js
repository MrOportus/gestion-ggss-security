import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';

// This script verifies that the compiled backend contract matches the source.
// It compiles to a temp directory and compares.

const TEMP_DIR = path.join(process.cwd(), '.tmp-verify-contract');
const SOURCE = path.join(process.cwd(), 'lib/phase5d2/manualAttendanceV2/index.ts');
const TARGET = path.join(process.cwd(), 'functions/src/phase5d2/manualAttendanceV2/index.js');

try {
  console.log('Building contract to temp directory...');
  execSync(`npx tsc "${SOURCE}" --outDir "${TEMP_DIR}" --module commonjs --target es2020 --declaration false --skipLibCheck`, {
    cwd: process.cwd(),
    stdio: 'inherit'
  });

  const tempFile = path.join(TEMP_DIR, 'index.js');
  
  if (!fs.existsSync(TARGET)) {
    console.error(`Target file does not exist: ${TARGET}`);
    process.exit(1);
  }
  
  const original = fs.readFileSync(TARGET, 'utf-8');
  const compiled = fs.readFileSync(tempFile, 'utf-8');
  
  if (original !== compiled) {
    console.error('Error: Backend contract (JS) is out of sync with Frontend contract (TS).');
    console.error('Run "npm run build:backend" to update it.');
    process.exit(1);
  }
  
  console.log('Contract verified successfully. No divergence detected.');
} catch (error) {
  console.error('Verification failed:', error);
  process.exit(1);
} finally {
  if (fs.existsSync(TEMP_DIR)) {
    fs.rmSync(TEMP_DIR, { recursive: true, force: true });
  }
}
