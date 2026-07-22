const { HttpsError } = require('firebase-functions/v2/https');

/**
 * Verifica si el usuario tiene permiso explícito sobre una sucursal o si es admin general.
 * @param {FirebaseFirestore.Firestore} db 
 * @param {string} actorUid 
 * @param {string} actorRole 
 * @param {string} targetSucursalId 
 */
async function validateBranchAccess(db, actorUid, actorRole, targetSucursalId) {
  if (actorRole === 'admin' || actorRole === 'qa_tester') {
    return true; // Admin global y QA tester tienen acceso libre
  }
  
  if (actorRole === 'jefe_operaciones' || actorRole === 'supervisor') {
    if (!targetSucursalId) {
      throw new HttpsError('invalid-argument', 'Debe proporcionar sucursalId para validar alcance.');
    }
    const alcanceSnap = await db.collection('AlcancesOperativos').doc(actorUid).get();
    if (!alcanceSnap.exists) {
      throw new HttpsError('permission-denied', 'No posee alcance operativo definido.');
    }
    
    const alcance = alcanceSnap.data();
    const allowed = Array.isArray(alcance.sucursales) ? alcance.sucursales : [];
    
    if (!allowed.includes(targetSucursalId)) {
      throw new HttpsError('permission-denied', `No posee alcance operativo sobre la sucursal: ${targetSucursalId}`);
    }
    
    return true;
  }
  
  // Roles como worker, rrhh no autorizados aquí.
  throw new HttpsError('permission-denied', `Rol no autorizado para acceder a este endpoint: ${actorRole}`);
}

/**
 * Evalúa el Feature Flag de Lectura V2 y resuelve el modo fallback (legacy_only, shadow, v2_only)
 * @param {FirebaseFirestore.Firestore} db 
 * @param {string} actorUid 
 * @param {string} sucursalId (Opcional, si la consulta es por sucursal o empleado+sucursal)
 * @param {string} jornadaDate (Opcional, para validar el mes)
 * @returns {Promise<string>} 'legacy_only' | 'shadow' | 'v2_only'
 */
async function evaluateReadFeatureFlag(db, actorUid, sucursalId = null, jornadaDate = null) {
  const ffDoc = await db.collection('FeatureFlags').doc('attendanceV2Read').get();
  
  if (!ffDoc.exists) {
    return 'legacy_only'; // Fallback seguro por defecto si no existe
  }

  const flags = ffDoc.data();
  if (flags.enabled !== true) {
    return 'legacy_only';
  }

  // Verificar activationMode similar a escritura
  const mode = flags.activationMode || 'qa_only';
  const qaUsers = Array.isArray(flags.enabledForQaUsers) ? flags.enabledForQaUsers : [];
  const allowedBranches = Array.isArray(flags.enabledForSucursalIds) ? flags.enabledForSucursalIds : [];
  const allowedMonths = Array.isArray(flags.enabledForOperationalMonths) ? flags.enabledForOperationalMonths : [];
  
  let v2Allowed = false;
  
  const isQa = qaUsers.includes(actorUid);
  const isBranchOk = sucursalId ? allowedBranches.includes(sucursalId) : false;
  const targetMonth = jornadaDate ? jornadaDate.substring(0, 7) : null;
  const isMonthOk = targetMonth ? allowedMonths.includes(targetMonth) : false;

  if (mode === 'qa_only') {
    v2Allowed = isQa;
  } else if (mode === 'qa_and_branch') {
    v2Allowed = isQa && isBranchOk;
  } else if (mode === 'branch_and_month') {
    v2Allowed = isBranchOk && isMonthOk;
  } else if (mode === 'global') {
    // Aún bloqueado intencionalmente para lecturas globales de UI productiva en esta fase
    v2Allowed = false; 
  } else {
    v2Allowed = false;
  }

  if (!v2Allowed) {
    console.log('[SHADOW-QA Debug] Feature flag evaluated to legacy_only because v2Allowed is false (isQa:', isQa, 'mode:', mode, ')');
    return 'legacy_only';
  }

  if (flags.shadowReadEnabled === true) {
    console.log('[SHADOW-QA Debug] Feature flag evaluated to shadow');
    return 'shadow';
  }

  // Si v2Allowed es true pero shadowReadEnabled es false
  // Significa que estamos listos para 'v2_only', PERO la fase dicta:
  // "v2_only debe existir conceptualmente, pero permanecer prohibido por Feature Flag"
  // Así que si alguien configura eso sin shadow, para 5D.2D lo bloquearemos o lo respetamos si el plan 5D.2D lo exige:
  // "v2_only no habilitable todavía."
  if (flags.allowLegacyOnlyFallback !== false) {
    console.log('[SHADOW-QA Debug] Feature flag evaluated to legacy_only because allowLegacyOnlyFallback was not false.');
    return 'legacy_only';
  }
  
  throw new HttpsError('failed-precondition', 'Modo v2_only desactivado en esta fase.');
}

/**
 * Valida que el rol base esté autorizado en la Callable
 * @param {string} actorRole 
 */
function validateBaseRole(actorRole) {
  const allowedRoles = ['admin', 'jefe_operaciones', 'supervisor', 'qa_tester'];
  if (!allowedRoles.includes(actorRole)) {
    throw new HttpsError('permission-denied', `El rol ${actorRole} no está autorizado para realizar consultas V2/Shadow.`);
  }
}

module.exports = {
  validateBranchAccess,
  evaluateReadFeatureFlag,
  validateBaseRole
};
