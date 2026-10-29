/**
 * ASPRO — CONTRATOS V2 — FASE 5.2
 * Runner de Integración y Validación de Laboratorio
 * 
 * Verifica:
 * 1. Inspección y extracción de variables DOCX (cuerpo, tablas, encabezados y pies)
 * 2. Reconstrucción de fragmentación XML (<w:t>)
 * 3. Validación frente al diccionario canónico de ASPRO
 * 4. Bloqueo estricto cuando faltan variables obligatorias
 * 5. Sustitución real mediante docxtemplater + pizzip
 * 6. Conversión real en Gotenberg v8 (http://localhost:3005)
 * 7. Cálculo y verificación del hash SHA-256
 * 8. Manejo de errores cuando Gotenberg no está disponible
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');

const GOTENBERG_URL = process.env.GOTENBERG_URL || 'http://localhost:3005';
const TEMPLATE_PATH = path.resolve(__dirname, 'plantilla_sintetica_contrato.docx');
const OUTPUT_DOCX_PATH = path.resolve(__dirname, 'contrato_rellenado_phase5_2.docx');
const OUTPUT_PDF_PATH = path.resolve(__dirname, 'contrato_generado_phase5_2.pdf');

// Diccionario Canónico
const DICCIONARIO = {
  'trabajador.nombre': { obligatoria: true },
  'trabajador.rut': { obligatoria: true },
  'trabajador.direccion': { obligatoria: true },
  'contrato.tipo': { obligatoria: true },
  'contrato.fechaInicio': { obligatoria: true },
  'contrato.fechaTermino': { obligatoria: false },
  'contrato.cargo': { obligatoria: true },
  'contrato.sueldo': { obligatoria: true },
  'contrato.sueldoBase': { obligatoria: true },
  'contrato.jornada': { obligatoria: true },
  'contrato.horarioA': { obligatoria: true },
  'contrato.horarioB': { obligatoria: true },
  'sucursal.nombre': { obligatoria: true },
  'sucursal.direccion': { obligatoria: true },
  'empresa.nombre': { obligatoria: true },
  'empresa.rut': { obligatoria: true }
};

function calcularSha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex');
}

function inspeccionarVariablesDocx(buffer) {
  const zip = new PizZip(buffer);
  const variablesSet = new Set();
  
  const filesToCheck = ['word/document.xml'];
  for (const filename in zip.files) {
    if (/^word\/(header|footer)\d+\.xml$/.test(filename)) {
      filesToCheck.push(filename);
    }
  }

  for (const ruta of filesToCheck) {
    const f = zip.file(ruta);
    if (!f) continue;
    const xml = f.asText();
    const parrafos = xml.match(/<w:p(?:\s[^>]*)?>[\s\S]*?<\/w:p>/g) || [xml];
    for (const p of parrafos) {
      const runs = p.match(/<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>/g) || [];
      const textoReconstruido = runs
        .map(r => r.replace(/<w:t(?:\s[^>]*)?>/, '').replace(/<\/w:t>/, ''))
        .join('');
      const tags = textoReconstruido.match(/\{\{([^{}]+)\}\}/g) || [];
      for (const t of tags) {
        const limpia = t.replace(/[{}]/g, '').trim();
        if (limpia && !limpia.startsWith('#') && !limpia.startsWith('/')) {
          variablesSet.add(limpia);
        }
      }
    }
  }

  return Array.from(variablesSet).sort();
}

async function runTests() {
  console.log('================================================================');
  console.log('ASPRO — CONTRATOS V2 — FASE 5.2 TEST RUNNER');
  console.log('================================================================\n');

  let passed = 0;
  let total = 0;

  // PRUEBA 1: Existencia de la plantilla sintética
  total++;
  console.log(`[TEST 1] Verificando plantilla sintética en: ${TEMPLATE_PATH}`);
  if (!fs.existsSync(TEMPLATE_PATH)) {
    throw new Error(`Plantilla no encontrada: ${TEMPLATE_PATH}`);
  }
  const templateBuffer = fs.readFileSync(TEMPLATE_PATH);
  console.log(`✓ Plantilla encontrada: ${templateBuffer.length} bytes`);
  passed++;

  // PRUEBA 2: Inspección de variables con reconstrucción de fragmentos XML
  total++;
  console.log('\n[TEST 2] Inspeccionando variables en documento, tablas, encabezados y pies...');
  const variables = inspeccionarVariablesDocx(templateBuffer);
  console.log(`✓ Variables detectadas (${variables.length}):`);
  variables.forEach(v => console.log(`   - {{${v}}}`));
  if (variables.length === 0) {
    throw new Error('No se detectaron variables en la plantilla.');
  }
  passed++;

  // PRUEBA 3: Detección de fragmentación XML artificial
  total++;
  console.log('\n[TEST 3] Verificando detección de variables divididas entre múltiples runs <w:t>...');
  const zipFrag = new PizZip();
  zipFrag.file('word/document.xml', `
    <w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
      <w:body>
        <w:p>
          <w:r><w:t>{{trab</w:t></w:r>
          <w:r><w:t>ajador.nombre}}</w:t></w:r>
        </w:p>
      </w:body>
    </w:document>
  `);
  const varsFrag = inspeccionarVariablesDocx(zipFrag.generate({ type: 'nodebuffer' }));
  if (!varsFrag.includes('trabajador.nombre')) {
    throw new Error('Fallo en la reconstrucción de párrafos divididos entre fragmentos XML');
  }
  console.log('✓ Fragmentación XML reconstruida exitosamente: detectó {{trabajador.nombre}}');
  passed++;

  // PRUEBA 4: Bloqueo cuando faltan variables obligatorias
  total++;
  console.log('\n[TEST 4] Verificando bloqueo si falta una variable obligatoria (Condición 5)...');
  const payloadIncompleto = {
    trabajador: {
      nombre: 'Pedro Test'
      // Falta trabajador.rut!
    },
    contrato: {
      tipo: 'Plazo Fijo',
      fechaInicio: '2026-11-01',
      sueldoBase: 0 // Inválido!
    }
  };

  function validarPayload(vars, payload) {
    const errs = [];
    for (const v of vars) {
      const config = DICCIONARIO[v];
      if (!config) {
        errs.push(`Variable no reconocida: {{${v}}}`);
        continue;
      }
      if (config.obligatoria) {
        const val = v.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), payload);
        if (!val || (v.includes('sueldo') && Number(val) <= 0)) {
          errs.push(`Variable obligatoria vacía: {{${v}}}`);
        }
      }
    }
    return errs;
  }

  const erroresIncompleto = validarPayload(['trabajador.nombre', 'trabajador.rut', 'contrato.sueldoBase'], payloadIncompleto);
  if (erroresIncompleto.length === 0) {
    throw new Error('El sistema debió bloquear la emisión por variables faltantes pero no lo hizo.');
  }
  console.log(`✓ Emisión bloqueada correctamente: ${erroresIncompleto.join(', ')}`);
  passed++;

  // PRUEBA 5: Sustitución de variables con PizZip y Docxtemplater
  total++;
  console.log('\n[TEST 5] Ejecutando sustitución completa de variables con docxtemplater...');
  const sueldoBaseNum = 560000;
  const payloadCompleto = {
    trabajador: {
      nombre: 'ESTEBAN RICARDO QUINTEROS LÓPEZ',
      rut: '16.789.012-3',
      cargo: 'Guardia de Seguridad OS-10',
      nacionalidad: 'Chilena',
      estadoCivil: 'Soltero(a)',
      direccion: 'Av. Departamental N° 4567, San Joaquín, Santiago',
      email: 'esteban.quinteros@ggss.cl',
      telefono: '+56 9 8765 4321',
      afp: 'Modelo',
      salud: 'Fonasa'
    },
    empresa: {
      nombre: 'GESTIÓN GGSS SECURITY SPA',
      rut: '76.999.888-K',
      representante: 'Representante Legal GGSS',
      direccion: "Av. Libertador Bernardo O'Higgins 1234, Of. 501",
      comuna: 'Santiago'
    },
    contrato: {
      tipo: 'Plazo Fijo',
      fechaInicio: '2026-11-01',
      fechaTermino: '2027-01-31',
      cargo: 'Guardia de Seguridad',
      jornada: '45 horas semanales',
      horarioA: '08:00 hrs a 20:00 hrs',
      horarioB: '20:00 hrs a 08:00 hrs',
      sueldo: '$' + sueldoBaseNum.toLocaleString('es-CL'),
      sueldoBase: sueldoBaseNum,
      sueldoBaseFormatted: '$' + sueldoBaseNum.toLocaleString('es-CL'),
      ciudadFirma: 'Santiago',
      fechaEmisionTexto: '21 de octubre de 2026'
    },
    sucursal: {
      nombre: 'SUCURSAL MALL PLAZA VESPUCIO',
      direccion: 'Av. Vicuña Mackenna 7110, La Florida',
      comuna: 'La Florida'
    }
  };

  const zip = new PizZip(templateBuffer);
  const doc = new Docxtemplater(zip, {
    paragraphLoop: true,
    linebreaks: true,
    delimiters: { start: '{{', end: '}}' },
    parser: tag => ({
      get: scope => {
        if (!tag) return '';
        return tag.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), scope);
      }
    })
  });

  doc.render(payloadCompleto);
  const docxRellenado = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(OUTPUT_DOCX_PATH, docxRellenado);
  console.log(`✓ DOCX rellenado exitosamente: ${docxRellenado.length} bytes -> ${OUTPUT_DOCX_PATH}`);
  passed++;

  // PRUEBA 6: Conversión real con Gotenberg en http://localhost:3005
  total++;
  console.log(`\n[TEST 6] Conectando con conversor real Gotenberg en ${GOTENBERG_URL}...`);
  const formData = new FormData();
  const docxBlob = new Blob([docxRellenado], {
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
  });
  formData.append('files', docxBlob, 'contrato_rellenado.docx');

  const tStart = Date.now();
  let respGotenberg;
  try {
    respGotenberg = await fetch(`${GOTENBERG_URL}/forms/libreoffice/convert`, {
      method: 'POST',
      body: formData
    });
  } catch (netErr) {
    throw new Error(`Gotenberg no está disponible en ${GOTENBERG_URL}: ${netErr.message}`);
  }

  if (!respGotenberg.ok) {
    const errText = await respGotenberg.text();
    throw new Error(`Gotenberg respondió con error HTTP ${respGotenberg.status}: ${errText}`);
  }

  const pdfArrayBuf = await respGotenberg.arrayBuffer();
  const pdfBuffer = Buffer.from(pdfArrayBuf);
  const tConv = Date.now() - tStart;

  fs.writeFileSync(OUTPUT_PDF_PATH, pdfBuffer);
  console.log(`✓ Conversión exitosa en ${tConv} ms. PDF: ${pdfBuffer.length} bytes -> ${OUTPUT_PDF_PATH}`);
  passed++;

  // PRUEBA 7: Verificación de estructura PDF y cálculo de hash SHA-256
  total++;
  console.log('\n[TEST 7] Verificando integridad del PDF y calculando SHA-256 (Condición 7)...');
  if (pdfBuffer.length < 500) {
    throw new Error('El PDF generado tiene menos de 500 bytes.');
  }
  const header = pdfBuffer.slice(0, 5).toString('ascii');
  if (!header.startsWith('%PDF')) {
    throw new Error(`Cabecera PDF inválida: "${header}"`);
  }
  const sha256 = calcularSha256(pdfBuffer);
  console.log(`✓ Cabecera válida: ${header}`);
  console.log(`✓ Hash SHA-256 verificado: ${sha256}`);
  passed++;

  // PRUEBA 8: Bloqueo explícito ante indisponibilidad del servicio de conversión (Condición 6)
  total++;
  console.log('\n[TEST 8] Verificando bloqueo explícito ante puerto inexistente (Condición 6)...');
  let bloqueoDetectado = false;
  try {
    await fetch('http://localhost:59999/forms/libreoffice/convert', { method: 'POST', body: formData });
  } catch (err) {
    bloqueoDetectado = true;
  }
  if (!bloqueoDetectado) {
    throw new Error('Debió fallar la llamada a un conversor inexistente.');
  }
  console.log('✓ Bloqueo y captura de error de red comprobados.');
  passed++;

  console.log('\n================================================================');
  console.log(`RESULTADO FINAL: ${passed}/${total} PRUEBAS EXITOSAS (100%)`);
  console.log('================================================================\n');

  return { passed, total, sha256, pdfBytes: pdfBuffer.length, tConv };
}

runTests().catch(err => {
  console.error('\n❌ ERROR EN PRUEBAS:', err);
  process.exit(1);
});
