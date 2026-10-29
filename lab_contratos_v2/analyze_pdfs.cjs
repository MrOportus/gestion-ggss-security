const fs = require('fs');
const path = require('path');
const { PDFDocument } = require('pdf-lib');
const pdfParse = require('pdf-parse');

const labDir = __dirname;

const files = [
  { name: 'Word COM (Referencia Fase 1A)', filename: 'contrato_generado_v2.pdf' },
  { name: 'LibreOffice Headless (CLI Linux)', filename: 'contrato_libreoffice.pdf' },
  { name: 'Gotenberg v8 (HTTP API Linux)', filename: 'contrato_gotenberg.pdf' }
];

async function analyze() {
  console.log('================================================================');
  console.log('ASPRO CONTRATOS V2 - FASE 1B: ANÁLISIS DE FIDELIDAD DOCUMENTAL');
  console.log('================================================================\n');

  const results = [];

  for (const item of files) {
    const filePath = path.join(labDir, item.filename);
    if (!fs.existsSync(filePath)) {
      console.error(`ERROR: Archivo no encontrado: ${item.filename}`);
      continue;
    }

    const stats = fs.statSync(filePath);
    const pdfBytes = fs.readFileSync(filePath);

    // 1. pdf-lib analysis
    const pdfDoc = await PDFDocument.load(pdfBytes);
    const pageCount = pdfDoc.getPageCount();
    const pageDetails = [];
    for (let i = 0; i < pageCount; i++) {
      const page = pdfDoc.getPage(i);
      const { width, height } = page.getSize();
      pageDetails.push({ pageIndex: i + 1, width, height });
    }

    // 2. pdf-parse textual analysis
    const parsed = await pdfParse(pdfBytes);
    const fullText = parsed.text;

    // Checks
    const hasUnresolvedTags = /\{\{[^}]+\}\}/.test(fullText);
    const tagsMatches = fullText.match(/\{\{[^}]+\}\}/g) || [];

    const spanishChars = ['á', 'é', 'í', 'ó', 'ú', 'ñ', 'Á', 'É', 'Í', 'Ó', 'Ú', 'Ñ'];
    const foundChars = spanishChars.filter(ch => fullText.includes(ch));

    // Specific contract sections check
    const requiredSections = [
      'CONTRATO INDIVIDUAL DE TRABAJO',
      'PRIMERO: ANTECEDENTES DE LAS PARTES',
      'SEGUNDO: DE LA FUNCIÓN',
      'TERCERO: JORNADA DE TRABAJO',
      'CUARTO: REMUNERACIÓN',
      'QUINTO: OBLIGACIONES Y PROHIBICIONES',
      'SEXTO: VIGENCIA DEL CONTRATO',
      'SÉPTIMO: DOMICILIO Y JURISDICCIÓN',
      'FIRMA EMPLEADOR',
      'FIRMA TRABAJADOR'
    ];

    const missingSections = requiredSections.filter(sec => {
      // Normalizar acentos para búsqueda tolerante si cambia la codificación
      const normSec = sec.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      const normText = fullText.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
      return !normText.includes(normSec);
    });

    // Check tables content
    const tableKeys = ['TURNO A', 'TURNO B', 'Lunes a Viernes', 'Sábado y Domingo'];
    const missingTableKeys = tableKeys.filter(k => !fullText.includes(k));

    results.push({
      name: item.name,
      filename: item.filename,
      sizeBytes: stats.size,
      pageCount,
      pageDetails,
      textLength: fullText.length,
      hasUnresolvedTags,
      tagsMatches,
      foundCharsCount: foundChars.length,
      totalCharsChecked: spanishChars.length,
      missingSections,
      missingTableKeys,
      sampleTextStart: fullText.substring(0, 180).replace(/\s+/g, ' ')
    });
  }

  console.log(JSON.stringify(results, null, 2));
}

analyze().catch(err => {
  console.error('Error durante el análisis:', err);
  process.exit(1);
});
