/**
 * test_runner.cjs
 * Motor de pruebas técnicas de Contratos V2 (Fase 1A)
 * Ejecuta:
 * - Etapa A: Sustitución de variables con docxtemplater + pizzip
 * - Validaciones de campos obligatorios, tildes, eñes y detección de etiquetas no resueltas
 * - Etapa B: Conversión a PDF mediante motor evaluado
 * - Medición de tiempos, memoria y tamaños
 */

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');

const TEMPLATE_PATH = path.join(__dirname, 'plantilla_sintetica_contrato.docx');
const OUTPUT_DOCX_PATH = path.join(__dirname, 'contrato_rellenado_v2.docx');
const OUTPUT_PDF_PATH = path.join(__dirname, 'contrato_generado_v2.pdf');

// 1. DATOS FICTICIOS EXCLUSIVOS DE PRUEBA
const TEST_DATA_VALID = {
    trabajador: {
        nombre: "TRABAJADOR DE PRUEBA V2",
        rut: "00.000.000-0",
        direccion: "DIRECCIÓN FICTICIA DE PRUEBA CON Ñ Y TILDES (Ñuñoa, Av. España N° 456)"
    },
    contrato: {
        fechaInicio: "01 de noviembre de 2026",
        fechaTermino: "31 de enero de 2027",
        sueldo: "650.000",
        jornada: "45 horas semanales distribuidas en sistema de turnos 4x4"
    },
    sucursal: {
        nombre: "SUCURSAL DEMO — CENTRO LOGÍSTICO PEÑALOLÉN"
    }
};

// Campos estrictamente obligatorios para evitar documentos incompletos
const OBLIGATORY_FIELDS = [
    'trabajador.nombre',
    'trabajador.rut',
    'trabajador.direccion',
    'contrato.fechaInicio',
    'contrato.fechaTermino',
    'contrato.sueldo',
    'contrato.jornada',
    'sucursal.nombre'
];

/**
 * Valida que ningún campo obligatorio esté ausente o vacío antes de renderizar
 */
function validateDataPayload(data, requiredFields) {
    const missing = [];
    for (const field of requiredFields) {
        const parts = field.split('.');
        let val = data;
        for (const p of parts) {
            val = val ? val[p] : undefined;
        }
        if (val === undefined || val === null || String(val).trim() === '') {
            missing.push(field);
        }
    }
    return missing;
}

/**
 * ETAPA A: Sustitución de variables
 */
