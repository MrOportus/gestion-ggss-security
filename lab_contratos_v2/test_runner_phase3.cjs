/**
 * ASPRO — CONTRATOS V2 — FASE 3
 * Test Runner Automatizado: Validación del Componente UI y Conexión con Prototipo
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { emitirContratoV2 } = require('./emitirContratoV2_proto.cjs');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureGotenbergRunning() {
  console.log('[Setup] Verificando servicio Gotenberg v8 en puerto 3005...');
  let isUp = false;
  try {
    const res = execSync('curl.exe -s http://localhost:3005/health', { encoding: 'utf8', timeout: 2000 });
    if (res.includes('"status":"up"')) isUp = true;
  } catch (_) {}

  if (!isUp) {
    console.log('[Setup] Iniciando contenedor Gotenberg en puerto 3005...');
    try { execSync('docker rm -f gotenberg_phase3 2>nul'); } catch (_) {}
    execSync('docker run -d --name gotenberg_phase3 -p 3005:3000 gotenberg/gotenberg:8', { encoding: 'utf8' });

    for (let attempt = 1; attempt <= 20; attempt++) {
      await sleep(500);
      try {
        const health = execSync('curl.exe -s http://localhost:3005/health', { encoding: 'utf8', timeout: 2000 });
        if (health.includes('"status":"up"')) {
          console.log(`[Setup] Gotenberg listo en el intento ${attempt}.`);
          return true;
        }
      } catch (_) {}
    }
    throw new Error('No fue posible iniciar el servicio Gotenberg en localhost:3005');
  } else {
    console.log('[Setup] Gotenberg ya está activo en puerto 3005.');
    return false;
  }
}

async function runPhase3Tests() {
  console.log('================================================================');
  console.log(' ASPRO — CONTRATOS V2 — FASE 3: VALIDACIÓN UI & INTEGRACIÓN');
  console.log('================================================================\n');

  const containerStarted = await ensureGotenbergRunning();
  const results = [];

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Verificación de compilación TypeScript del Modal UI
    // -------------------------------------------------------------------------
    console.log('[1/4] Compilando componente UI ContractEmissionModalV2.tsx...');
    const tscCmd = 'npx tsc --noEmit --jsx react-jsx --skipLibCheck --esModuleInterop lab_contratos_v2/ui/ContractEmissionModalV2.tsx';
    let tscSuccess = false;
    try {
      execSync(tscCmd, { encoding: 'utf8', cwd: path.resolve(__dirname, '..') });
      tscSuccess = true;
      console.log('  -> Compilación TypeScript: 0 errores.');
    } catch (err) {
      console.error('  -> Error de compilación:', err.message);
    }
    results.push({
      test: 'Test 1: Compilación TypeScript UI',
      passed: tscSuccess,
      detalles: 'ContractEmissionModalV2.tsx compiló sin errores'
    });

    // -------------------------------------------------------------------------
    // TEST 2: Verificación de compilación del adaptador de laboratorio
    // -------------------------------------------------------------------------
    console.log('\n[2/4] Compilando adaptador labEmissionAdapter.ts...');
    const tscAdapterCmd = 'npx tsc --noEmit --jsx react-jsx --skipLibCheck --esModuleInterop lab_contratos_v2/ui/labEmissionAdapter.ts';
    let adapterSuccess = false;
    try {
      execSync(tscAdapterCmd, { encoding: 'utf8', cwd: path.resolve(__dirname, '..') });
      adapterSuccess = true;
      console.log('  -> Adaptador TypeScript: 0 errores.');
    } catch (err) {
      console.error('  -> Error de compilación del adaptador:', err.message);
    }
    results.push({
      test: 'Test 2: Compilación Adaptador',
      passed: adapterSuccess,
      detalles: 'labEmissionAdapter.ts compiló sin errores'
    });

    // -------------------------------------------------------------------------
    // TEST 3: Simulación de llamada E2E desde el UI Modal al prototipo backend
    // -------------------------------------------------------------------------
    console.log('\n[3/4] Probando ejecución E2E del payload generado por el Modal...');
    // Payload representativo generado por el Step 3 del Modal
    const uiPayload = {
      colaboradorId: 'colab_ui_demo',
      plantillaId: 'tpl_ggss_plazo_fijo_v2',
      tipo: 'Plazo Fijo',
      fechaInicio: '2026-11-01',
      fechaTermino: '2026-12-31',
      cargo: 'Guardia de Seguridad OS-10',
      sucursalId: '2',
      jornada: '45 horas semanales',
      horarioA: '08:00 hrs a 20:00 hrs (Diurno)',
      horarioB: '20:00 hrs a 08:00 hrs (Nocturno)',
      sueldoBase: 560000,
      gratificacion: 140000,
      canalFirma: 'digital_aspro'
    };

    const mockDb = {
      contracts: [],
      getExistingContracts: () => mockDb.contracts,
      saveContract: (c) => mockDb.contracts.push(c)
    };

    const tStart = Date.now();
    const emissionRes = await emitirContratoV2({
      auth: { uid: 'admin_modal_user', role: 'admin', email: 'admin@ggss-security.cl' },
      data: uiPayload
    }, { mockDb });
    const durationMs = Date.now() - tStart;

    console.log('  -> Resultado de emisión E2E:', {
      status: emissionRes.status,
      contratoId: emissionRes.contratoId,
      documentoId: emissionRes.documentoId,
      canalFirma: emissionRes.canalFirma,
      pageCount: emissionRes.pageCount,
      pdfSha256: emissionRes.pdfSha256.substring(0, 16) + '...',
      duracionTotalMs: durationMs
    });

    results.push({
      test: 'Test 3: Emisión E2E desde Payload UI',
      passed: emissionRes.status === 'success' && emissionRes.pageCount === 4 && Boolean(emissionRes.documentoId),
      detalles: `Contrato generado en ${durationMs} ms, 4 páginas A4, docId: ${emissionRes.documentoId}`
    });

    // -------------------------------------------------------------------------
    // TEST 4: Simulación de Canal Físico Manuscrito
    // -------------------------------------------------------------------------
    console.log('\n[4/4] Probando emisión E2E con Canal Físico Manuscrito...');
    const uiPayloadFisico = {
      ...uiPayload,
      colaboradorId: 'colab_ui_demo_fisico',
      tipo: 'Indefinido',
      fechaTermino: undefined,
      canalFirma: 'fisica_manuscrita'
    };

    const emissionResFisico = await emitirContratoV2({
      auth: { uid: 'rrhh_modal_user', role: 'rrhh', email: 'rrhh@ggss-security.cl' },
      data: uiPayloadFisico
    }, { mockDb });

    console.log('  -> Resultado Canal Físico:', {
      status: emissionResFisico.status,
      contratoId: emissionResFisico.contratoId,
      documentoId: emissionResFisico.documentoId,
      canalFirma: emissionResFisico.canalFirma
    });

    results.push({
      test: 'Test 4: Emisión Canal Físico',
      passed: emissionResFisico.status === 'success' && emissionResFisico.documentoId === null && emissionResFisico.canalFirma === 'fisica_manuscrita',
      detalles: 'Canal físico manuscrito operó sin crear documento digital'
    });

  } finally {
    if (containerStarted) {
      console.log('\n[Teardown] Deteniendo contenedor Gotenberg...');
      try { execSync('docker stop gotenberg_phase3 2>nul'); } catch (_) {}
      try { execSync('docker rm gotenberg_phase3 2>nul'); } catch (_) {}
    }
  }

  // -------------------------------------------------------------------------
  // Resumen Final
  // -------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(' RESULTADOS FINALES DE LA FASE 3');
  console.log('================================================================');
  console.table(results);

  const allPassed = results.every(r => r.passed);
  console.log(`\nEstado General: ${allPassed ? 'TODOS LOS TESTS PASARON EXITOSAMENTE' : 'HAY TESTS FALLIDOS'}`);

  const reportPath = path.join(__dirname, 'benchmark_results_phase3.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    allPassed,
    results
  }, null, 2), 'utf8');

  console.log('Reporte JSON guardado en:', reportPath);
}

runPhase3Tests().catch(err => {
  console.error('Error fatal durante las pruebas de Fase 3:', err);
  process.exit(1);
});
