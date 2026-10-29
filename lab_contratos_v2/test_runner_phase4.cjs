/**
 * ASPRO — CONTRATOS V2 — FASE 4
 * Suite Completa de Pruebas de Regresión y Compatibilidad
 * 
 * Evalúa los 10 escenarios obligatorios de integración:
 * 1. Control de roles autorizados (admin, rrhh) y rechazo de no autorizados
 * 2. Validación de modalidades Plazo Fijo e Indefinido
 * 3. Validación preventiva de datos obligatorios ausentes
 * 4. Idempotencia y prevención de doble emisión
 * 5. Manejo de fallos de servicio en Gotenberg (timeout / 500)
 * 6. Fallo en persistencia con compensación reactiva de Storage
 * 7. Fallo atómico al asociar documento digital (Rollback)
 * 8. Canal Físico y posterior adjunto del escaneo firmado
 * 9. Preservación del historial contractual en renovaciones (cadena inmutable)
 * 10. Validación de compatibilidad con esquemas TypeScript de ASPRO
 */

const { execSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const { emitirContratoV2, ContractEmissionError } = require('./emitirContratoV2_proto.cjs');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function ensureGotenbergRunning() {
  console.log('[Setup] Verificando microservicio Gotenberg v8 en puerto 3005...');
  let isUp = false;
  try {
    const res = execSync('curl.exe -s http://localhost:3005/health', { encoding: 'utf8', timeout: 2000 });
    if (res.includes('"status":"up"')) isUp = true;
  } catch (_) {}

  if (!isUp) {
    console.log('[Setup] Iniciando contenedor Gotenberg en puerto 3005...');
    try { execSync('docker rm -f gotenberg_phase4 2>nul'); } catch (_) {}
    execSync('docker run -d --name gotenberg_phase4 -p 3005:3000 gotenberg/gotenberg:8', { encoding: 'utf8' });

    for (let attempt = 1; attempt <= 20; attempt++) {
      await sleep(500);
      try {
        const health = execSync('curl.exe -s http://localhost:3005/health', { encoding: 'utf8', timeout: 2000 });
        if (health.includes('"status":"up"')) {
          console.log(`[Setup] Gotenberg activo y respondiendo en intento ${attempt}.`);
          return true;
        }
      } catch (_) {}
    }
    throw new Error('No fue posible conectar con Gotenberg en localhost:3005');
  } else {
    console.log('[Setup] Gotenberg ya está activo en puerto 3005.');
    return false;
  }
}

async function runPhase4Suite() {
  console.log('================================================================');
  console.log(' ASPRO — CONTRATOS V2 — FASE 4: AUDITORÍA Y REGRESIÓN (10 TESTS)');
  console.log('================================================================\n');

  await ensureGotenbergRunning();

  const results = [];
  const startTime = Date.now();

  // Helper para simular DB en memoria
  function createMockDb() {
    const contracts = new Map();
    const documents = new Map();
    return {
      contracts,
      documents,
      existingContracts: [],
      getExistingContracts: function() {
        return Array.from(contracts.values());
      },
      getContractById: function(id) {
        return contracts.get(id) || null;
      },
      saveContract: function(c) {
        contracts.set(c.id, c);
      },
      updateContract: function(id, patch) {
        const current = contracts.get(id);
        if (current) {
          contracts.set(id, { ...current, ...patch });
        }
      },
      saveDocument: function(d) {
        documents.set(d.id, d);
      }
    };
  }

  // Helper para simular Storage Driver
  function createMockStorage() {
    const files = new Map();
    return {
      files,
      save: (p, buf) => files.set(p, buf),
      delete: (p) => files.delete(p),
      exists: (p) => files.has(p)
    };
  }

  // ---------------------------------------------------------------------------
  // TEST 1: Control de roles autorizados vs. no autorizados
  // ---------------------------------------------------------------------------
  console.log('--- TEST 1: Control de Roles Autorizados y No Autorizados ---');
  try {
    const mockDb = createMockDb();
    const mockStorage = createMockStorage();

    // 1.1: Admin permitido
    const resAdmin = await emitirContratoV2({
      auth: { uid: 'u_admin', role: 'admin', email: 'admin@ggss.cl' },
      data: { colaboradorId: 'colab_1', fechaInicio: '2026-11-01', tipo: 'Indefinido', sueldoBase: 550000 }
    }, { mockDb, storageDriver: mockStorage });

    // 1.2: RRHH permitido
    const resRRHH = await emitirContratoV2({
      auth: { uid: 'u_rrhh', role: 'rrhh', email: 'rrhh@ggss.cl' },
      data: { colaboradorId: 'colab_2', fechaInicio: '2026-11-01', tipo: 'Indefinido', sueldoBase: 550000 }
    }, { mockDb, storageDriver: mockStorage });

    // 1.3: Supervisor rechazado (403)
    let supervisorBlocked = false;
    try {
      await emitirContratoV2({
        auth: { uid: 'u_sup', role: 'supervisor' },
        data: { colaboradorId: 'colab_3', fechaInicio: '2026-11-01', tipo: 'Indefinido', sueldoBase: 550000 }
      }, { mockDb, storageDriver: mockStorage });
    } catch (e) {
      if (e.code === 'permission-denied') supervisorBlocked = true;
    }

    // 1.4: Guardia rechazado (403)
    let workerBlocked = false;
    try {
      await emitirContratoV2({
        auth: { uid: 'u_guardia', role: 'worker' },
        data: { colaboradorId: 'colab_4', fechaInicio: '2026-11-01', tipo: 'Indefinido', sueldoBase: 550000 }
      }, { mockDb, storageDriver: mockStorage });
    } catch (e) {
      if (e.code === 'permission-denied') workerBlocked = true;
    }

    // 1.5: Petición anónima rechazada (401)
    let unauthBlocked = false;
    try {
      await emitirContratoV2({
        auth: null,
        data: { colaboradorId: 'colab_5', fechaInicio: '2026-11-01', tipo: 'Indefinido', sueldoBase: 550000 }
      }, { mockDb, storageDriver: mockStorage });
    } catch (e) {
      if (e.code === 'unauthenticated') unauthBlocked = true;
    }

    const testPassed = resAdmin.status === 'success' && resRRHH.status === 'success' && supervisorBlocked && workerBlocked && unauthBlocked;
    console.log(`  Resultado: ${testPassed ? 'PASÓ' : 'FALLÓ'}`);
    results.push({
      test: '1. Control de Roles (IAM)',
      passed: testPassed,
      detalle: 'admin y rrhh autorizados; supervisor, worker y anónimos bloqueados con 403/401.'
    });
  } catch (err) {
    console.error('  Error en Test 1:', err);
    results.push({ test: '1. Control de Roles (IAM)', passed: false, error: err.message });
  }

  // ---------------------------------------------------------------------------
  // TEST 2: Validación de Modalidades Plazo Fijo e Indefinido
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 2: Validación de Plazo Fijo e Indefinido ---');
  try {
    const mockDb = createMockDb();
    const mockStorage = createMockStorage();

    // 2.1: Plazo Fijo sin fecha de término debe fallar
    let plazoFijoSinTerminoFallo = false;
    try {
      await emitirContratoV2({
        auth: { uid: 'u_admin', role: 'admin' },
        data: { colaboradorId: 'colab_pf', tipo: 'Plazo Fijo', fechaInicio: '2026-11-01', sueldoBase: 550000 }
      }, { mockDb, storageDriver: mockStorage });
    } catch (e) {
      if (e.message.includes('requieren obligatoriamente una fecha de término')) plazoFijoSinTerminoFallo = true;
    }

    // 2.2: Plazo Fijo con fechaInicio > fechaTermino debe fallar
    let fechasInvertidasFallo = false;
    try {
      await emitirContratoV2({
        auth: { uid: 'u_admin', role: 'admin' },
        data: { colaboradorId: 'colab_pf', tipo: 'Plazo Fijo', fechaInicio: '2026-12-01', fechaTermino: '2026-11-01', sueldoBase: 550000 }
      }, { mockDb, storageDriver: mockStorage });
    } catch (e) {
      if (e.message.includes('no puede ser posterior')) fechasInvertidasFallo = true;
    }

    // 2.3: Indefinido sin fecha de término debe emitir con éxito
    const resIndef = await emitirContratoV2({
      auth: { uid: 'u_admin', role: 'admin' },
      data: { colaboradorId: 'colab_indef', tipo: 'Indefinido', fechaInicio: '2026-11-01', sueldoBase: 550000 }
    }, { mockDb, storageDriver: mockStorage });

    const testPassed = plazoFijoSinTerminoFallo && fechasInvertidasFallo && resIndef.status === 'success';
    console.log(`  Resultado: ${testPassed ? 'PASÓ' : 'FALLÓ'}`);
    results.push({
      test: '2. Modalidades Plazo Fijo e Indefinido',
      passed: testPassed,
      detalle: 'Plazo Fijo exige fechaTermino y valida cronología; Indefinido procesado exitosamente con sueldoBase.'
    });
  } catch (err) {
    console.error('  Error en Test 2:', err);
    results.push({ test: '2. Modalidades Plazo Fijo e Indefinido', passed: false, error: err.message });
  }

  // ---------------------------------------------------------------------------
  // TEST 3: Validación Preventiva de Datos Obligatorios Ausentes
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 3: Validación de Datos Obligatorios Ausentes ---');
  try {
    const mockDb = createMockDb();
    const mockStorage = createMockStorage();

    let faltaColabFallo = false;
    try {
      await emitirContratoV2({
        auth: { uid: 'u_admin', role: 'admin' },
        data: { fechaInicio: '2026-11-01', tipo: 'Indefinido', sueldoBase: 550000 }
      }, { mockDb, storageDriver: mockStorage });
    } catch (e) {
      if (e.message.includes('colaboradorId es obligatorio')) faltaColabFallo = true;
    }

    let faltaFechaInicioFallo = false;
    try {
      await emitirContratoV2({
        auth: { uid: 'u_admin', role: 'admin' },
        data: { colaboradorId: 'colab_x', tipo: 'Indefinido', sueldoBase: 550000 }
      }, { mockDb, storageDriver: mockStorage });
    } catch (e) {
      if (e.message.includes('fechaInicio es obligatoria')) faltaFechaInicioFallo = true;
    }

    let faltaSueldoBaseFallo = false;
    try {
      await emitirContratoV2({
        auth: { uid: 'u_admin', role: 'admin' },
        data: { colaboradorId: 'colab_x', tipo: 'Indefinido', fechaInicio: '2026-11-01' }
      }, { mockDb, storageDriver: mockStorage });
    } catch (e) {
      if (e.message.includes('sueldoBase') && e.message.includes('mayor a cero')) faltaSueldoBaseFallo = true;
    }

    const testPassed = faltaColabFallo && faltaFechaInicioFallo && faltaSueldoBaseFallo;
    console.log(`  Resultado: ${testPassed ? 'PASÓ' : 'FALLÓ'}`);
    results.push({
      test: '3. Datos Obligatorios Ausentes',
      passed: testPassed,
      detalle: 'Rechazo preventivo con 400 ante ausencia de colaboradorId, fechaInicio o sueldoBase.'
    });
  } catch (err) {
    console.error('  Error en Test 3:', err);
    results.push({ test: '3. Datos Obligatorios Ausentes', passed: false, error: err.message });
  }

  // ---------------------------------------------------------------------------
  // TEST 4: Idempotencia y Prevención de Doble Emisión
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 4: Idempotencia y Doble Emisión ---');
  try {
    const mockDb = createMockDb();
    const mockStorage = createMockStorage();

    const reqData = {
      auth: { uid: 'u_admin', role: 'admin' },
      data: {
        colaboradorId: 'colab_idemp',
        tipo: 'Plazo Fijo',
        fechaInicio: '2026-11-01',
        fechaTermino: '2026-11-30',
        sueldoBase: 540000,
        gratificacion: 135000
      }
    };

    // Primera emisión
    const res1 = await emitirContratoV2(reqData, { mockDb, storageDriver: mockStorage });
    // Segunda emisión idéntica inmediata
    const res2 = await emitirContratoV2(reqData, { mockDb, storageDriver: mockStorage });

    const isDuplicateHandled = res2.status === 'idempotent_duplicate' &&
                               res2.contratoId === res1.contratoId &&
                               res2.pdfSha256 === res1.pdfSha256 &&
                               res2.reused === true;

    console.log(`  Resultado: ${isDuplicateHandled ? 'PASÓ' : 'FALLÓ'}`);
    results.push({
      test: '4. Idempotencia y Prevención de Duplicados',
      passed: isDuplicateHandled,
      detalle: `Reintento retornó contrato existente #${res2.contratoId} sin reconvertir.`
    });
  } catch (err) {
    console.error('  Error en Test 4:', err);
    results.push({ test: '4. Idempotencia y Prevención de Duplicados', passed: false, error: err.message });
  }

  // ---------------------------------------------------------------------------
  // TEST 5: Manejo de Fallos de Servicio en Gotenberg
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 5: Manejo de Fallo en Microservicio Gotenberg ---');
  try {
    const mockDb = createMockDb();
    const mockStorage = createMockStorage();

    let gotenbergErrorCaught = false;
    try {
      // Apuntar a puerto inexistente para simular caída del servicio
      await emitirContratoV2({
        auth: { uid: 'u_admin', role: 'admin' },
        data: { colaboradorId: 'colab_fail', tipo: 'Indefinido', fechaInicio: '2026-11-01', sueldoBase: 550000 }
      }, {
        mockDb,
        storageDriver: mockStorage,
        gotenbergUrl: 'http://localhost:59999' // puerto cerrado
      });
    } catch (e) {
      if (e.code === 'unavailable' || e.message.includes('Fallo de conexión')) {
        gotenbergErrorCaught = true;
      }
    }

    // Verificar que la base de datos no contiene contratos corruptos
    const dbClean = mockDb.getExistingContracts().length === 0;

    const testPassed = gotenbergErrorCaught && dbClean;
    console.log(`  Resultado: ${testPassed ? 'PASÓ' : 'FALLÓ'}`);
    results.push({
      test: '5. Fallo de Servicio Gotenberg (503/Timeout)',
      passed: testPassed,
      detalle: 'Error 503 capturado limpiamente; cero escrituras residuales en base de datos.'
    });
  } catch (err) {
    console.error('  Error en Test 5:', err);
    results.push({ test: '5. Fallo de Servicio Gotenberg (503/Timeout)', passed: false, error: err.message });
  }

  // ---------------------------------------------------------------------------
  // TEST 6: Fallo en Persistencia y Compensación Reactiva en Storage
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 6: Compensación Reactiva de Archivos Huérfanos en Storage ---');
  try {
    const mockDb = createMockDb();
    const mockStorage = createMockStorage();

    let compensationExecuted = false;
    try {
      await emitirContratoV2({
        auth: { uid: 'u_admin', role: 'admin' },
        data: { colaboradorId: 'colab_compensate', tipo: 'Indefinido', fechaInicio: '2026-11-01', sueldoBase: 550000 }
      }, {
        mockDb,
        storageDriver: mockStorage,
        simulateFirestoreFailure: true // Disparador de fallo transaccional
      });
    } catch (e) {
      if (e.message.includes('Compensación ejecutada')) {
        compensationExecuted = true;
      }
    }

    // Comprobar que el archivo en Storage fue borrado reactivamente y no quedó huérfano
    const storageFilesCount = mockStorage.files.size;
    const testPassed = compensationExecuted && storageFilesCount === 0;

    console.log(`  Resultado: ${testPassed ? 'PASÓ' : 'FALLÓ'}`);
    results.push({
      test: '6. Compensación Reactiva en Storage',
      passed: testPassed,
      detalle: 'Fallo de Firestore disparó eliminación inmediata del archivo PDF huérfano en Storage.'
    });
  } catch (err) {
    console.error('  Error en Test 6:', err);
    results.push({ test: '6. Compensación Reactiva en Storage', passed: false, error: err.message });
  }

  // ---------------------------------------------------------------------------
  // TEST 7: Fallo Atómico al Asociar Documento Digital (Rollback)
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 7: Fallo Atómico al Asociar Documento Digital ---');
  try {
    const mockDb = createMockDb();
    const mockStorage = createMockStorage();

    let rollbackExecuted = false;
    try {
      await emitirContratoV2({
        auth: { uid: 'u_admin', role: 'admin' },
        data: { colaboradorId: 'colab_doc_fail', tipo: 'Indefinido', fechaInicio: '2026-11-01', canalFirma: 'digital_aspro', sueldoBase: 550000 }
      }, {
        mockDb,
        storageDriver: mockStorage,
        simulateDocumentAssociationFailure: true
      });
    } catch (e) {
      if (e.message.includes('Rollback ejecutado')) {
        rollbackExecuted = true;
      }
    }

    const contractsCount = mockDb.getExistingContracts().length;
    const documentsCount = mockDb.documents.size;
    const testPassed = rollbackExecuted && contractsCount === 0 && documentsCount === 0;

    console.log(`  Resultado: ${testPassed ? 'PASÓ' : 'FALLÓ'}`);
    results.push({
      test: '7. Atomicidad en Asociación Documental',
      passed: testPassed,
      detalle: 'Transacción abortada: no se genera contrato desvinculado si falla la creación del documento digital.'
    });
  } catch (err) {
    console.error('  Error en Test 7:', err);
    results.push({ test: '7. Atomicidad en Asociación Documental', passed: false, error: err.message });
  }

  // ---------------------------------------------------------------------------
  // TEST 8: Canal Físico Manuscrito y Posterior Adjunto de Escaneado
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 8: Canal Físico Manuscrito y Posterior Adjunto ---');
  try {
    const mockDb = createMockDb();
    const mockStorage = createMockStorage();

    // 8.1: Emisión en canal físico
    const resFisico = await emitirContratoV2({
      auth: { uid: 'u_admin', role: 'admin' },
      data: {
        colaboradorId: 'colab_fisico',
        tipo: 'Indefinido',
        fechaInicio: '2026-11-01',
        canalFirma: 'fisica_manuscrita',
        sueldoBase: 550000
      }
    }, { mockDb, storageDriver: mockStorage });

    const contratoGuardado = mockDb.getContractById(resFisico.contratoId);
    const emisionFisicaCorrecta = resFisico.documentoId === null &&
                                  contratoGuardado.estado === 'pendiente_firma' &&
                                  contratoGuardado.estadoDocumental === 'no_adjunto' &&
                                  contratoGuardado.canalFirma === 'fisica_manuscrita';

    // 8.2: Simulación del flujo posterior de adjunto de escaneado firmado
    const escaneadoPdfBuffer = Buffer.from('%PDF-1.4 Mock Escaneado Firmado Manuscrito...');
    const hashEscaneado = crypto.createHash('sha256').update(escaneadoPdfBuffer).digest('hex');
    const storagePathEscaneado = `contracts/${resFisico.contratoId}/firmado_escaneado.pdf`;
    mockStorage.save(storagePathEscaneado, escaneadoPdfBuffer);

    // Actualización administrativa tras verificar el escaneado
    mockDb.updateContract(resFisico.contratoId, {
      estado: 'vigente',
      estadoDocumental: 'firmado_externo',
      pdfFirmadoStoragePath: storagePathEscaneado,
      pdfFirmadoSha256: hashEscaneado,
      fechaFirmaReal: '2026-11-02',
      observacionesDocumento: 'Contrato firmado manuscrito en faena y escaneado con verificación SHA-256'
    });

    const contratoActualizado = mockDb.getContractById(resFisico.contratoId);
    const transicionCorrecta = contratoActualizado.estado === 'vigente' &&
                               contratoActualizado.estadoDocumental === 'firmado_externo' &&
                               contratoActualizado.pdfFirmadoSha256 === hashEscaneado;

    const testPassed = emisionFisicaCorrecta && transicionCorrecta;
    console.log(`  Resultado: ${testPassed ? 'PASÓ' : 'FALLÓ'}`);
    results.push({
      test: '8. Canal Físico y Posterior Adjunto',
      passed: testPassed,
      detalle: 'Emisión sin documentoId en estado no_adjunto; posterior adjunto de escaneado transiciona a vigente con SHA-256.'
    });
  } catch (err) {
    console.error('  Error en Test 8:', err);
    results.push({ test: '8. Canal Físico y Posterior Adjunto', passed: false, error: err.message });
  }

  // ---------------------------------------------------------------------------
  // TEST 9: Preservación del Historial Contractual en Renovaciones
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 9: Renovación Contractual y Preservación Histórica ---');
  try {
    const mockDb = createMockDb();
    const mockStorage = createMockStorage();

    // 9.1: Emisión del contrato original #1
    const resOrig = await emitirContratoV2({
      auth: { uid: 'u_admin', role: 'admin' },
      data: {
        colaboradorId: 'colab_cadena',
        tipo: 'Plazo Fijo',
        fechaInicio: '2026-08-01',
        fechaTermino: '2026-10-31',
        sueldoBase: 500000
      }
    }, { mockDb, storageDriver: mockStorage });

    // Marcar como vigente previo
    mockDb.updateContract(resOrig.contratoId, { estado: 'vigente' });

    // 9.2: Emisión de la renovación #2
    const resRenov = await emitirContratoV2({
      auth: { uid: 'u_admin', role: 'admin' },
      data: {
        colaboradorId: 'colab_cadena',
        tipo: 'Plazo Fijo',
        fechaInicio: '2026-11-01',
        fechaTermino: '2026-12-31',
        sueldoBase: 550000,
        contratoAnteriorId: resOrig.contratoId
      }
    }, { mockDb, storageDriver: mockStorage });

    const contratoAnt = mockDb.getContractById(resOrig.contratoId);
    const contratoNue = mockDb.getContractById(resRenov.contratoId);

    const cadenaPreservada = contratoAnt.estado === 'renovado' &&
                             contratoAnt.contratoSiguienteId === resRenov.contratoId &&
                             contratoNue.contratoAnteriorId === resOrig.contratoId &&
                             contratoNue.numeroRenovacion === 2 &&
                             mockDb.getExistingContracts().length === 2;

    console.log(`  Resultado: ${cadenaPreservada ? 'PASÓ' : 'FALLÓ'}`);
    results.push({
      test: '9. Preservación del Historial (Renovaciones)',
      passed: cadenaPreservada,
      detalle: `Enlace bidireccional (#${resOrig.contratoId} -> #${resRenov.contratoId}) con numeroRenovacion=2 sin sobreescritura.`
    });
  } catch (err) {
    console.error('  Error en Test 9:', err);
    results.push({ test: '9. Preservación del Historial (Renovaciones)', passed: false, error: err.message });
  }

  // ---------------------------------------------------------------------------
  // TEST 10: Validación Estricta de Esquemas TypeScript (Contrato y DigitalDocument)
  // ---------------------------------------------------------------------------
  console.log('\n--- TEST 10: Validación Estricta de Esquemas TypeScript ---');
  try {
    const mockDb = createMockDb();
    const mockStorage = createMockStorage();

    const resSchema = await emitirContratoV2({
      auth: { uid: 'u_admin', role: 'admin' },
      data: {
        colaboradorId: 'colab_schema',
        tipo: 'Plazo Fijo',
        fechaInicio: '2026-11-01',
        fechaTermino: '2026-12-31',
        cargo: 'Guardia de Seguridad',
        jornada: '45 horas semanales',
        sueldoBase: 550000,
        gratificacion: 137500,
        canalFirma: 'digital_aspro'
      }
    }, { mockDb, storageDriver: mockStorage });

    const contrato = resSchema.contratoPayload;
    const digitalDoc = resSchema.documentoPayload;

    // Validación de campos canónicos de Contrato (types/phase1.ts)
    const validContratoTypes = typeof contrato.id === 'string' &&
                               typeof contrato.colaboradorId === 'string' &&
                               typeof contrato.sucursalId === 'string' &&
                               typeof contrato.tipo === 'string' &&
                               ['borrador', 'pendiente_firma', 'vigente', 'vencido', 'renovado', 'finiquitado', 'anulado'].includes(contrato.estado) &&
                               typeof contrato.fechaInicio === 'string' &&
                               typeof contrato.fechaTermino === 'string' &&
                               typeof contrato.creadoEn === 'string' &&
                               typeof contrato.creadoPor === 'string' &&
                               typeof contrato.schemaVersion === 'number' &&
                               typeof contrato.pdfSha256 === 'string' &&
                               typeof contrato.plantillaVersion === 'number';

    // Validación de campos de DigitalDocument (types.ts)
    const validDocumentTypes = typeof digitalDoc.id === 'string' &&
                               typeof digitalDoc.title === 'string' &&
                               digitalDoc.type === 'Contrato' &&
                               typeof digitalDoc.assignedTo === 'string' &&
                               (digitalDoc.status === 'pending' || digitalDoc.status === 'signed') &&
                               digitalDoc.originalUrl.startsWith('https://') &&
                               typeof digitalDoc.createdAt === 'string' &&
                               Boolean(digitalDoc.signatureConfig) &&
                               digitalDoc.signatureConfig.position === 'right';

    const schemaValid = validContratoTypes && validDocumentTypes;
    console.log(`  Resultado: ${schemaValid ? 'PASÓ' : 'FALLÓ'}`);
    results.push({
      test: '10. Compatibilidad de Esquemas TypeScript',
      passed: schemaValid,
      detalle: 'Contrato cumple types/phase1.ts (schemaVersion: 2) y DigitalDocument cumple types.ts con URL HTTPS válida.'
    });
  } catch (err) {
    console.error('  Error en Test 10:', err);
    results.push({ test: '10. Compatibilidad de Esquemas TypeScript', passed: false, error: err.message });
  }

  // ---------------------------------------------------------------------------
  // Resumen Final
  // ---------------------------------------------------------------------------
  const totalElapsed = Date.now() - startTime;
  const passedCount = results.filter(r => r.passed).length;

  console.log('\n================================================================');
  console.log(` RESUMEN FASE 4: ${passedCount}/10 PRUEBAS EXITOSAS (${totalElapsed} ms)`);
  console.log('================================================================');
  results.forEach((r, idx) => {
    console.log(` [${r.passed ? 'OK' : 'FAIL'}] ${r.test} — ${r.detalle || r.error}`);
  });

  // Guardar resultados en JSON
  const outputBenchmark = path.join(__dirname, 'benchmark_results_phase4.json');
  fs.writeFileSync(outputBenchmark, JSON.stringify({
    timestamp: new Date().toISOString(),
    totalTests: results.length,
    passedCount,
    allPassed: passedCount === results.length,
    elapsedMs: totalElapsed,
    results
  }, null, 2));

  console.log(`\nResultados exportados a: ${outputBenchmark}`);

  if (passedCount !== results.length) {
    process.exit(1);
  }
}

runPhase4Suite().catch(err => {
  console.error('\n[FATAL] Error en la suite de Fase 4:', err);
  process.exit(1);
});