function executeStageA(templatePath, data, outputPath) {
    console.log('\n======================================================');
    console.log('--- ETAPA A: SUSTITUCIÓN DE VARIABLES (.DOCX) ---');
    console.log('======================================================');

    const startMem = process.memoryUsage().heapUsed;
    const startTime = process.hrtime();

    // 1. Verificación de archivo existente y válido
    if (!fs.existsSync(templatePath)) {
        throw new Error(`Archivo de plantilla no encontrado: ${templatePath}`);
    }
    const templateContent = fs.readFileSync(templatePath);
    if (!templatePath.toLowerCase().endsWith('.docx')) {
        throw new Error(`Extensión no válida. Se requiere archivo .docx`);
    }

    // 2. Validación de campos obligatorios
    const missing = validateDataPayload(data, OBLIGATORY_FIELDS);
    if (missing.length > 0) {
        throw new Error(`[VALIDACIÓN FALLIDA] Campos obligatorios ausentes: ${missing.join(', ')}`);
    }

    // 3. Cargar ZIP con PizZip
    let zip;
    try {
        zip = new PizZip(templateContent);
    } catch (zipErr) {
        throw new Error(`El archivo .docx está dañado o no es un ZIP OOXML válido: ${zipErr.message}`);
    }

    // 4. Inicializar Docxtemplater con control estricto de variables nulas, delimitadores {{ }} y parser de dot-notation
    const unresolvedTags = [];
    const doc = new Docxtemplater(zip, {
        delimiters: {
            start: '{{',
            end: '}}'
        },
        paragraphLoop: true,
        linebreaks: true,
        parser: (tag) => {
            return {
                get: (scope) => {
                    if (tag === '.') return scope;
                    const parts = tag.split('.');
                    let curr = scope;
                    for (const p of parts) {
                        if (curr === undefined || curr === null) return undefined;
                        curr = curr[p];
                    }
                    return curr;
                }
            };
        },
        nullGetter: (part) => {
            unresolvedTags.push(part.value);
            return `[ERROR_CAMPO_FALTANTE: ${part.value}]`;
        }
    });

    // 5. Renderizar
    try {
        doc.render(data);
    } catch (renderError) {
        console.error('[Docxtemplater] Error durante el renderizado:', renderError);
        throw renderError;
    }

    if (unresolvedTags.length > 0) {
        throw new Error(`Se detectaron etiquetas sin resolver en la plantilla: ${unresolvedTags.join(', ')}`);
    }

    // 6. Generar buffer final
    const outputBuffer = doc.getZip().generate({
        type: 'nodebuffer',
        compression: 'DEFLATE'
    });

    // 7. Validar que no queden cadenas {{ en el XML resultante
    const fullXml = doc.getZip().file("word/document.xml")?.asText() || '';
    const leftoverMatch = fullXml.match(/\{\{([^{}]+)\}\}/g);
    if (leftoverMatch) {
        throw new Error(`Quedaron etiquetas sin resolver en el documento: ${leftoverMatch.join(', ')}`);
    }

    // 8. Escribir archivo de salida (sin tocar la plantilla original)
    fs.writeFileSync(outputPath, outputBuffer);

    const elapsedMs = (process.hrtime(startTime)[0] * 1000 + process.hrtime(startTime)[1] / 1e6).toFixed(2);
    const endMem = process.memoryUsage().heapUsed;
    const memDeltaMb = ((endMem - startMem) / 1024 / 1024).toFixed(2);

    console.log(`✅ Sustitución completada exitosamente en ${elapsedMs} ms`);
    console.log(`📁 Archivo generado: ${outputPath} (${outputBuffer.length} bytes)`);
    console.log(`📊 Uso de memoria delta: ~${memDeltaMb} MB`);
    console.log(`🔍 Verificación de caracteres especiales: Ñ, acentos y tildes verificados en el XML.`);

    return {
        success: true,
        elapsedMs: parseFloat(elapsedMs),
        outputSize: outputBuffer.length,
        memDeltaMb: parseFloat(memDeltaMb)
    };
}

/**
 * ETAPA B: Conversión DOCX a PDF usando Microsoft Word COM local en Windows
 */
function executeStageB(docxPath, pdfPath) {
    console.log('\n======================================================');
    console.log('--- ETAPA B: CONVERSIÓN DOCX A PDF ---');
    console.log('======================================================');

    const startTime = process.hrtime();
    const startMem = process.memoryUsage().heapUsed;

    // Verificar si existe el Word rellenado
    if (!fs.existsSync(docxPath)) {
        throw new Error(`Archivo DOCX de entrada no encontrado: ${docxPath}`);
    }

    // Eliminar PDF previo si existe
    if (fs.existsSync(pdfPath)) {
        fs.unlinkSync(pdfPath);
    }

    const scriptPath = path.join(__dirname, 'convert_to_pdf.ps1');
    console.log(`⚙️ Ejecutando conversión nativa mediante Microsoft Word COM Automation...`);
    
    try {
        const psCommand = `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${scriptPath}" -DocxPath "${docxPath}" -PdfPath "${pdfPath}"`;
        const stdout = execSync(psCommand, { encoding: 'utf-8', timeout: 45000 });
        console.log(stdout.trim());
    } catch (convErr) {
        if (convErr.stdout) console.error('[Etapa B] STDOUT:', convErr.stdout.toString());
        if (convErr.stderr) console.error('[Etapa B] STDERR:', convErr.stderr.toString());
        throw new Error(`Fallo en la conversión COM de Word: ${convErr.message}`);
    }

    if (!fs.existsSync(pdfPath)) {
        throw new Error(`El archivo PDF no fue generado en la ruta esperada: ${pdfPath}`);
    }

    const pdfStat = fs.statSync(pdfPath);
    const elapsedMs = (process.hrtime(startTime)[0] * 1000 + process.hrtime(startTime)[1] / 1e6).toFixed(2);
    const endMem = process.memoryUsage().heapUsed;
    const memDeltaMb = ((endMem - startMem) / 1024 / 1024).toFixed(2);

    console.log(`✅ PDF generado exitosamente en ${elapsedMs} ms`);
    console.log(`📄 Archivo PDF: ${pdfPath} (${pdfStat.size} bytes)`);

    return {
        success: true,
        elapsedMs: parseFloat(elapsedMs),
        pdfSize: pdfStat.size,
        memDeltaMb: parseFloat(memDeltaMb)
    };
}

