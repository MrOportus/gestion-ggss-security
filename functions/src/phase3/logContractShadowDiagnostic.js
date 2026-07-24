const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const { FieldValue } = require('firebase-admin/firestore');

if (!admin.apps.length) {
  admin.initializeApp();
}

/**
 * Registra una discrepancia entre el motor contractual Legacy y el Canónico.
 * Solo para uso durante Etapa C (Shadow Mode).
 */
exports.logContractShadowDiagnostic = onCall(
  {
    region: 'us-central1',
    cors: true,
    enforceAppCheck: false
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
    const allowedRoles = ['admin', 'rrhh', 'jefe_operaciones', 'supervisor'];
    if (!allowedRoles.includes(actorRole)) {
      throw new HttpsError('permission-denied', 'No tiene permisos para ejecutar esta acción.');
    }

    // 2. Extraer Payload
    const {
      diagnosticId,
      employeeId,
      sucursalId,
      shiftDate,
      legacyStatus,
      canonicalStatus,
      classification, // match | mismatch
      reasonCode,
      legacySource,
      canonicalContractId,
      featureMode,
      requestId,
      engineVersion
    } = data;

    if (!diagnosticId || !employeeId || !shiftDate || !classification || !sucursalId) {
      throw new HttpsError('invalid-argument', 'Faltan campos requeridos.');
    }

    // 3. Validar Feature Flag Canario y Expiración Defensiva
    const flagDoc = await db.collection('FeatureFlags').doc('contractEligibilityV2').get();
    if (!flagDoc.exists) {
      throw new HttpsError('failed-precondition', 'Feature flag no configurado.');
    }
    
    const flagData = flagDoc.data();
    
    if (flagData.enabled !== true || flagData.mode !== 'shadow') {
      throw new HttpsError('failed-precondition', 'Shadow mode no está activo.');
    }

    if (!flagData.expiresAt || new Date() >= new Date(flagData.expiresAt)) {
      throw new HttpsError('failed-precondition', 'La ventana de Shadow Mode ha expirado.');
    }

    // Validar sucursal (canaryBranches)
    const sucursalStr = sucursalId.toString();
    if (flagData.canaryBranches && !flagData.canaryBranches.includes(sucursalStr) && !flagData.canaryBranches.includes('*')) {
      throw new HttpsError('failed-precondition', 'La sucursal no está dentro de la prueba Canary.');
    }

    // Validar mes (canaryMonths)
    const shiftMonth = shiftDate.substring(0, 7); // YYYY-MM
    if (flagData.canaryMonths && !flagData.canaryMonths.includes(shiftMonth) && !flagData.canaryMonths.includes('*')) {
      throw new HttpsError('failed-precondition', 'El mes no está dentro de la prueba Canary.');
    }

    // Validar engineVersion (si el cliente lo envía, verificar que coincide, o verificar que el server está en V1)
    if (engineVersion && flagData.engineVersion && engineVersion !== flagData.engineVersion) {
       throw new HttpsError('failed-precondition', 'La versión del motor no coincide con la aceptada.');
    }

    // 4. Asegurar Idempotencia mediante el diagnosticId
    const diagnosticRef = db.collection('ContractShadowDiagnostics').doc(diagnosticId);
    
    return await db.runTransaction(async (transaction) => {
      const docSnap = await transaction.get(diagnosticRef);
      if (docSnap.exists) {
        return { success: true, id: diagnosticId, isDuplicate: true };
      }

      // TTL (90 días)
      const now = new Date();
      const expiresAt = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000);

      const newDiagnostic = {
        id: diagnosticId,
        employeeId,
        sucursalId: sucursalStr,
        shiftDate,
        legacyStatus,
        canonicalStatus,
        classification,
        reasonCode: reasonCode || '',
        legacySource: legacySource || '',
        canonicalContractId: canonicalContractId || null,
        featureMode: featureMode || 'shadow',
        requestId: requestId || diagnosticId,
        createdAt: FieldValue.serverTimestamp(),
        expiresAt: expiresAt.toISOString(),
        schemaVersion: 1
      };

      transaction.set(diagnosticRef, newDiagnostic);

      return { success: true, id: diagnosticId, isDuplicate: false };
    });
  }
);
