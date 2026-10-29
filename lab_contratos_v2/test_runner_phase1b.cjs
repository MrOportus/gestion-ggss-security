/**
 * ASPRO — CONTRATOS V2 — FASE 1B
 * Test Runner Automatizado: Evaluación de conversión DOCX a PDF en Linux (LibreOffice CLI vs Gotenberg HTTP)
 */

const fs = require('fs');
const path = require('path');
const { execSync, spawn } = require('child_process');
const http = require('http');
const { PDFDocument } = require('pdf-lib');
const pdfParse = require('pdf-parse');

const labDir = __dirname;
const docxPath = path.join(labDir, 'contrato_rellenado_v2.docx');
const wordPdfPath = path.join(labDir, 'contrato_generado_v2.pdf');
const loPdfPath = path.join(labDir, 'contrato_libreoffice.pdf');
const gotenbergPdfPath = path.join(labDir, 'contrato_gotenberg.pdf');

function formatBytes(bytes) {
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(2) + ' KB';
  return (bytes / 1048576).toFixed(2) + ' MB';
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function inspectPdf(filePath) {
  if (!fs.existsSync(filePath)) return null;
  const stats = fs.statSync(filePath);
  const buffer = fs.readFileSync(filePath);

  const doc = await PDFDocument.load(buffer);
  const pageCount = doc.getPageCount();
  const pages = [];
  for (let i = 0; i < pageCount; i++) {
    const page = doc.getPage(i);
    const size = page.getSize();
    pages.push({
      pageNumber: i + 1,
      widthPt: Number(size.width.toFixed(2)),
      heightPt: Number(size.height.toFixed(2))
    });
  }

  const parsed = await pdfParse(buffer);
  const text = parsed.text;

  const spanishChars = ['á', 'é', 'í', 'ó', 'ú', 'ñ', 'Á', 'É', 'Í', 'Ó', 'Ú', 'Ñ'];
  const presentChars = spanishChars.filter(c => text.includes(c));

  const unresolvedTags = text.match(/\{\{[^}]+\}\}/g) || [];

  const clauses = [
    'PRIMERO: NATURALEZA DE LOS SERVICIOS Y FUNCIONES',
    'SEGUNDO: JORNADA DE TRABAJO Y SISTEMA DE TURNOS',
    'TERCERO: REMUNERACIÓN Y ASIGNACIONES',
    'CUARTO: VIGENCIA DEL CONTRATO DE TRABAJO',
    'QUINTO: DEBERES, OBLIGACIONES Y PROHIBICIONES OPERATIVAS ESPECÍFICAS DE SEGURIDAD',
    'SEXTO: PROPIEDAD INTELECTUAL, CONFIDENCIALIDAD Y PROTECCIÓN DE DATOS',
    'SÉPTIMO: ELEMENTOS DE PROTECCIÓN PERSONAL Y HERRAMIENTAS DE TRABAJO',
    'OCTAVO: DOMICILIO Y JURISDICCIÓN',
    'NOVENO: EJEMPLARES Y FIRMA'
  ];

  const presentClauses = clauses.filter(c => {
    const normC = c.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    const normText = text.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    return normText.includes(normC);
  });

  const hasSignatures = text.includes('FIRMA DE LAS PARTES') &&
                        text.includes('GGSS SECURITY SPA') &&
                        text.includes('TRABAJADOR');

  const hasTableData = text.includes('Turno A') && text.includes('Turno B');
  const hasPageNumbering = text.includes('Página 1 de 4') && text.includes('Página 4 de 4');

  return {
    filePath: path.basename(filePath),
    sizeBytes: stats.size,
    sizeFormatted: formatBytes(stats.size),
    pageCount,
    pages,
    textLength: text.length,
    presentCharsCount: presentChars.length,
    totalCharsChecked: spanishChars.length,
    unresolvedTagsCount: unresolvedTags.length,
    unresolvedTags,
    presentClausesCount: presentClauses.length,
    totalClauses: clauses.length,
    hasSignatures,
    hasTableData,
    hasPageNumbering
  };
}

