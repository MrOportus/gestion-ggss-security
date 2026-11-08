const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

/**
 * updateEmployeeEmail
 * Callable Function — solo ejecutable por usuarios autenticados con rol admin.
 * Actualiza el email en Firebase Authentication usando el Admin SDK.
 *
 * Payload esperado: { uid: string, newEmail: string }
 *
 * Respuesta:
 *   { success: true, authSynced: true }                               → email actualizado en Auth
 *   { success: true, authSynced: false, reason: 'no-auth-account' }   → el colaborador no tiene
 *       cuenta en Firebase Auth (registros legacy/importados cuyo ID de documento no es un UID).
 *       No hay credencial que sincronizar: el email queda guardado solo en Firestore.
 *
 * Retrocompatibilidad: los clientes antiguos solo esperan que la llamada no falle,
 * por lo que ambos casos con success:true son seguros para ellos.
 */
exports.updateEmployeeEmail = onCall(
  {
    region: 'us-central1',
    cors: true,
  },
  async (request) => {
    // 1. Verificar que el llamador está autenticado
    if (!request.auth) {
      throw new HttpsError('unauthenticated', 'Debes estar autenticado para realizar esta acción.');
    }

    // 2. Verificar rol admin en el token
    const callerUid = request.auth.uid;
    const db = admin.firestore();
    const callerDoc = await db.collection('Colaboradores').doc(callerUid).get();
    if (!callerDoc.exists || callerDoc.data().role !== 'admin') {
      throw new HttpsError('permission-denied', 'Solo un administrador puede actualizar correos.');
    }

    const { uid } = request.data || {};
    const newEmail = typeof request.data?.newEmail === 'string' ? request.data.newEmail.trim() : '';

    if (!uid || typeof uid !== 'string') {
      throw new HttpsError('invalid-argument', 'El campo "uid" es obligatorio.');
    }
    if (!newEmail || !newEmail.includes('@')) {
      throw new HttpsError('invalid-argument', 'El campo "newEmail" debe ser un correo válido.');
    }

    try {
      // 3. Verificar que el email nuevo no esté ya ocupado por otro usuario en Auth
      try {
        const existingUser = await admin.auth().getUserByEmail(newEmail);
        if (existingUser && existingUser.uid !== uid) {
          throw new HttpsError('already-exists', 'El correo ya está registrado en el sistema para otro usuario.');
        }
      } catch (e) {
        if (e instanceof HttpsError) throw e;
        if (e && e.code === 'auth/invalid-email') {
          throw new HttpsError('invalid-argument', 'El formato del correo no es válido.');
        }
        // auth/user-not-found → el correo está disponible, continuar
        if (!e || e.code !== 'auth/user-not-found') throw e;
      }

      // 4. Verificar si el colaborador ya tiene cuenta en Firebase Auth.
      //    Los colaboradores legacy/importados sin credenciales previas no existen aún en Auth:
      //    no debe lanzar error 500; el email queda guardado en Firestore (y permite crear
      //    posteriormente su cuenta con "Generar Contraseña" / resetUserPassword).
      try {
        await admin.auth().getUser(uid);
      } catch (e) {
        if (e && e.code === 'auth/user-not-found') {
          console.log(`[updateEmployeeEmail] UID ${uid} sin cuenta en Auth. Email (${newEmail}) validado y conservado en Firestore.`);
          return { success: true, authSynced: false, reason: 'no-auth-account' };
        }
        throw e;
      }

      // 5. Actualizar el email en Firebase Auth
      await admin.auth().updateUser(uid, { email: newEmail });

      console.log(`[updateEmployeeEmail] Email actualizado para UID ${uid} → ${newEmail}`);
      return { success: true, authSynced: true };

    } catch (error) {
      if (error instanceof HttpsError) throw error;
      console.error('[updateEmployeeEmail] Error:', error);
      if (error && (error.code === 'auth/email-already-exists')) {
        throw new HttpsError('already-exists', 'El correo ya está registrado en el sistema para otro usuario.');
      }
      if (error && error.code === 'auth/invalid-email') {
        throw new HttpsError('invalid-argument', 'El formato del correo no es válido.');
      }
      throw new HttpsError('internal', 'Error al actualizar el correo en el sistema de autenticación.');
    }
  }
);
