/**
 * Compara el documento V2 y Legacy y registra el resultado en AttendanceShadowComparisons.
 * No debe fallar el flujo principal si hay un error aquí.
 */
async function compareLegacyAndV2Attendance(db, FieldValue, {
  checkInId,
  v2Data,
  legacyData,
  featureFlagSnapshot,
  sourceOperation,
  transaction
}) {
  try {
    const comparisonId = `comparison_${checkInId}`;
    let comparisonStatus = 'exact_match';
    const differences = {};
    const expectedLimitations = [];

    // Helper para comparar
    const checkDiff = (field, v2Val, legVal, isExpectedLimitation = false, limitationReason = '') => {
      // Normalizamos null, undefined y strings vacíos para la comparación
      const nV2 = v2Val === null || v2Val === undefined ? '' : String(v2Val);
      const nLeg = legVal === null || legVal === undefined ? '' : String(legVal);
      
      if (nV2 !== nLeg) {
        if (isExpectedLimitation) {
          expectedLimitations.push({ field, v2Val, legVal, limitationReason });
          if (comparisonStatus === 'exact_match') {
            comparisonStatus = 'expected_legacy_limitation';
          }
        } else {
          differences[field] = { v2: v2Val, legacy: legVal };
          comparisonStatus = 'unexpected_difference';
        }
      }
    };

    if (!legacyData) {
      comparisonStatus = 'missing_legacy';
    } else if (!v2Data) {
      comparisonStatus = 'missing_v2';
    } else {
      // Comparaciones básicas
      checkDiff('employeeId', v2Data.employeeId, legacyData.employeeId);
      checkDiff('jornadaDate', v2Data.jornadaDate, legacyData.date);
      checkDiff('sucursalId', v2Data.sucursalId, legacyData.siteId);

      // Status
      // En legacy, status es 'presente', 'ausente', o puede no existir o ser distinto.
      // En V2 se separó en `status` ('completed') y `attendanceStatus` ('presente').
      // Si legacy es 'presente', v2 attendanceStatus debe ser 'presente' y status 'completed'.
      checkDiff('attendanceStatus', v2Data.attendanceStatus, legacyData.status === 'presente' || legacyData.status === 'ausente' ? legacyData.status : legacyData.status);
      
      // Tipo (operación vs type)
      // Legacy "type" suele ser "auto_checkout", "forced_checkout" que en V2 es closureType
      // V2 tipoOperacion es 'contractual', 'extra'.
      checkDiff('closureType', 
        v2Data.closureType, 
        legacyData.type === 'auto_checkout' ? 'auto_close' : legacyData.type === 'forced_checkout' ? 'force_close' : legacyData.type === 'cierre_normal' ? 'normal' : legacyData.type,
        true, 'Legacy type mezcla origen y clasificación'
      );

      // checkInAt / checkOutAt
      // Legacy no tiene checkOutAt usualmente (solo updatedAt).
      checkDiff('checkOutAt', v2Data.checkOutAt ? true : false, false, true, 'Legacy no tiene campo explícito de checkOutAt');

      // workedMinutes
      checkDiff('workedMinutes', v2Data.workedMinutes ? true : false, false, true, 'Legacy no calcula horas trabajadas directamente');
    }

    if (Object.keys(differences).length > 0 && comparisonStatus !== 'missing_legacy' && comparisonStatus !== 'missing_v2') {
      comparisonStatus = 'unexpected_difference';
    } else if (expectedLimitations.length > 0 && comparisonStatus === 'exact_match') {
      comparisonStatus = 'expected_legacy_limitation';
    }

    const docRef = db.collection('AttendanceShadowComparisons').doc(comparisonId);
    
    const payload = {
      checkInId,
      v2DocumentId: `manual_${checkInId}`,
      legacyDocumentId: v2Data ? v2Data.legacyDocumentId : legacyData ? `manual_${legacyData.employeeId}_${legacyData.date}` : null,
      employeeId: v2Data?.employeeId || legacyData?.employeeId,
      jornadaDate: v2Data?.jornadaDate || legacyData?.date,
      sucursalId: v2Data?.sucursalId || legacyData?.siteId,
      comparisonStatus,
      differences,
      expectedLimitations,
      featureFlagSnapshot: featureFlagSnapshot || null,
      sourceOperation: sourceOperation || 'unknown',
      updatedAt: FieldValue.serverTimestamp(),
      createdAt: FieldValue.serverTimestamp()
    };

    if (transaction) {
      transaction.set(docRef, payload, { merge: true });
    } else {
      await docRef.set(payload, { merge: true });
    }

  } catch (error) {
    console.warn(`[Shadow Comparator] Fallo no crítico en shadow compare para checkInId ${checkInId}:`, error);
  }
}

module.exports = {
  compareLegacyAndV2Attendance
};
