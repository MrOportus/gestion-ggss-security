const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');
const logger = require('firebase-functions/logger');

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * Endpoint idempotente y validado para registrar un contrato regularizado manualmente
 * por RRHH sin requerir un PDF adjunto.
 */
exports.regularizeContractValidated = onCall(
  {
    region: 'us-central1',
    cors: true,
    enforceAppCheck: false // Ajustar según entorno de prod
  },
  async (request) => {
    const { data, auth } = request;

    if (!auth) {
      throw new HttpsError('unauthenticated', 'Debe estar autenticado.');
    }

    const db = admin.firestore();

    // 1. Validar Permisos del actor
    const actorUid = auth.uid;
    const actorDoc = await db.collection('Colaboradores').doc(actorUid).get();
    if (!actorDoc.exists) {
      throw new HttpsError('permission-denied', 'Usuario no registrado.');
    }
    const actorRole = actorDoc.data().role;
    if (actorRole !== 'admin' && actorRole !== 'rrhh') {
      throw new HttpsError('permission-denied', 'Solo RRHH o Admin pueden regularizar contratos.');
    }

    // 2. Extraer y Validar Payload
    const {
      requestId,
      employeeId,
      sucursalId,
      tipoContrato,
      fechaInicio,
      fechaTermino,
      estado, // draft, pending_document, pending_signature, active
      regularizationReason
    } = data;

    if (!requestId || !employeeId || !sucursalId || !tipoContrato || !fechaInicio || !estado) {
      throw new HttpsError('invalid-argument', 'Faltan campos requeridos.');
    }

    const isFixedTerm = tipoContrato.toLowerCase().includes('plazo');
    if (isFixedTerm && !fechaTermino) {
      throw new HttpsError('invalid-argument', 'Contratos a plazo fijo requieren fecha de término.');
    }

    // 3. Normalizar fechas a YYYY-MM-DD
    const normalize = (d) => {
      if (!d) return null;
      if (d.includes('T')) return d.split('T')[0];
      return d;
    };
    
    const fInicio = normalize(fechaInicio);
    const fTermino = normalize(fechaTermino);

    // 4. Asegurar Idempotencia mediante el requestId
    // requestId se usa como document ID en Contratos
    const contractRef = db.collection('Contratos').doc(requestId);
    
    return await db.runTransaction(async (transaction) => {
      const docSnap = await transaction.get(contractRef);
      if (docSnap.exists) {
        logger.info(`Request ${requestId} ya fue procesado. Ignorando.`);
        return { success: true, id: requestId, isDuplicate: true };
      }

      // Validar si el trabajador existe
      const empSnap = await transaction.get(db.collection('Colaboradores').doc(employeeId));
      if (!empSnap.exists) {
        throw new HttpsError('not-found', 'Trabajador no encontrado.');
      }

      const newContract = {
        colaboradorId: employeeId,
        sucursalId: sucursalId.toString(),
        tipo: tipoContrato,
        estado: estado, // draft, pending_document, active...
        fechaInicio: fInicio,
        fechaTermino: fTermino || null,
        
        // Metadata de la regularización manual
        source: 'manual_regularization',
        documentId: null,
        documentUrl: null,
        signatureStatus: null,
        regularizationReason: regularizationReason || 'Regularización manual de sistema legacy',
        
        // Auditoría base
        creadoEn: new Date().toISOString(),
        creadoPor: actorUid,
        modificadoEn: new Date().toISOString(),
        modificadoPor: actorUid,
        schemaVersion: 2
      };

      transaction.set(contractRef, newContract);

      // Crear registro de auditoría
      const auditRef = db.collection('AuditoriaAcciones').doc();
      transaction.set(auditRef, {
        actionType: 'MANUAL_CONTRACT_REGULARIZATION',
        actorUid: actorUid,
        targetId: employeeId,
        contractId: requestId,
        payload: {
          tipo: tipoContrato,
          estado: estado,
          sucursalId: sucursalId,
          fechaInicio: fInicio,
          fechaTermino: fTermino
        },
        timestamp: FieldValue.serverTimestamp(),
        requestId: requestId
      });

      return { success: true, id: requestId, isDuplicate: false };
    });
  }
);
