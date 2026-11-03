# Integraciones con Servicios Externos y APIs de Terceros

Este documento describe la arquitectura, configuración y manejo de contingencia para todos los servicios externos e integraciones de ASPRO.

---

## 1. Gotenberg v8 (Microservicio de Conversión DOCX → PDF)

### 1.1 Propósito
Gotenberg es un microservicio stateless empaquetado en Docker que utiliza Chromium y LibreOffice para convertir documentos DOCX con fidelidad tipográfica idéntica a Microsoft Word hacia el formato PDF estándar.

### 1.2 Arquitectura y Despliegue
- **Producción:** Desplegado como servicio en **Google Cloud Run** en la región `us-central1` (`serviceId: gotenberg`).
- **Autenticación en Producción:** El servicio es privado (no público). Las Cloud Functions utilizan `google-auth-library` para generar un token de identidad OIDC (`idToken`) firmado por la cuenta de servicio de Firebase, transmitido en la cabecera `Authorization: Bearer <token>`.
- **Firebase Hosting Proxy:** `firebase.json` contiene un rewrite que mapea `/api/gotenberg/**` directamente hacia el contenedor en Cloud Run, permitiendo que el panel web genere previsualizaciones sin exponer credenciales.
- **Desarrollo Local:** En desarrollo con Vite (`vite.config.ts`), las peticiones a `/api/gotenberg` se redirigen por proxy inverso hacia un contenedor local en `http://localhost:3005`.

### 1.3 Validación de Integridad
El servicio devuelve un `ArrayBuffer` binario. El cliente y el backend verifican que los primeros 4 bytes del buffer correspondan a la firma mágica `%PDF` (hex: `0x25 0x50 0x44 0x46`) antes de almacenar o procesar el documento.

---

## 2. Bunny.net Object Storage & CDN

### 2.1 Propósito
Almacenar fotografías de alta resolución tomadas en terreno (rondas de guardias y visitas de auditoría de supervisores) sin consumir cuota de almacenamiento ni costos de transferencia de salida (*egress bandwidth*) en Firebase Storage.

### 2.2 Flujo de Subida con URLs Prefirmadas (S3-Compatible)
```text
Dispositivo Móvil -> Solicita URL -> Cloud Function (generateBunnyUploadUrl)
                                     ├─> Valida sesión con Firebase Auth
                                     ├─> Genera firma con @aws-sdk/s3-request-presigner
                                     └─> Retorna uploadUrl (PUT) y publicUrl (CDN)
Dispositivo Móvil -> Sube binario -> Bunny.net Storage Zone (ny-s3.storage.bunnycdn.com)
Visualización Web  <- Lee imagen  <- Bunny Pull Zone (rondas-aspro-storage.b-cdn.net)
```

### 2.3 Variables de Configuración Requeridas (`.env.local` y Cloud Functions)
- `BUNNY_STORAGE_ENDPOINT`: Endpoint S3 de Bunny (ej. `ny-s3.storage.bunnycdn.com`).
- `BUNNY_STORAGE_REGION`: Región asignada (ej. `ny`).
- `BUNNY_ACCESS_KEY`: Nombre del Storage Zone (usado como Bucket en S3).
- `BUNNY_SECRET_KEY`: Contraseña principal / API Key del Storage Zone.
- `BUNNY_PULL_ZONE_URL`: Dominio público CDN (ej. `https://rondas-aspro-storage.b-cdn.net`).

---

## 3. Google Gemini AI API (`@google/genai`)

### 3.1 Propósito
Extracción inteligente de campos personales (Nombres, Apellidos, RUT, Fecha de Nacimiento, Dirección, Sistema de Salud, AFP y Tallas de Uniforme) a partir de imágenes o PDFs de cédulas de identidad o fichas de ingreso, implementada en `components/AIEmployeeModal.tsx`.

### 3.2 Gestión de Credenciales
La función `getGeminiApiKey()` en `lib/firebase.ts` implementa una estrategia en dos niveles:
1. **Firestore Remoto (Prioritario):** Documento `app_config/gemini` → campo `apiKey`. Permite actualizar la clave en caliente para todos los usuarios sin redesplegar código.
2. **Variable Local (Fallback):** Variable de entorno `VITE_API_KEY` en `.env.local`.

### 3.3 Diagnóstico de Error HTTP 402 (*Pre-payment / Payment Required*)
- **Causa:** Ocurre cuando la API Key proviene de un proyecto en Google Cloud / Google AI Studio que tiene facturación activa y acumula saldo pendiente, la tarjeta bancaria caducó o el proyecto exige prepago.
- **Resolución:**
  1. Generar una nueva API Key en [Google AI Studio](https://aistudio.google.com/) dentro de un proyecto bajo el *Free Tier* (nivel gratuito sin tarjeta de crédito).
  2. Ejecutar en la terminal: `node scripts/set-gemini-key.cjs <NUEVA_CLAVE>`.

---

## 4. Firebase Cloud Messaging (FCM) & Notificaciones Push

### 4.1 Arquitectura Dual (Web vs. Móvil)
- **Contexto Web:** Gestionado a través del Service Worker `public/firebase-messaging-sw.js` utilizando la clave pública VAPID definida en `VITE_FIREBASE_VAPID_KEY`.
- **Contexto Nativo Capacitor (Android / iOS):** La inicialización web de FCM se desactiva explícitamente en `App.tsx` para evitar colisiones con el plugin nativo `@capacitor/push-notifications`, el cual utiliza la configuración oficial en `android/app/google-services.json`.

### 4.2 Casos de Uso Principales
- Alerta al guardia ante un nuevo contrato o documento que requiere su firma digital.
- Notificación de asignación de turnos extraordinarios o reemplazos de cobertura.
- Alertas a la supervisión ante novedades graves reportadas en una faena.

---

## 5. Capgo CapacitorUpdater (Actualizaciones en Caliente OTA)

### 5.1 Propósito
Permite actualizar la lógica, componentes React y estilos de la aplicación móvil de los guardias de forma silenciosa (*Over-The-Air*) sin obligar al usuario a descargar e instalar manualmente un nuevo archivo `.apk`.

### 5.2 Mecanismo Operativo
1. El script `scripts/publish-ota.cjs` empaqueta el directorio `dist/` en un archivo `dist.zip` y lo sube a Firebase Storage.
2. Actualiza el documento `app_config/version` en Firestore con la propiedad `webVersion` y la URL pública `webUrl`.
3. `lib/UpdateService.ts` detecta la nueva versión, verifica que la cola offline de sincronización esté vacía (para no perder marcajes pendientes), descarga el paquete en segundo plano y lo aplica en el próximo reinicio de la app.

---

## 6. Google Cloud Secret Manager

### 6.1 Propósito
Almacenar en memoria de las Cloud Functions el secreto `CURSOR_SIGNING_SECRET` utilizado para firmar con HMAC-SHA256 los cursores de paginación de la API de asistencia V2.

### 6.2 Política de Seguridad
- El secreto nunca se expone en variables de entorno planas de Firebase ni en respuestas al frontend.
- Si el secreto se rota, todos los cursores activos se invalidan automáticamente y el frontend responde de forma auto-recuperable solicitando la primera página de resultados (comportamiento *fail-closed*).

