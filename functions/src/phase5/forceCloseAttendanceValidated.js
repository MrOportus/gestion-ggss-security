const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
const crypto = require('crypto');
const { executeAttendanceClosure } = require('./attendanceClosureCore');

// ────────────────────────────────────────────────────────────────────────────────
// Callable: forceCloseAttendanceValidated
// Fase 5D.1B — Cierre forzado autoritativo de asistencia manual
// ────────────────────────────────────────────────────────────────────────────────
exports.forceCloseAttendanceValidated = onCall(
  {
    region: 'us-central1',
    enforceAppCheck: false // Ajustar según configuración real de App Check
  },
  async (request) => {
    // 1. Validar Autenticación
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Debe iniciar sesión para realizar esta acción.');
    }

    const { attendanceId, requestId, note } = request.data;
    if (!attendanceId || !requestId) {
      throw new HttpsError('invalid-argument', 'Faltan parámetros obligatorios (attendanceId, requestId).');
    }

    const actorUid = request.auth.uid;
    const db = admin.firestore();

    try {
      // 2. Validar Roles (Solo admin, supervisor o jefe_operaciones)
      const actorDoc = await db.collection('Colaboradores').doc(actorUid).get();
      if (!actorDoc.exists) {
        throw new HttpsError('permission-denied', 'Usuario no registrado.');
      }
      
      const actorData = actorDoc.data();
      const role = actorData.role;
      const actorEmail = request.auth.token.email || actorData.email || actorUid;

      const ROLES_PERMITIDOS = ['admin', 'supervisor', 'jefe_operaciones'];
      if (!ROLES_PERMITIDOS.includes(role)) {
        throw new HttpsError('permission-denied', 'No tiene permisos para forzar el cierre.');
      }

      const payload = { attendanceId, note: (note || '').trim() };
      const payloadString = JSON.stringify(payload, Object.keys(payload).sort());
      const payloadHash = crypto.createHash('sha256').update(payloadString).digest('hex');

      // 5. Invocación del servicio core con políticas explícitas de cierre manual
      const result = await executeAttendanceClosure(db, {
        attendanceId: request.data.attendanceId,
        actorUid: actorUid,
        actorEmail: actorEmail,
        actorRole: role,
        origen: 'admin_dashboard',
        motivo: note || '',
        checkPermissions: true,
        cleanupDigitalAttendance: false, // Comportamiento legacy estricto (NO elimina el documento en cierre manual)
        auditType: 'attendance_force_closed',
        requestId: `forceClose_${actorUid}_${requestId}`,
        isSystemActor: false,
        payloadHash: payloadHash
      });

      return result;

    } catch (error) {
      console.error('[FORCE_CLOSE] Error:', error);
      if (error instanceof HttpsError) {
        throw error;
      }
      throw new HttpsError('internal', error.message || 'Error interno del servidor');
    }
  }
);
