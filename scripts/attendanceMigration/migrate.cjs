#!/usr/bin/env node
'use strict';

/**
 * migrate.js
 *
 * Herramienta de línea de comandos para la migración y reconciliación
 * del módulo de asistencia (Gestión GGSS Security).
 *
 * RESTRICCIÓN ABSOLUTA:
 * - Solo se ejecuta localmente.
 * - Modo dry-run por defecto (NO escribe datos).
 * - Modo --apply requiere explícitamente emulador local y proyecto demo-*.
 * - Modo --rollback revierte exclusivamente los documentos con marca de migración.
 *
 * Uso:
 *   node scripts/attendanceMigration/migrate.js --dry-run [--synthetic]
 *   node scripts/attendanceMigration/migrate.js --apply [--synthetic]
 *   node scripts/attendanceMigration/migrate.js --rollback
 */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const {
  runMigration,
  rollbackMigration,
  renderMarkdownReport,
  assertLocalOnly,
  CONSOLIDATION_VERSION
} = require('../../functions/src/attendanceConsolidation/migrationRunner');
const { buildSyntheticDataset, NOW } = require('../../functions/src/attendanceConsolidation/syntheticData');

// ---------------------------------------------------------------------------
// Argumentos de CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = {
    mode: 'dry-run',
    synthetic: false,
    rollback: false,
    reportMd: null,
    reportJson: null,
    target: 'AsistenciasConsolidadas',
    review: 'AsistenciasPendientesRevision',
    projectId: process.env.GCLOUD_PROJECT || 'demo-ggss'
  };

  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') args.mode = 'apply';
    else if (a === '--dry-run') args.mode = 'dry-run';
    else if (a === '--rollback') args.rollback = true;
    else if (a === '--synthetic') args.synthetic = true;
    else if (a === '--report-md' && argv[i + 1]) args.reportMd = argv[++i];
    else if (a === '--report-json' && argv[i + 1]) args.reportJson = argv[++i];
    else if (a === '--target' && argv[i + 1]) args.target = argv[++i];
    else if (a === '--review' && argv[i + 1]) args.review = argv[++i];
    else if (a === '--project' && argv[i + 1]) args.projectId = argv[++i];
    else if (a === '--help' || a === '-h') {
      console.log(`
Uso: node scripts/attendanceMigration/migrate.js [opciones]

Opciones:
  --dry-run       (por defecto) Simula la consolidación y genera el informe de reconciliación.
  --apply         Ejecuta la migración escribiendo en el emulador local de Firestore.
  --rollback      Elimina únicamente los documentos migrados en el emulador local.
  --synthetic     Usa el conjunto de datos sintéticos de prueba (18 casos de borde).
  --report-md <path>   Guarda el informe en formato Markdown.
  --report-json <path> Guarda los resultados detallados en JSON.
  --target <col>       Colección destino (default: AsistenciasConsolidadas).
  --review <col>       Colección de pendientes (default: AsistenciasPendientesRevision).
`);
      process.exit(0);
    }
  }
  return args;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs(process.argv);
  console.log(`\n============================================================`);
  console.log(`  CONSOLIDACIÓN DE ASISTENCIA — GESTIÓN GGSS SECURITY`);
  console.log(`  Versión de migración: ${CONSOLIDATION_VERSION}`);
  console.log(`  Modo: ${args.rollback ? 'ROLLBACK' : args.mode.toUpperCase()}`);
  console.log(`  Fuente: ${args.synthetic ? 'Datos sintéticos locales' : 'Colección Asistencia (Firestore)'}`);
  console.log(`============================================================\n`);

  let db = null;
  const isEmulatorAvailable = !!process.env.FIRESTORE_EMULATOR_HOST;

  if (args.mode === 'apply' || args.rollback || (!args.synthetic && isEmulatorAvailable)) {
    try {
      assertLocalOnly(process.env, args.projectId);
    } catch (err) {
      console.error(`❌ ERROR DE SEGURIDAD: ${err.message}`);
      process.exit(1);
    }

    if (!admin.apps.length) {
      admin.initializeApp({ projectId: args.projectId });
    }
    db = admin.firestore();
  }

  // 1. Manejo de Rollback
  if (args.rollback) {
    if (!db) {
      console.error('❌ Error: El rollback requiere conexión al emulador de Firestore (FIRESTORE_EMULATOR_HOST).');
      process.exit(1);
    }
    console.log(`Ejecutando rollback de versión "${CONSOLIDATION_VERSION}"...`);
    const result = await rollbackMigration(db, {
      apply: true,
      target: args.target,
      review: args.review,
      version: CONSOLIDATION_VERSION,
      projectId: args.projectId
    });
    console.log(`✅ Rollback completado con éxito.`);
    console.log(`   Documentos eliminados: ${result.count}`);
    result.documents.slice(0, 10).forEach(d => console.log(`   - [${d.col}] ${d.id}`));
    if (result.count > 10) console.log(`   ... y ${result.count - 10} más.`);
    process.exit(0);
  }

  // 2. Preparar documentos de entrada
  let docs = null;
  if (args.synthetic) {
    const dataset = buildSyntheticDataset();
    docs = dataset.docs;
    console.log(`ℹ️  Cargados ${docs.length} documentos sintéticos de prueba.`);
  }

  // 3. Ejecutar Migración (dry-run o apply)
  console.log(`Iniciando ejecución (${args.mode})...\n`);
  const result = await runMigration(db, {
    mode: args.mode,
    docs,
    now: args.synthetic ? NOW : Date.now(),
    target: args.target,
    review: args.review,
    projectId: args.projectId,
    FieldValue: admin.firestore.FieldValue
  });

  // 4. Renderizar y mostrar informe
  const markdown = renderMarkdownReport(result);
  console.log(markdown);

  // 5. Guardar archivos de reporte si se solicitaron
  if (args.reportMd) {
    fs.mkdirSync(path.dirname(path.resolve(args.reportMd)), { recursive: true });
    fs.writeFileSync(args.reportMd, markdown, 'utf8');
    console.log(`\n📄 Informe Markdown guardado en: ${args.reportMd}`);
  }
  if (args.reportJson) {
    fs.mkdirSync(path.dirname(path.resolve(args.reportJson)), { recursive: true });
    fs.writeFileSync(args.reportJson, JSON.stringify(result, null, 2), 'utf8');
    console.log(`📄 Resultados JSON guardados en: ${args.reportJson}`);
  }

  console.log(`\n============================================================`);
  console.log(`  ESTADO FINAL: ${result.reconciliation.approved ? '✅ APROBADA' : '❌ RECHAZADA'}`);
  console.log(`============================================================\n`);

  if (!result.reconciliation.approved && args.mode === 'apply') {
    process.exit(2);
  }
}

if (require.main === module) {
  main().catch(err => {
    console.error('❌ Error no controlado en la migración:', err);
    process.exit(1);
  });
}

module.exports = { main };