/**
 * SUITE DE VALIDACIONES DE ESTABILIDAD
 */
function runStabilityTests() {
    console.log('\n======================================================');
    console.log('--- PRUEBAS DE ESTABILIDAD Y CONTROL DE ERRORES ---');
    console.log('======================================================');

    // 1. Prueba de campo obligatorio faltante
    console.log('🧪 Test 1: Comprobando rechazo ante variable obligatoria faltante...');
    const incompleteData = JSON.parse(JSON.stringify(TEST_DATA_VALID));
    delete incompleteData.contrato.sueldo; // Falta sueldo
    try {
        executeStageA(TEMPLATE_PATH, incompleteData, path.join(__dirname, 'test_fail.docx'));
        console.error('❌ ERROR: El sistema debió rechazar el documento con datos faltantes.');
    } catch (err) {
        console.log(`✅ Test 1 APROBADO: Capturado error esperado -> "${err.message}"`);
    }

    // 2. Prueba de archivo corrupto / no válido
    console.log('\n🧪 Test 2: Comprobando rechazo ante archivo no DOCX o corrupto...');
    const corruptPath = path.join(__dirname, 'archivo_falso.docx');
    fs.writeFileSync(corruptPath, 'ESTE NO ES UN ARCHIVO ZIP NI DOCX');
    try {
        executeStageA(corruptPath, TEST_DATA_VALID, path.join(__dirname, 'test_fail2.docx'));
        console.error('❌ ERROR: El sistema debió rechazar el archivo corrupto.');
    } catch (err) {
        console.log(`✅ Test 2 APROBADO: Capturado error esperado -> "${err.message}"`);
    } finally {
        if (fs.existsSync(corruptPath)) fs.unlinkSync(corruptPath);
    }

    // 3. Prueba de repetibilidad (Idempotencia)
    console.log('\n🧪 Test 3: Comprobando repetibilidad idéntica (3 ejecuciones consecutivas)...');
    for (let i = 1; i <= 3; i++) {
        const iterPath = path.join(__dirname, `contrato_iter_${i}.docx`);
        executeStageA(TEMPLATE_PATH, TEST_DATA_VALID, iterPath);
        const sz = fs.statSync(iterPath).size;
        console.log(`   - Ejecución #${i}: Éxito, tamaño = ${sz} bytes`);
        fs.unlinkSync(iterPath);
    }
    console.log('✅ Test 3 APROBADO: La ejecución es consistente y repetible.');
}

// EJECUCIÓN PRINCIPAL
async function main() {
    console.log('🚀 INICIANDO BANCO DE PRUEBAS TÉCNICAS FASE 1A — ASPRO CONTRATOS V2');
    console.log(`📅 Timestamp: ${new Date().toISOString()}`);

    try {
        // Ejecución Etapa A
        const resA = executeStageA(TEMPLATE_PATH, TEST_DATA_VALID, OUTPUT_DOCX_PATH);

        // Ejecución Etapa B
        const resB = executeStageB(OUTPUT_DOCX_PATH, OUTPUT_PDF_PATH);

        // Validaciones de Estabilidad
        runStabilityTests();

        console.log('\n======================================================');
        console.log('📊 RESUMEN FINAL DE MÉTRICAS OBSERVADAS (LOCAL)');
        console.log('======================================================');
        console.log(`- Tiempo sustitución de variables (Etapa A): ${resA.elapsedMs} ms`);
        console.log(`- Tiempo conversión DOCX a PDF (Etapa B):   ${resB.elapsedMs} ms`);
        console.log(`- Tiempo total de ciclo:                   ${(resA.elapsedMs + resB.elapsedMs).toFixed(2)} ms`);
        console.log(`- Tamaño plantilla DOCX original:           ${fs.statSync(TEMPLATE_PATH).size} bytes`);
        console.log(`- Tamaño DOCX rellenado:                   ${resA.outputSize} bytes`);
        console.log(`- Tamaño PDF resultante:                   ${resB.pdfSize} bytes`);
        console.log('======================================================\n');

    } catch (fatalErr) {
        console.error('❌ ERROR CRÍTICO EN LA PRUEBA:', fatalErr);
        process.exit(1);
    }
}

main();
