const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');

// No es necesario inicializar admin si ya se hizo en index.js
const db = admin.firestore();

function normalizeRut(rut) {
  if (!rut || typeof rut !== 'string') return "";
  return rut.replace(/[\.\-\s]/g, "").toUpperCase();
}

exports.loginWithRut = onCall(
  {
    region: 'us-central1',
    cors: true,
  },
  async (request) => {
    const data = request.data;
    const rut = data.rut;
    const password = data.password;
    const apiKey = data.apiKey;

    if (!rut || !password || !apiKey) {
      throw new HttpsError('invalid-argument', 'El RUT, contraseña y apiKey son obligatorios.');
    }

    const rutNorm = normalizeRut(rut);
    if (!rutNorm) {
      throw new HttpsError('invalid-argument', 'Formato de RUT inválido.');
    }

    try {
      // 1. Buscar el UID asociado al RUT en el RutIndex
      const indexRef = db.collection('RutIndex').doc(rutNorm);
      const indexDoc = await indexRef.get();

      if (!indexDoc.exists) {
        throw new HttpsError('not-found', 'Identificador o contraseña incorrectos.');
      }

      const uid = indexDoc.data().uid;

      // 2. Obtener el correo del usuario en Firebase Auth usando el UID
      const userRecord = await admin.auth().getUser(uid);
      const email = userRecord.email;

      if (!email) {
        throw new HttpsError('internal', 'La cuenta no tiene un correo asociado.');
      }

      // 3. Validar la contraseña contra Firebase Auth mediante REST API
      const response = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email,
          password: password,
          returnSecureToken: true
        })
      });

      const responseData = await response.json();

      if (!response.ok) {
        console.error('Error de autenticación REST:', responseData);
        // Error genérico para no filtrar información
        throw new HttpsError('unauthenticated', 'Identificador o contraseña incorrectos.');
      }

      // Verificación de seguridad adicional
      if (responseData.localId !== uid) {
         throw new HttpsError('internal', 'Mapeo de UID inconsistente.');
      }

      // 4. Crear un Custom Token
      const customToken = await admin.auth().createCustomToken(uid);

      return {
        token: customToken
      };

    } catch (error) {
      if (error instanceof HttpsError) {
        throw error;
      }
      console.error('Error en loginWithRut:', error);
      throw new HttpsError('internal', 'Error al procesar la solicitud de inicio de sesión.');
    }
  }
);
