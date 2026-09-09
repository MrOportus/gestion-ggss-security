const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

/**
 * updateEmployeeEmail
 * Callable Function — solo ejecutable por usuarios autenticados con rol admin.
 * Actualiza el email en Firebase Authentication usando el Admin SDK.
 *
 * Payload esperado: { uid: string, newEmail: string }
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

    const { uid, newEmail } = request.data;

    if (!uid || typeof uid !== 'string') {
      throw new HttpsError('invalid-argument', 'El campo "uid" es obligatorio.');
    }
    if (!newEmail || typeof newEmail !== 'string' || !newEmail.includes('@')) {
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
        // getUserByEmail lanza error si no existe — eso es lo esperado
        if (e instanceof HttpsError) throw e;
        // Si el error es auth/user-not-found, el correo está disponible, continuar
      }

      // 4. Actualizar el email en Firebase Auth
      await admin.auth().updateUser(uid, { email: newEmail });

      console.log(`[updateEmployeeEmail] Email actualizado para UID ${uid} → ${newEmail}`);
      return { success: true };

    } catch (error) {
      if (error instanceof HttpsError) throw error;
      console.error('[updateEmployeeEmail] Error:', error);
      throw new HttpsError('internal', 'Error al actualizar el correo en el sistema de autenticación.');
    }
  }
);
