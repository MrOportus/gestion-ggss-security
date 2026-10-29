/**
 * ASPRO — CONTRATOS V2 — FASE 2
 * Prototipo Funcional de Laboratorio: Cloud Function emitirContratoV2
 * 
 * Implementa la lógica técnica completa de emisión contractual diseñada en Fase 1C:
 * - Validación de roles autorizados (admin / rrhh)
 * - Validación exhaustiva de campos requeridos
 * - Idempotencia y prevención de duplicados
 * - Sustitución de variables con docxtemplater + pizzip
 * - Conversión DOCX -> PDF con Gotenberg v8 (vía HTTP API)
 * - Cálculo de hash criptográfico SHA-256
 * - Verificación de estructura y páginas con pdf-lib
 * - Generación de payloads canónicos para Contratos/{id} y documents/{id}
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const { PDFDocument } = require('pdf-lib');

class ContractEmissionError extends Error {
  constructor(message, code = 'invalid-argument', status = 400) {
    super(message);
    this.name = 'ContractEmissionError';
    this.code = code;
    this.status = status;
  }
}

/**
 * Prototipo de la Cloud Function emitirContratoV2
 */
async function emitirContratoV2(request, context = {}) {
  const { auth, data } = request;

  // 1. Control de acceso por rol
  if (!auth || !auth.uid) {
    throw new ContractEmissionError('No autenticado. Se requiere inicio de sesión.', 'unauthenticated', 401);
  }
  const allowedRoles = ['admin', 'rrhh'];
  if (!allowedRoles.includes(auth.role)) {
    throw new ContractEmissionError(`Permiso denegado. El rol '${auth.role}' no tiene autorización para emitir contratos.`, 'permission-denied', 403);
  }

  // 2. Validación de campos mínimos obligatorios
  const {
    colaboradorId,
    plantillaId = 'tpl_sintetica_v2',
    tipo = 'Plazo Fijo',
    fechaInicio,
    fechaTermino,
    cargo = 'Guardia de Seguridad',
    jornada = '45 horas semanales',
    horarioA = '08:00 hrs a 20:00 hrs',
    horarioB = '20:00 hrs a 08:00 hrs',
    sueldoBase,
    sucursalId = '1',
    sucursalNombre = 'SUCURSAL DEMO — CENTRO LOGÍSTICO PEÑALOLÉN',
    sucursalDireccion = 'Av. Peñalolén Oriente N° 8900, Peñalolén, Santiago',
    empresaMandante = 'GGSS CLIENTE DEMO SPA',
    rutEmpresaMandante = '77.123.456-7',
    canalFirma = 'digital_aspro' // 'digital_aspro' | 'fisica_manuscrita'
  } = data || {};

  if (!colaboradorId) throw new ContractEmissionError('El campo colaboradorId es obligatorio.');
  if (!fechaInicio) throw new ContractEmissionError('La fechaInicio es obligatoria.');
  if (typeof sueldoBase !== 'number' || isNaN(sueldoBase) || sueldoBase <= 0) {
    throw new ContractEmissionError('El sueldo base contractual (sueldoBase) debe ser un número válido mayor a cero.');
  }

  const isPlazoFijo = tipo.toLowerCase().includes('plazo');
  if (isPlazoFijo && !fechaTermino) {
    throw new ContractEmissionError('Los contratos a plazo fijo requieren obligatoriamente una fecha de término.');
  }
  if (fechaTermino && fechaInicio > fechaTermino) {
    throw new ContractEmissionError('La fecha de inicio no puede ser posterior a la fecha de término.');
  }

  // 3. Driver simulado de base de datos de laboratorio
  const db = context.mockDb || {
    existingContracts: [],
    getExistingContracts: () => db.existingContracts,
    saveContract: (c) => db.existingContracts.push(c)
  };

  // 4. Detección de duplicados e idempotencia
  const existingContracts = db.getExistingContracts();
  const duplicate = existingContracts.find(c => 
    c.colaboradorId === colaboradorId &&
    c.tipo === tipo &&
    c.fechaInicio === fechaInicio &&
    (c.fechaTermino || null) === (fechaTermino || null) &&
    c.estado !== 'anulado' &&
    c.estadoEmision === 'emitido'
  );

  if (duplicate) {
    return {
      status: 'idempotent_duplicate',
      message: 'Contrato idéntico ya emitido previamente. Retornando registro existente.',
      contratoId: duplicate.id,
      documentoId: duplicate.documentoId || null,
      pdfSha256: duplicate.pdfSha256,
      pdfPath: duplicate.pdfStoragePath,
      reused: true
    };
  }

  // 5. Cargar plantilla DOCX maestra
  const templatePath = context.templatePath || path.join(__dirname, 'plantilla_sintetica_contrato.docx');
  if (!fs.existsSync(templatePath)) {
    throw new ContractEmissionError(`Plantilla DOCX no encontrada en: ${templatePath}`, 'not-found', 404);
  }
  const contentDocx = fs.readFileSync(templatePath);

  // 6. Preparar datos consolidados para sustitución
  const workerData = context.mockWorkerData || {
    nombre: 'TRABAJADOR DE PRUEBA V2',
    rut: '00.000.000-0',
    nacionalidad: 'Chilena',
    estadoCivil: 'Soltero(a)',
    direccion: 'DIRECCIÓN FICTICIA DE PRUEBA CON Ñ Y TILDES (Ñuñoa, Av. España N° 456)',
    email: 'trabajador.demo@ggss-security.cl',
    telefono: '+56 9 1234 5678',
    afp: 'Modelo',
    salud: 'Fonasa'
  };

  const payloadSustitucion = {
    trabajador: {
      nombre: workerData.nombre,
      rut: workerData.rut,
      nacionalidad: workerData.nacionalidad,
      estadoCivil: workerData.estadoCivil,
      direccion: workerData.direccion,
      email: workerData.email,
      telefono: workerData.telefono,
      afp: workerData.afp,
      salud: workerData.salud,
      cargo: cargo
    },
    empresa: {
      nombre: 'GGSS SECURITY SPA',
      rut: '76.999.888-K',
      representante: 'Representante Legal Ficticio',
      direccion: "Av. Libertador Bernardo O'Higgins N° 1234, comuna de Santiago",
      comuna: 'Santiago'
    },
    contrato: {
      tipo: tipo,
      fechaInicio: fechaInicio,
      fechaTermino: fechaTermino || 'Indefinido',
      cargo: cargo,
      jornada: jornada,
      horarioA: horarioA,
      horarioB: horarioB,
      sueldo: Number(sueldoBase).toLocaleString('es-CL'),
      sueldoBase: Number(sueldoBase),
      sueldoBaseFormatted: Number(sueldoBase).toLocaleString('es-CL'),
      ciudadFirma: 'Santiago',
      fechaEmisionTexto: new Date().toLocaleDateString('es-CL', { year: 'numeric', month: 'long', day: 'numeric' })
    },
    sucursal: {
      nombre: sucursalNombre,
      direccion: sucursalDireccion,
      comuna: 'Peñalolén'
    }
  };

  // 7. Sustitución de variables con docxtemplater + pizzip
  const tStartSub = Date.now();
  let zip;
  try {
    zip = new PizZip(contentDocx);
  } catch (zipErr) {
    throw new ContractEmissionError('El archivo de plantilla DOCX está corrupto o es inválido: ' + zipErr.message);
  }

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

  doc.render(payloadSustitucion);
  const docxRellenadoBuffer = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
  const tSubMs = Date.now() - tStartSub;

  // 8. Conversión en Gotenberg v8 (Cloud Run)
  const tStartConv = Date.now();
  const gotenbergUrl = context.gotenbergUrl || process.env.GOTENBERG_URL || 'http://localhost:3005';
  
  const formData = new FormData();
  const docxBlob = new Blob([docxRellenadoBuffer], { 
    type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' 
  });
  formData.append('files', docxBlob, 'contrato_rellenado.docx');

  let responseGotenberg;
  try {
    responseGotenberg = await fetch(`${gotenbergUrl}/forms/libreoffice/convert`, {
      method: 'POST',
      body: formData,
      signal: AbortSignal.timeout(30000)
    });
  } catch (netErr) {
    throw new ContractEmissionError(`Fallo de conexión con servicio Gotenberg (${gotenbergUrl}): ${netErr.message}`, 'unavailable', 503);
  }

  if (!responseGotenberg.ok) {
    const errorBody = await responseGotenberg.text();
    throw new ContractEmissionError(`Gotenberg retornó HTTP ${responseGotenberg.status}: ${errorBody}`, 'internal', 500);
  }

  const pdfArrayBuffer = await responseGotenberg.arrayBuffer();
  const pdfBuffer = Buffer.from(pdfArrayBuffer);
  const tConvMs = Date.now() - tStartConv;

  // 9. Cálculo de hash criptográfico SHA-256
  const pdfSha256 = crypto.createHash('sha256').update(pdfBuffer).digest('hex');

  // 10. Validación estructural del PDF con pdf-lib
  const pdfDoc = await PDFDocument.load(pdfBuffer);
  const pageCount = pdfDoc.getPageCount();
  if (pageCount === 0) {
    throw new ContractEmissionError('El PDF generado no contiene páginas.', 'internal', 500);
  }
  const firstPage = pdfDoc.getPage(0);
  const { width, height } = firstPage.getSize();

  // 11. Generar Identificadores e Inmutabilidad
  const nowIso = new Date().toISOString();
  const contratoId = 'cont_' + crypto.randomBytes(8).toString('hex');
  const documentoId = canalFirma === 'digital_aspro' ? 'doc_' + crypto.randomBytes(8).toString('hex') : null;

  const storageDocxPath = `contracts/${contratoId}/contrato_rellenado.docx`;
  const storagePdfPath = `contracts/${contratoId}/contrato_emitido.pdf`;

  // Storage Driver simulado / mockeable con soporte de compensación
  const storageDriver = context.storageDriver || {
    savedFiles: new Map(),
    save: (p, buf) => storageDriver.savedFiles.set(p, buf),
    delete: (p) => storageDriver.savedFiles.delete(p),
    exists: (p) => storageDriver.savedFiles.has(p)
  };
  storageDriver.save(storagePdfPath, pdfBuffer);
  storageDriver.save(storageDocxPath, docxRellenadoBuffer);

  // Guardar archivo en disco del laboratorio para inspección
  const labOutputDir = context.labOutputDir || __dirname;
  const labPdfFile = path.join(labOutputDir, `proto_${contratoId}.pdf`);
  fs.writeFileSync(labPdfFile, pdfBuffer);

  // Soporte para renovación contractual
  const { contratoAnteriorId } = data || {};
  let numeroRenovacion = 1;
  if (contratoAnteriorId && db.getContractById) {
    const contratoAnterior = db.getContractById(contratoAnteriorId);
    if (contratoAnterior) {
      numeroRenovacion = (contratoAnterior.numeroRenovacion || 1) + 1;
    }
  }

  // 12. Generación del Payload Canónico para Contratos/{contratoId}
  const contratoPayload = {
    id: contratoId,
    colaboradorId,
    sucursalId,
    tipo,
    estado: 'pendiente_firma',
    fechaInicio,
    fechaTermino: fechaTermino || undefined,
    cargo,
    jornada,
    horarioA,
    horarioB,
    sueldoBase: Number(sueldoBase),
    plantillaId,
    plantillaVersion: 2,
    schemaVersion: 2,
    estadoEmision: 'emitido',
    estadoDocumental: canalFirma === 'digital_aspro' ? 'pendiente_firma' : 'no_adjunto',
    canalFirma,
    documentoId,
    docxStoragePath: storageDocxPath,
    pdfStoragePath: storagePdfPath,
    pdfSha256,
    contratoAnteriorId: contratoAnteriorId || null,
    numeroRenovacion,
    creadoEn: nowIso,
    creadoPor: auth.uid,
    emitidoEn: nowIso,
    emitidoPor: auth.uid,
    metadataVariablesSnapshot: payloadSustitucion
  };

  // 13. Payload para documents/{documentoId} (si es firma digital)
  let documentoPayload = null;
  if (canalFirma === 'digital_aspro') {
    // Generar URL HTTPS descargable compatible con fetch() de DocumentsPage.tsx
    const downloadUrl = context.generateDownloadUrl
      ? context.generateDownloadUrl(storagePdfPath)
      : `https://firebasestorage.googleapis.com/v0/b/app-gestion-ggss.appspot.com/o/${encodeURIComponent(storagePdfPath)}?alt=media`;

    documentoPayload = {
      id: documentoId,
      title: `Contrato de Trabajo — ${workerData.nombre}`,
      type: 'Contrato',
      assignedTo: colaboradorId,
      status: 'pending',
      originalUrl: downloadUrl,
      contratoId: contratoId,
      createdAt: nowIso,
      signatureConfig: {
        page: 'last',
        position: 'right'
      }
    };
  }

  // 14. Simulación de fallo en Firestore y compensación reactiva de Storage
  if (context.simulateFirestoreFailure) {
    // Protocolo de compensación: borrar archivo huérfano de Storage
    storageDriver.delete(storagePdfPath);
    storageDriver.delete(storageDocxPath);
    throw new ContractEmissionError('Fallo simulado al persistir en Firestore tras subir a Storage (Compensación ejecutada)', 'internal', 500);
  }

  // 15. Simulación de fallo al asociar documento digital
  if (context.simulateDocumentAssociationFailure && canalFirma === 'digital_aspro') {
    storageDriver.delete(storagePdfPath);
    storageDriver.delete(storageDocxPath);
    throw new ContractEmissionError('Fallo simulado al asociar registro en colección documents (Rollback ejecutado)', 'internal', 500);
  }

  // Guardar en la DB simulada atómicamente
  db.saveContract(contratoPayload);
  if (documentoPayload && db.saveDocument) {
    db.saveDocument(documentoPayload);
  }
  if (contratoAnteriorId && db.updateContract) {
    db.updateContract(contratoAnteriorId, {
      estado: 'renovado',
      contratoSiguienteId: contratoId,
      modificadoEn: nowIso,
      modificadoPor: auth.uid
    });
  }

  return {
    status: 'success',
    contratoId,
    documentoId,
    canalFirma,
    pdfSha256,
    pageCount,
    pageSize: `${width.toFixed(2)} x ${height.toFixed(2)} pt`,
    fileSizeBytes: pdfBuffer.length,
    timings: {
      substitucionMs: tSubMs,
      conversionMs: tConvMs,
      totalMs: tSubMs + tConvMs
    },
    contratoPayload,
    documentoPayload,
    labPdfGenerated: path.basename(labPdfFile)
  };
}

module.exports = {
  emitirContratoV2,
  ContractEmissionError
};
