/**
 * Resuelve si el Dual Write de Asistencia V2 está activo para un contexto dado.
 *
 * @param {Object} ffData - Datos del documento FeatureFlags/attendanceV2.
 * @param {Object} context - { employeeId, siteId, dateStr, user }
 * @returns {boolean}
 */
function resolveV2DualWrite(ffData, context) {
  try {
    const { employeeId, siteId, dateStr, user } = context;

    if (!ffData || ffData.enabled !== true) {
      return false;
    }

    // En 5D.2C, writeClosedSessions debe ser true para escribir (writeOpenSessions es false)
    if (ffData.writeClosedSessions !== true) {
      return false;
    }

    const {
      activationMode = 'qa_only',
      enabledForQaUsers = [],
      enabledForSucursalIds = [],
      enabledForOperationalMonths = []
    } = ffData;

    // Evaluadores
    const isQa = user?.uid && (enabledForQaUsers.includes(user.uid) || enabledForQaUsers.includes(employeeId));
    const isBranch = siteId && enabledForSucursalIds.includes(siteId);
    
    const monthPrefix = dateStr ? dateStr.substring(0, 7) : null;
    const isMonth = monthPrefix && enabledForOperationalMonths.includes(monthPrefix);

    switch (activationMode) {
      case 'qa_only':
        return !!isQa;
      case 'qa_and_branch':
        return !!(isQa && isBranch);
      case 'branch_and_month':
        return !!(isBranch && isMonth);
      case 'global':
        // global permanece prohibido de facto si queremos, pero lo implementamos.
        // Se desaconseja en 5D.2C.
        return true;
      default:
        return false;
    }
  } catch (error) {
    console.error('Error resolviendo Feature Flag attendanceV2:', error);
    return false;
  }
}

/**
 * Obtiene el snapshot completo del feature flag para agregarlo a la auditoría y al shadow comparison.
 */
async function getFeatureFlagSnapshot(db) {
  try {
    const ffDoc = await db.collection('FeatureFlags').doc('attendanceV2').get();
    return ffDoc.exists ? ffDoc.data() : null;
  } catch (e) {
    return null;
  }
}

module.exports = {
  resolveV2DualWrite,
  getFeatureFlagSnapshot
};
