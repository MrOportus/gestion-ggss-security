/**
 * ASPRO — CONTRATOS V2 — FASE 2
 * Suite Automatizada de Validación del Prototipo emitirContratoV2
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const { emitirContratoV2, ContractEmissionError } = require('./emitirContratoV2_proto.cjs');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureGotenbergRunning() {
  console.log('[Setup] Verificando servicio Gotenberg v8...');
  let isUp = false;
  try {
    const res = execSync('curl.exe -s http://localhost:3000/health', { encoding: 'utf8', timeout: 2000 });
    if (res.includes('"status":"up"')) isUp = true;
  } catch (_) {}

  if (!isUp) {
    console.log('[Setup] Iniciando contenedor Gotenberg en segundo plano...');
    try { execSync('docker rm -f gotenberg_phase2 2>nul'); } catch (_) {}
    execSync('docker run -d --name gotenberg_phase2 -p 3000:3000 gotenberg/gotenberg:8', { encoding: 'utf8' });

    for (let attempt = 1; attempt <= 20; attempt++) {
      await sleep(500);
      try {
        const health = execSync('curl.exe -s http://localhost:3000/health', { encoding: 'utf8', timeout: 2000 });
        if (health.includes('"status":"up"')) {
          console.log(`[Setup] Gotenberg listo en el intento ${attempt}.`);
          return true;
        }
      } catch (_) {}
    }
    throw new Error('No fue posible iniciar el servicio Gotenberg en localhost:3000');
  } else {
    console.log('[Setup] Gotenberg ya está activo y respondiendo.');
    return false; // Indicador de que no fue creado por este runner
  }
}

async function runTestSuite() {
  console.log('================================================================');
  console.log(' ASPRO — CONTRATOS V2 — FASE 2: VALIDACIÓN DEL PROTOTIPO');
  console.log('================================================================\n');

  const containerStarted = await ensureGotenbergRunning();

  // Mock de base de datos en memoria para el laboratorio
  const mockDb = {
    contracts: [],
    getExistingContracts: () => mockDb.contracts,
    saveContract: (c) => mockDb.contracts.push(c)
  };

  const results = [];

  try {
    // -------------------------------------------------------------------------
    // TEST 1: Emisión exitosa vía Canal Digital ASPRO
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 1: Emisión Exitosa (Canal Digital ASPRO) ---');
    const req1 = {
      auth: { uid: 'admin_test_01', role: 'admin', email: 'admin@ggss-security.cl' },
      data: {
        colaboradorId: 'colab_101',
        tipo: 'Plazo Fijo',
        fechaInicio: '2026-11-01',
        fechaTermino: '2026-12-31',
        cargo: 'Guardia de Seguridad OS-10',
        sueldoBase: 550000,
        gratificacion: 137500,
        canalFirma: 'digital_aspro'
      }
    };

    const res1 = await emitirContratoV2(req1, { mockDb });
    console.log('  Resultado Test 1:', {
      status: res1.status,
      contratoId: res1.contratoId,
      documentoId: res1.documentoId,
      pdfSha256: res1.pdfSha256.substring(0, 16) + '...',
      pageCount: res1.pageCount,
      totalMs: res1.timings.totalMs
    });

    results.push({
      test: 'Test 1: Emisión Digital ASPRO',
      passed: res1.status === 'success' && res1.pageCount === 4 && Boolean(res1.documentoId),
      detalles: `4 páginas A4, ${res1.timings.totalMs} ms, documentoId: ${res1.documentoId}`
    });

    // -------------------------------------------------------------------------
    // TEST 2: Emisión exitosa vía Canal Físico Manuscrito
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 2: Emisión Exitosa (Canal Físico Manuscrito) ---');
    const req2 = {
      auth: { uid: 'rrhh_test_02', role: 'rrhh', email: 'rrhh@ggss-security.cl' },
      data: {
        colaboradorId: 'colab_102',
        tipo: 'Indefinido',
        fechaInicio: '2026-11-01',
        cargo: 'Supervisor de Operaciones',
        sueldoBase: 800000,
        gratificacion: 200000,
        canalFirma: 'fisica_manuscrita'
      }
    };

    const res2 = await emitirContratoV2(req2, { mockDb });
    console.log('  Resultado Test 2:', {
      status: res2.status,
      contratoId: res2.contratoId,
      documentoId: res2.documentoId,
      canalFirma: res2.canalFirma,
      totalMs: res2.timings.totalMs
    });

    results.push({
      test: 'Test 2: Emisión Física Manuscrita',
      passed: res2.status === 'success' && res2.documentoId === null && res2.canalFirma === 'fisica_manuscrita',
      detalles: `Canal físico, sin documento digital, ${res2.timings.totalMs} ms`
    });

    // -------------------------------------------------------------------------
    // TEST 3: Idempotencia y Prevención de Duplicados
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 3: Idempotencia y Prevención de Duplicados ---');
    // Reintentar exactamente req1
    const res3 = await emitirContratoV2(req1, { mockDb });
    console.log('  Resultado Test 3:', {
      status: res3.status,
      reused: res3.reused,
      contratoId: res3.contratoId
    });

    results.push({
      test: 'Test 3: Idempotencia y Duplicados',
      passed: res3.status === 'idempotent_duplicate' && res3.reused === true && res3.contratoId === res1.contratoId,
      detalles: 'Detectó duplicado y reutilizó contratoId existente sin reconversión'
    });

    // -------------------------------------------------------------------------
    // TEST 4: Rechazo por Falta de Fecha de Término en Plazo Fijo
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 4: Validación de Campos Obligatorios (Error Controlado) ---');
    let err4Caught = false;
    let err4Msg = '';
    try {
      await emitirContratoV2({
        auth: { uid: 'admin_test_01', role: 'admin' },
        data: {
          colaboradorId: 'colab_103',
          tipo: 'Plazo Fijo',
          fechaInicio: '2026-11-01'
          // Falta fechaTermino requerida en plazo fijo
        }
      }, { mockDb });
    } catch (e) {
      if (e instanceof ContractEmissionError) {
        err4Caught = true;
        err4Msg = e.message;
      }
    }
    console.log('  Resultado Test 4: Error capturado correctamente ->', err4Msg);

    results.push({
      test: 'Test 4: Rechazo Datos Incompletos',
      passed: err4Caught,
      detalles: `Error controlado: "${err4Msg}"`
    });

    // -------------------------------------------------------------------------
    // TEST 5: Control de Acceso por Roles (Guardia / Supervisor no autorizados)
    // -------------------------------------------------------------------------
    console.log('\n--- TEST 5: Control de Acceso por Rol (Permiso Denegado) ---');
    let err5Caught = false;
    let err5Code = '';
    try {
      await emitirContratoV2({
        auth: { uid: 'worker_99', role: 'worker' },
        data: {
          colaboradorId: 'colab_101',
          tipo: 'Plazo Fijo',
          fechaInicio: '2026-11-01',
          fechaTermino: '2026-12-31'
        }
      }, { mockDb });
    } catch (e) {
      if (e instanceof ContractEmissionError) {
        err5Caught = true;
        err5Code = e.code;
      }
    }
    console.log('  Resultado Test 5: Código de error ->', err5Code);

    results.push({
      test: 'Test 5: Control de Acceso IAM/Rol',
      passed: err5Caught && err5Code === 'permission-denied',
      detalles: `Rechazado con código "${err5Code}"`
    });

  } finally {
    if (containerStarted) {
      console.log('\n[Teardown] Deteniendo contenedor Gotenberg de prueba...');
      try { execSync('docker stop gotenberg_phase2 2>nul'); } catch (_) {}
      try { execSync('docker rm gotenberg_phase2 2>nul'); } catch (_) {}
    }
  }

  // -------------------------------------------------------------------------
  // Resumen Final
  // -------------------------------------------------------------------------
  console.log('\n================================================================');
  console.log(' RESULTADOS FINALES DE LA SUITE DE FASE 2');
  console.log('================================================================');
  console.table(results);

  const allPassed = results.every(r => r.passed);
  console.log(`\nEstado General: ${allPassed ? 'TODOS LOS TESTS PASARON EXITOSAMENTE' : 'HAY TESTS FALLIDOS'}`);

  // Guardar reporte JSON
  const reportPath = path.join(__dirname, 'benchmark_results_phase2.json');
  fs.writeFileSync(reportPath, JSON.stringify({
    timestamp: new Date().toISOString(),
    allPassed,
    results,
    mockContractsCreated: mockDb.contracts.length
  }, null, 2), 'utf8');

  console.log('Reporte JSON generado en:', reportPath);
}

runTestSuite().catch(err => {
  console.error('Error fatal durante la suite de pruebas:', err);
  process.exit(1);
});
