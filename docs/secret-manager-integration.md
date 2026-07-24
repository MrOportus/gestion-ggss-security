# Integración con Google Cloud Secret Manager (Gate 5D.2D)

Este documento detalla la política de gestión de secretos para la firma de cursores de paginación en el módulo de Asistencia V2.

## Arquitectura de Seguridad (Cursores Firmados)
Los cursores de paginación V2 contienen un payload en JSON y una firma HMAC-SHA256, con el formato:
`base64url(payload).base64url(signature)`

El backend es stateless. Para validar que un cursor no fue manipulado (ej. alteración de los filtros `sucursalId` o `empleadoId`), se firma el contenido con un secreto simétrico conocido únicamente por el servidor.

## Gestión del Secreto
Se utiliza **Google Cloud Secret Manager** para inyectar este secreto directamente en memoria de las Cloud Functions al iniciarse el contenedor, garantizando que:
- El secreto no se encuentra en el código fuente.
- El secreto no está configurado como variable de entorno plana (que queda visible en la consola de Firebase o Google Cloud en texto claro).
- El secreto no se persiste en Firestore.
- El secreto no se devuelve nunca en respuestas HTTP ni en logs de sistema.

### Implementación Técnica
En `getAttendanceShadowValidated.js`:
```javascript
const { defineSecret } = require('firebase-functions/params');
const cursorSecret = defineSecret('CURSOR_SIGNING_SECRET');

// Inyección en la función
exports.getAttendanceShadowValidated = onCall(
  {
    region: 'us-central1',
    secrets: [cursorSecret], // Inyección del secreto
  },
  async (request) => { ... }
);
```

### Entornos Locales (Emuladores)
Durante el desarrollo o pruebas con `firebase emulators:exec`, se utiliza un valor de prueba configurado en `.env.local` (el cual está excluido de control de versiones vía `.gitignore`).
Valor requerido: `test-cursor-signing-secret-minimum-32-characters`

## Política de Rotación

1. **Impacto de la Rotación**: Cambiar el secreto invalida instantáneamente **todos los cursores de paginación emitidos y activos**.
2. **Reacción del Sistema**: Cualquier cliente intentando usar la página siguiente con un cursor firmado por el secreto antiguo recibirá un error HTTP 403 `permission-denied` con el código `cursor_signature_invalid`.
3. **Manejo en el Cliente (Frontend)**: El cliente V2 debe interpretar el error `cursor_signature_invalid` como señal de que debe descartar el cursor y volver a pedir la primera página de resultados (comportamiento auto-recuperable y cerrado por defecto).
4. **Fallo cerrado (Fail Closed)**: Si el secreto se corrompe, desaparece, o se inserta uno menor a 32 caracteres, el sistema suspenderá todas las operaciones de consulta devolviendo HTTP 500 para evitar devolver datos comprometedores o procesar paginaciones falsificadas.