async function runBenchmark() {
  console.log('================================================================');
  console.log(' ASPRO — CONTRATOS V2 — FASE 1B: BENCHMARK LINUX CLOUD RUN');
  console.log('================================================================\n');

  if (!fs.existsSync(docxPath)) {
    console.error('ERROR: No se encontró el DOCX sintético:', docxPath);
    process.exit(1);
  }
  if (!fs.existsSync(wordPdfPath)) {
    console.error('ERROR: No se encontró el PDF de referencia Word COM:', wordPdfPath);
    process.exit(1);
  }

  console.log('[1/4] DOCX de entrada verificado:', path.basename(docxPath), `(${formatBytes(fs.statSync(docxPath).size)})`);
  console.log('[1/4] PDF Referencia Word COM:', path.basename(wordPdfPath), `(${formatBytes(fs.statSync(wordPdfPath).size)})`);

  // -------------------------------------------------------------
  // TEST 1: LIBREOFFICE HEADLESS CLI
  // -------------------------------------------------------------
  console.log('\n----------------------------------------------------------------');
  console.log('[2/4] Ejecutando Alternativa 1: LibreOffice Headless (CLI Linux)');
  console.log('----------------------------------------------------------------');

  const loStart = Date.now();
  let loExitCode = 0;
  let loError = null;

  try {
    const cmd = `docker run --rm -v "${labDir}:/workspace" gotenberg/gotenberg:8 libreoffice --headless --convert-to pdf --outdir /workspace /workspace/contrato_rellenado_v2.docx`;
    const output = execSync(cmd, { encoding: 'utf8', timeout: 30000 });
    console.log('  Salida LibreOffice:', output.trim());
    // Mover a contrato_libreoffice.pdf
    const tmpLoPdf = path.join(labDir, 'contrato_rellenado_v2.pdf');
    if (fs.existsSync(tmpLoPdf)) {
      if (fs.existsSync(loPdfPath)) fs.unlinkSync(loPdfPath);
      fs.renameSync(tmpLoPdf, loPdfPath);
    }
  } catch (err) {
    loExitCode = err.status || 1;
    loError = err.message;
    console.error('  Fallo en LibreOffice CLI:', err.message);
  }
  const loDurationMs = Date.now() - loStart;
  console.log(`  Tiempo de ejecución LibreOffice CLI: ${loDurationMs} ms (Código: ${loExitCode})`);

  // -------------------------------------------------------------
  // TEST 2: GOTENBERG HTTP MICROSERVICE
  // -------------------------------------------------------------
  console.log('\n----------------------------------------------------------------');
  console.log('[3/4] Ejecutando Alternativa 2: Gotenberg v8 (HTTP API Linux)');
  console.log('----------------------------------------------------------------');

  // Asegurar que no hay un contenedor previo colgado
  try { execSync('docker rm -f gotenberg_lab 2>nul'); } catch (_) {}

  console.log('  Iniciando contenedor Gotenberg en segundo plano...');
  execSync('docker run -d --name gotenberg_lab -p 3000:3000 gotenberg/gotenberg:8', { encoding: 'utf8' });

  // Esperar a que /health responda
  let isUp = false;
  for (let attempt = 1; attempt <= 20; attempt++) {
    await sleep(500);
    try {
      const healthRes = execSync('curl.exe -s http://localhost:3000/health', { encoding: 'utf8', timeout: 3000 });
      if (healthRes.includes('"status":"up"')) {
        isUp = true;
        console.log(`  Gotenberg listo en el intento ${attempt} (/health: status=up).`);
        break;
      }
    } catch (_) {}
  }

  if (!isUp) {
    console.error('  ERROR: Gotenberg no respondió en /health tras 10 segundos.');
  }

  let gotenbergDurationMs = 0;
  let gotenbergExitCode = 0;
  let gotenbergMemory = 'N/A';

  if (isUp) {
    console.log('  Enviando solicitud de conversión HTTP multipart/form-data...');
    const gStart = Date.now();
    try {
      execSync(`curl.exe -s -F "files=@${docxPath}" -o "${gotenbergPdfPath}" http://localhost:3000/forms/libreoffice/convert`, {
        timeout: 30000
      });
      gotenbergDurationMs = Date.now() - gStart;
      console.log(`  Conversión Gotenberg completada en ${gotenbergDurationMs} ms.`);
    } catch (err) {
      gotenbergExitCode = err.status || 1;
      console.error('  Error en solicitud Gotenberg:', err.message);
    }

    try {
      const stats = execSync('docker stats --no-stream --format "{{.MemUsage}}" gotenberg_lab', { encoding: 'utf8' });
      gotenbergMemory = stats.trim();
      console.log(`  Consumo de memoria medido del contenedor Gotenberg: ${gotenbergMemory}`);
    } catch (_) {}
  }

  console.log('  Deteniendo contenedor Gotenberg...');
  try { execSync('docker stop gotenberg_lab', { encoding: 'utf8' }); } catch (_) {}
  try { execSync('docker rm gotenberg_lab', { encoding: 'utf8' }); } catch (_) {}

  // -------------------------------------------------------------
  // TEST 3: COMPARACIÓN DE FIDELIDAD DOCUMENTAL
  // -------------------------------------------------------------
  console.log('\n----------------------------------------------------------------');
  console.log('[4/4] Análisis comparativo de fidelidad documental');
  console.log('----------------------------------------------------------------');

  const wordAnalysis = await inspectPdf(wordPdfPath);
  const loAnalysis = await inspectPdf(loPdfPath);
  const gotenbergAnalysis = await inspectPdf(gotenbergPdfPath);

  const summary = [
    {
      Motor: 'Word COM (Referencia Fase 1A)',
      Entorno: 'Windows 11 / Word 2016',
      TiempoMs: 4340, // Medido en Fase 1A
      Tamaño: wordAnalysis ? wordAnalysis.sizeFormatted : 'N/A',
      Páginas: wordAnalysis ? wordAnalysis.pageCount : 'N/A',
      Dimensiones: wordAnalysis ? `${wordAnalysis.pages[0].widthPt} x ${wordAnalysis.pages[0].heightPt} pt (A4)` : 'N/A',
      'Sin Etiquetas': wordAnalysis && wordAnalysis.unresolvedTagsCount === 0 ? 'SÍ' : 'NO',
      'Caracteres ES': wordAnalysis ? `${wordAnalysis.presentCharsCount}/${wordAnalysis.totalCharsChecked}` : 'N/A',
      'Cláusulas (1-9)': wordAnalysis ? `${wordAnalysis.presentClausesCount}/${wordAnalysis.totalClauses}` : 'N/A',
      'Firmas OK': wordAnalysis && wordAnalysis.hasSignatures ? 'SÍ' : 'NO',
      'Tablas Turnos': wordAnalysis && wordAnalysis.hasTableData ? 'SÍ' : 'NO',
      'Numeración Pág': wordAnalysis && wordAnalysis.hasPageNumbering ? 'SÍ' : 'NO'
    },
    {
      Motor: 'LibreOffice Headless (CLI Linux)',
      Entorno: 'Debian Linux Container',
      TiempoMs: loDurationMs,
      Tamaño: loAnalysis ? loAnalysis.sizeFormatted : 'N/A',
      Páginas: loAnalysis ? loAnalysis.pageCount : 'N/A',
      Dimensiones: loAnalysis ? `${loAnalysis.pages[0].widthPt} x ${loAnalysis.pages[0].heightPt} pt (A4)` : 'N/A',
      'Sin Etiquetas': loAnalysis && loAnalysis.unresolvedTagsCount === 0 ? 'SÍ' : 'NO',
      'Caracteres ES': loAnalysis ? `${loAnalysis.presentCharsCount}/${loAnalysis.totalCharsChecked}` : 'N/A',
      'Cláusulas (1-9)': loAnalysis ? `${loAnalysis.presentClausesCount}/${loAnalysis.totalClauses}` : 'N/A',
      'Firmas OK': loAnalysis && loAnalysis.hasSignatures ? 'SÍ' : 'NO',
      'Tablas Turnos': loAnalysis && loAnalysis.hasTableData ? 'SÍ' : 'NO',
      'Numeración Pág': loAnalysis && loAnalysis.hasPageNumbering ? 'SÍ' : 'NO'
    },
    {
      Motor: 'Gotenberg v8 (HTTP API Linux)',
      Entorno: 'Docker / Cloud Run Container',
      TiempoMs: gotenbergDurationMs,
      Tamaño: gotenbergAnalysis ? gotenbergAnalysis.sizeFormatted : 'N/A',
      Páginas: gotenbergAnalysis ? gotenbergAnalysis.pageCount : 'N/A',
      Dimensiones: gotenbergAnalysis ? `${gotenbergAnalysis.pages[0].widthPt} x ${gotenbergAnalysis.pages[0].heightPt} pt (A4)` : 'N/A',
      'Sin Etiquetas': gotenbergAnalysis && gotenbergAnalysis.unresolvedTagsCount === 0 ? 'SÍ' : 'NO',
      'Caracteres ES': gotenbergAnalysis ? `${gotenbergAnalysis.presentCharsCount}/${gotenbergAnalysis.totalCharsChecked}` : 'N/A',
      'Cláusulas (1-9)': gotenbergAnalysis ? `${gotenbergAnalysis.presentClausesCount}/${gotenbergAnalysis.totalClauses}` : 'N/A',
      'Firmas OK': gotenbergAnalysis && gotenbergAnalysis.hasSignatures ? 'SÍ' : 'NO',
      'Tablas Turnos': gotenbergAnalysis && gotenbergAnalysis.hasTableData ? 'SÍ' : 'NO',
      'Numeración Pág': gotenbergAnalysis && gotenbergAnalysis.hasPageNumbering ? 'SÍ' : 'NO'
    }
  ];

  console.table(summary);

  // Guardar resultado estructurado en JSON
  const outputJson = {
    fecha: new Date().toISOString(),
    fase: 'Fase 1B',
    resumen: summary,
    detalles: {
      wordAnalysis,
      loAnalysis,
      gotenbergAnalysis,
      gotenbergMemoryMeasured: gotenbergMemory
    }
  };

  const resultsPath = path.join(labDir, 'benchmark_results_phase1b.json');
  fs.writeFileSync(resultsPath, JSON.stringify(outputJson, null, 2), 'utf8');
  console.log(`\nResultados guardados exitosamente en: ${resultsPath}`);
}

runBenchmark().catch(err => {
  console.error('Error fatal durante el benchmark:', err);
  process.exit(1);
});
