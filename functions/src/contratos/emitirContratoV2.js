/**
 * ASPRO — CONTRATOS V2
 * Cloud Function: emitirContratoV2
 * 
 * Genera contratos individuales de trabajo a partir de plantillas DOCX maestras,
 * ejecuta sustitución de variables con docxtemplater, convierte a PDF mediante
 * Gotenberg v8 (Cloud Run privado con IAM OIDC), calcula SHA-256 y registra
 * atómicamente el contrato en Contratos/{id} y el documento de firma en documents/{id}.
 */

const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const logger = require('firebase-functions/logger');
const crypto = require('crypto');
const path = require('path');
const fs = require('fs');
const PizZip = require('pizzip');
const Docxtemplater = require('docxtemplater');
const { PDFDocument } = require('pdf-lib');
const { GoogleAuth } = require('google-auth-library');
const axios = require('axios');

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * Función Callable: emitirContratoV2
 */
exports.emitirContratoV2 = onCall(
  {
    region: 'us-central1',
    cors: true,
    timeoutSeconds: 60,
    memory: '1GiB'
  },
  async (request) => {
    const { auth, data } = request;

    // 1. Verificación de Autenticación
    if (!auth || !auth.uid) {
      throw new HttpsError('unauthenticated', 'Debe estar autenticado para emitir contratos.');
    }

    const db = admin.firestore();

    // 2. Control de Acceso basado en Roles (RBAC)
    const actorDoc = await db.collection('Colaboradores').doc(auth.uid).get();
    if (!actorDoc.exists) {
      throw new HttpsError('permission-denied', 'Usuario no registrado en la dotación.');
    }
    const actorRole = actorDoc.data().role;
    if (actorRole !== 'admin' && actorRole !== 'rrhh') {
      throw new HttpsError('permission-denied', `El rol '${actorRole}' no tiene autorización para emitir contratos.`);
    }

    // 3. Verificación de Feature Flag (Gobernanza centralizada)
    let flagMode = 'disabled';
    try {
      const flagDoc = await db.collection('app_config').doc('feature_flags').get();
      if (flagDoc.exists) {
        flagMode = flagDoc.data().contratosV2 || 'disabled';
      }
    } catch (flagErr) {
      logger.warn('[emitirContratoV2] No se pudo leer app_config/feature_flags, asumiendo disabled.', { error: flagErr.message });
    }

    // En entorno no activo, verificar si el usuario tiene bypass de desarrollo o sucursal canary
    const isCanary = flagMode === 'canary';
    const isActive = flagMode === 'active';
    const isDevBypass = Boolean(data && data.__devBypass);

    if (!isActive && !isCanary && !isDevBypass) {
      throw new HttpsError('failed-precondition', 'El módulo Contratos V2 se encuentra actualmente desactivado por configuración de Feature Flag.');
    }

    // 4. Extracción y Validación de Campos Obligatorios
    const {
      colaboradorId,
      plantillaId = 'tpl_ggss_plazo_fijo_v2',
      tipo = 'Plazo Fijo',
      fechaInicio,
      fechaTermino,
      cargo = 'Guardia de Seguridad',
      sucursalId = '0',
      jornada = '45 horas semanales',
      horarioA = '08:00 hrs a 20:00 hrs',
      horarioB = '20:00 hrs a 08:00 hrs',
      sueldoBase,
      canalFirma = 'digital_aspro',
      signatureConfig = null,
      contratoAnteriorId = null
    } = data || {};

    if (!colaboradorId || typeof colaboradorId !== 'string') {
      throw new HttpsError('invalid-argument', 'El identificador de colaborador (colaboradorId) es obligatorio.');
    }
    if (!fechaInicio || typeof fechaInicio !== 'string') {
      throw new HttpsError('invalid-argument', 'La fecha de inicio (fechaInicio) es obligatoria.');
    }
    if (typeof sueldoBase !== 'number' || isNaN(sueldoBase) || sueldoBase <= 0) {
      throw new HttpsError('invalid-argument', 'El sueldo base contractual (sueldoBase) debe ser un número válido mayor a cero.');
    }

    const isPlazoFijo = tipo.toLowerCase().includes('plazo');
    if (isPlazoFijo && !fechaTermino) {
      throw new HttpsError('invalid-argument', 'Los contratos a plazo fijo requieren obligatoriamente una fecha de término.');
    }
    if (fechaTermino && fechaInicio > fechaTermino) {
      throw new HttpsError('invalid-argument', 'La fecha de inicio no puede ser posterior a la fecha de término.');
    }

    // 5. Lectura de Datos del Colaborador
    const workerSnap = await db.collection('Colaboradores').doc(colaboradorId).get();
    if (!workerSnap.exists) {
      throw new HttpsError('not-found', `No se encontró el colaborador con ID '${colaboradorId}'.`);
    }
    const worker = workerSnap.data();

    // 6. Prevención de Duplicados e Idempotencia
    const duplicateQuery = await db.collection('Contratos')
      .where('colaboradorId', '==', colaboradorId)
      .where('tipo', '==', tipo)
      .where('fechaInicio', '==', fechaInicio)
      .get();

    const existingMatch = duplicateQuery.docs.find(d => {
      const c = d.data();
      return (c.fechaTermino || null) === (fechaTermino || null) &&
             c.estado !== 'anulado' &&
             c.estadoEmision === 'emitido';
    });

    if (existingMatch) {
      const dupData = existingMatch.data();
      logger.info(`[emitirContratoV2] Idempotencia: Contrato duplicado detectado #${existingMatch.id}.`);
      return {
        status: 'idempotent_duplicate',
        contratoId: existingMatch.id,
        documentoId: dupData.documentoId || null,
        pdfSha256: dupData.pdfSha256,
        reused: true
      };
    }

    // 7. Carga de Plantilla DOCX Maestra
    // Se utiliza la plantilla sintética validada del laboratorio o Storage
    const templateLocalPath = path.join(__dirname, 'plantilla_maestra_contrato.docx');
    let templateBuffer;
    if (fs.existsSync(templateLocalPath)) {
      templateBuffer = fs.readFileSync(templateLocalPath);
    } else {
      // Fallback a plantilla del laboratorio si se ejecuta en local/emulador
      const labTemplate = path.join(__dirname, '..', '..', '..', 'lab_contratos_v2', 'plantilla_sintetica_contrato.docx');
      if (fs.existsSync(labTemplate)) {
        templateBuffer = fs.readFileSync(labTemplate);
      } else {
        throw new HttpsError('internal', 'Archivo de plantilla DOCX maestra no disponible en el servidor.');
      }
    }

    // 8. Construcción del Payload de Sustitución
    const nombreCompleto = `${worker.firstName || ''} ${worker.lastNamePaterno || ''} ${worker.lastNameMaterno || ''}`.trim() || 'TRABAJADOR';
    const payloadSustitucion = {
      trabajador: {
        nombre: nombreCompleto,
        rut: worker.rut || '---',
        nacionalidad: worker.nacionalidad || 'Chilena',
        estadoCivil: worker.estadoCivil || 'Soltero(a)',
        direccion: worker.direccion || 'Domicilio no registrado',
        email: worker.email || 'sin-correo@ggss.cl',
        telefono: worker.phone || '---',
        afp: worker.afp || 'Modelo',
        salud: worker.salud || 'Fonasa',
        cargo: cargo
      },
      empresa: {
        nombre: 'GESTIÓN GGSS SECURITY SPA',
        rut: '76.999.888-K',
        representante: 'Representante Legal GGSS',
        direccion: "Av. Libertador Bernardo O'Higgins N° 1234",
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
        nombre: 'SUCURSAL ASIGNADA GGSS',
        direccion: 'Dirección de Faena',
        comuna: 'Santiago'
      }
    };

    // 9. Sustitución de Variables con docxtemplater + pizzip
    let docxRellenadoBuffer;
    try {
      const zip = new PizZip(templateBuffer);
      const doc = new Docxtemplater(zip, {
        paragraphLoop: true,
        linebreaks: true,
        delimiters: { start: '{{', end: '}}' },
        parser: tag => ({
          get: scope => (tag ? tag.split('.').reduce((acc, part) => (acc ? acc[part] : undefined), scope) : '')
        })
      });
      doc.render(payloadSustitucion);
      docxRellenadoBuffer = doc.getZip().generate({ type: 'nodebuffer', compression: 'DEFLATE' });
    } catch (docxErr) {
      logger.error('[emitirContratoV2] Error en sustitución DOCX:', docxErr);
      throw new HttpsError('internal', `Error al rellenar variables en plantilla DOCX: ${docxErr.message}`);
    }

    // 10. Conversión en Gotenberg (Cloud Run)
    const gotenbergUrl = process.env.GOTENBERG_URL || 'http://localhost:3005';
    let pdfBuffer;

    try {
      const formData = new FormData();
      const docxBlob = new Blob([docxRellenadoBuffer], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
      });
      formData.append('files', docxBlob, 'contrato_rellenado.docx');

      let headers = {};
      // Si la URL apunta a Cloud Run privado, obtener Identity Token OIDC
      if (gotenbergUrl.includes('run.app')) {
        try {
          const authClient = new GoogleAuth();
          const client = await authClient.getIdTokenClient(gotenbergUrl);
          const authHeaders = await client.getRequestHeaders();
          headers = { ...headers, ...authHeaders };
        } catch (authErr) {
          logger.warn('[emitirContratoV2] No se pudo obtener OIDC Token para Cloud Run:', authErr.message);
        }
      }

      const responseGotenberg = await fetch(`${gotenbergUrl}/forms/libreoffice/convert`, {
        method: 'POST',
        headers,
        body: formData,
        signal: AbortSignal.timeout(35000)
      });

      if (!responseGotenberg.ok) {
        const errorText = await responseGotenberg.text();
        throw new Error(`Gotenberg HTTP ${responseGotenberg.status}: ${errorText}`);
      }

      const pdfArrayBuffer = await responseGotenberg.arrayBuffer();
      pdfBuffer = Buffer.from(pdfArrayBuffer);
    } catch (convErr) {
      logger.error('[emitirContratoV2] Error de conversión en Gotenberg:', convErr.message);
      throw new HttpsError('unavailable', `Fallo en el servicio de conversión de documentos: ${convErr.message}`);
    }

    // 11. Validación Criptográfica y de Estructura
    const pdfSha256 = crypto.createHash('sha256').update(pdfBuffer).digest('hex');
    let pageCount = 4;
    try {
      const pdfDoc = await PDFDocument.load(pdfBuffer);
      pageCount = pdfDoc.getPageCount();
      if (pageCount === 0) throw new Error('El PDF generado no contiene páginas.');
    } catch (pdfErr) {
      logger.error('[emitirContratoV2] Error validando estructura PDF:', pdfErr);
      throw new HttpsError('internal', 'El archivo PDF emitido no tiene una estructura válida.');
    }

    // 12. Identificadores y Almacenamiento en Firebase Storage
    const contratoId = 'cont_' + crypto.randomBytes(8).toString('hex');
    const documentoId = canalFirma === 'digital_aspro' ? 'doc_' + crypto.randomBytes(8).toString('hex') : null;
    const nowIso = new Date().toISOString();

    const storagePdfPath = `contracts/${contratoId}/contrato_emitido.pdf`;
    const storageDocxPath = `contracts/${contratoId}/contrato_rellenado.docx`;

    const bucket = admin.storage().bucket();
    const pdfFile = bucket.file(storagePdfPath);
    const docxFile = bucket.file(storageDocxPath);

    try {
      await pdfFile.save(pdfBuffer, { contentType: 'application/pdf', metadata: { sha256: pdfSha256 } });
      await docxFile.save(docxRellenadoBuffer, { contentType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
    } catch (storageErr) {
      logger.error('[emitirContratoV2] Error guardando archivos en Storage:', storageErr);
      throw new HttpsError('internal', 'No fue posible guardar los archivos en Firebase Storage.');
    }

    // Obtener URL de descarga HTTPS directa para el visor del guardia
    let downloadUrl = '';
    try {
      const [url] = await pdfFile.getSignedUrl({
        action: 'read',
        expires: '2030-01-01'
      });
      downloadUrl = url;
    } catch (signErr) {
      downloadUrl = `https://firebasestorage.googleapis.com/v0/b/${bucket.name}/o/${encodeURIComponent(storagePdfPath)}?alt=media`;
    }

    // 13. Persistencia Atómica en Firestore con Protocolo de Compensación
    try {
      const batch = db.batch();

      // Cálculo de número de renovación si aplica
      let numeroRenovacion = 1;
      if (contratoAnteriorId) {
        const anteriorSnap = await db.collection('Contratos').doc(contratoAnteriorId).get();
        if (anteriorSnap.exists) {
          numeroRenovacion = (anteriorSnap.data().numeroRenovacion || 1) + 1;
          batch.update(anteriorSnap.ref, {
            estado: 'renovado',
            contratoSiguienteId: contratoId,
            modificadoEn: nowIso,
            modificadoPor: auth.uid
          });
        }
      }

      // Nomenclatura oficial: "Contrato + 1er nombre + 1er apellido + DDMM"
      const primerNombre = String(workerData.firstName || '').trim().split(/\s+/)[0] || '';
      const primerApellido = String(workerData.lastNamePaterno || '').trim().split(/\s+/)[0] || '';
      const partesFechaInicio = String(fechaInicio || '').split('T')[0].split('-');
      const ddmmContrato = partesFechaInicio.length === 3
        ? `${partesFechaInicio[2].padStart(2, '0')}${partesFechaInicio[1].padStart(2, '0')}`
        : '';
      const nombreContrato = ['Contrato', primerNombre, primerApellido, ddmmContrato].filter(Boolean).join(' ');

      // Registro en Contratos/{contratoId}
      const contratoRef = db.collection('Contratos').doc(contratoId);
      batch.set(contratoRef, {
        id: contratoId,
        nombreContrato,
        colaboradorId,
        sucursalId: String(sucursalId),
        tipo,
        estado: 'pendiente_firma',
        fechaInicio,
        fechaTermino: fechaTermino || null,
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
        signatureConfig: canalFirma === 'digital_aspro' ? (signatureConfig || { page: 'last', position: 'right' }) : null,
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
      });

      // Si es canal digital, registrar en documents/{documentoId}
      if (canalFirma === 'digital_aspro' && documentoId) {
        const docRef = db.collection('documents').doc(documentoId);
        batch.set(docRef, {
          id: documentoId,
          title: nombreContrato,
          type: 'Contrato',
          assignedTo: colaboradorId,
          status: 'pending',
          originalUrl: downloadUrl,
          contratoId: contratoId,
          createdAt: nowIso,
          signatureConfig: signatureConfig || {
            page: 'last',
            position: 'right'
          }
        });
      }

      await batch.commit();
    } catch (batchErr) {
      // Compensación reactiva: Eliminar archivos huérfanos de Storage si Firestore falló
      logger.error('[emitirContratoV2] Fallo al escribir en Firestore. Iniciando compensación en Storage...', batchErr);
      try {
        await pdfFile.delete();
        await docxFile.delete();
        logger.info('[emitirContratoV2] Compensación completada: Archivos huérfanos eliminados.');
      } catch (cleanErr) {
        logger.error('[emitirContratoV2] Fallo durante compensación:', cleanErr);
      }
      throw new HttpsError('internal', 'Error al registrar contrato en la base de datos. Transacción revertida.');
    }

    // 14. Registro de Auditoría Sanitizado (Zero-PII en Cloud Logging)
    logger.info('[emitirContratoV2] Contrato emitido exitosamente.', {
      contratoId,
      colaboradorId,
      documentoId,
      canalFirma,
      pdfSha256,
      pageCount,
      emisorUid: auth.uid
    });

    return {
      status: 'success',
      contratoId,
      documentoId,
      canalFirma,
      signatureConfig: canalFirma === 'digital_aspro' ? (signatureConfig || { page: 'last', position: 'right' }) : undefined,
      pdfSha256,
      pageCount,
      pdfUrl: downloadUrl
    };
  }
);
