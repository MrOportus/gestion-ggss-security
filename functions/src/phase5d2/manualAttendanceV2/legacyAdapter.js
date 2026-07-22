"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isManualAttendanceV2 = isManualAttendanceV2;
exports.isManualAttendanceLegacy = isManualAttendanceLegacy;
exports.adaptLegacyManualAttendance = adaptLegacyManualAttendance;
function isManualAttendanceV2(data) {
    return (data?.schemaVersion === 2 &&
        data?.recordKind === 'shift_attendance' &&
        data?.isLegacy === false &&
        typeof data?.checkInId === 'string' &&
        data.checkInId.length > 0);
}
function isManualAttendanceLegacy(data) {
    // A legacy record lacks schemaVersion 2 and usually has employeeId, date, status.
    if (isManualAttendanceV2(data)) {
        return false;
    }
    return typeof data?.employeeId === 'string' && typeof data?.date === 'string';
}
function adaptLegacyManualAttendance(data, documentId) {
    if (isManualAttendanceV2(data)) {
        return data;
    }
    // Si es legacy, no inventamos checkInId, ni checkOutId, ni horas.
    // Devolvemos un Partial<ManualAttendanceV2> con warnings o marcas de que faltan campos.
    return {
        schemaVersion: 2,
        recordKind: 'shift_attendance',
        isLegacy: true, // TypeScript partial hack to distinguish, but the type says false.
        // No inventar IDs
        checkInId: undefined, // Faltante intencional
        checkOutId: null,
        employeeId: data.employeeId || 'unknown',
        turnoProgramadoId: null,
        asignacionOperacionalId: null,
        legacyShiftId: null,
        jornadaDate: data.date || 'unknown',
        timezone: 'America/Santiago',
        codigoTurno: null,
        tipoOperacion: 'sin_clasificar',
        sucursalId: data.siteId || null,
        sucursalResolution: 'manual',
        status: data.status === 'presente' || data.status === 'ausente' ? 'completed' : 'open',
        attendanceStatus: data.status === 'ausente' ? 'ausente' : 'presente',
        checkInAt: data.updatedAt || null, // Best effort for legacy
        checkOutAt: null,
        scheduledStartAt: null,
        scheduledEndAt: null,
        closureType: data.type === 'auto_checkout' ? 'auto_close' : data.type === 'forced_checkout' ? 'force_close' : null,
        closureOrigin: data.type === 'auto_checkout' ? 'scheduler' : data.type === 'forced_checkout' ? 'admin' : 'mobile',
        workedMinutes: null,
        source: 'legacy_reconstructed',
        createdAt: data.updatedAt || null,
        updatedAt: data.updatedAt || null,
        createdBy: 'legacy',
        updatedBy: 'legacy',
        requestId: null,
        operationTokenId: null,
        legacyDocumentId: documentId,
        legacyDate: data.date || null,
        legacyType: data.type || null
    };
}
