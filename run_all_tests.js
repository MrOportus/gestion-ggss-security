import { spawn } from 'child_process';
import { resolve } from 'path';

async function runCommand(command, args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'inherit', shell: true, env });
    child.on('close', code => {
      resolve(code);
    });
  });
}

async function main() {
  const env = { ...process.env, PATH: "C:\\Program Files\\Eclipse Adoptium\\jdk-17.0.6.10-hotspot\\bin;" + process.env.PATH };
  
  console.log("=== 1. Running Trigger Shadow Test ===");
  const c1 = await runCommand('npx', ['vitest', 'run', 'lib/phase5/__tests__/phase5b5_trigger.emulator.test.ts'], env);
  
  console.log("\\n=== 2. Running AutoClose Test ===");
  const c2 = await runCommand('npx', ['vitest', 'run', 'lib/phase5/__tests__/phase5b5_autoclose.emulator.test.ts'], env);
  
  console.log("\\n=== 3. Running Rules Test ===");
  const c3 = await runCommand('npx', ['vitest', 'run', 'lib/phase5/__tests__/phase5b5.rules.test.ts'], env);
  
  console.log("\\n=== 4. Running Hotfix Nocturno Test ===");
  const c4 = await runCommand('npx', ['vitest', 'run', 'lib/phase5/__tests__/hotfix_nocturno.test.ts'], env);
  
  console.log("\\n=== 5. Running Resolver Parity Test ===");
  const c5 = await runCommand('npx', ['vitest', 'run', 'lib/phase5/__tests__/shadowResolverParity.test.ts'], env);

  console.log("\\n=== FINAL EXIT CODES ===");
  console.log(`Trigger: ${c1}`);
  console.log(`AutoClose: ${c2}`);
  console.log(`Rules: ${c3}`);
  console.log(`Hotfix Nocturno: ${c4}`);
  console.log(`Parity: ${c5}`);
  
  if (c1 !== 0 || c2 !== 0 || c3 !== 0 || c4 !== 0 || c5 !== 0) {
    process.exit(1);
  }
}

main().catch(console.error);
