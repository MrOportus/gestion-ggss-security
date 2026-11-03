# Catálogo de Cloud Functions y Procesos Serverless

Este documento detalla todas las Cloud Functions desplegadas en el backend de Firebase/GCP, sus triggers, entradas, salidas y efectos secundarios.

---

## 1. Funciones Invocables (Callables HTTPS v2)

### 1.1 `emitirContratoV2`
- **Ubicación:** `functions/src/contratos/emitirContratoV2.js`
- **Propósito:** Genera contratos individuales de trabajo en base a plantillas DOCX, ejecuta sustitución de variables, invoca el microservicio Gotenberg en Cloud Run para renderizar a PDF, calcula hash SHA-256 y registra atómicamente el contrato y el documento para firma.
- **Trigger:** HTTPS Callable (`onCall`, región `us-central1`, 1GiB RAM, timeout 60s).
- **Entradas:**
  ```typescript
  {
    empleadoId: string;
    plantillaId: string;
    clausulas?: Record<string, string>;
    canalFirma: 'digital' | 'fisica';
    coordenadasFirma?: { page: number; x: number; y: number; width: number; height: number };
  }
  ```
- **Salidas:**
  ```typescript
  {
    success: boolean;
    contratoId: string;
    documentoId?: string;
    urlPdf: string;
    sha256: string;
  }
  ```
- **Colecciones Afectadas:** `Contratos`, `documents`, `Colaboradores` (actualiza fechas y cargo), `HistoricoContratos`.
- **Servicios Externos:** Cloud Run (Gotenberg v8 vía IAM OIDC con `GoogleAuth`), Firebase Storage (`contract_templates/`, `generated_docs/`).
- **Módulo Frontend:** `components/contratos/ContractEmissionModalV2.tsx`, `pages/HRContractsDashboard.tsx`.

### 1.2 `loginWithRut`
- **Ubicación:** `functions/src/auth/loginWithRut.js`
- **Propósito:** Permite a los guardias y colaboradores autenticarse en la app móvil ingresando su RUT chileno y contraseña, abstrayendo el email técnico generado por el sistema.
- **Trigger:** HTTPS Callable público (`onCall`).
- **Entradas:** `{ rut: string; password: string }`.
- **Salidas:** `{ customToken: string; user: { uid, email, role, firstName, ... } }`.
- **Colecciones Afectadas:** `RutIndex`, `Colaboradores`.

### 1.3 `generateBunnyUploadUrl`
- **Ubicación:** `functions/src/bunny/generateBunnyUploadUrl.js`
- **Propósito:** Genera URLs pre-firmadas S3 (PUT) contra el Object Storage de Bunny.net para que la app suba fotografías pesadas sin intermediar Firebase Storage.
- **Trigger:** HTTPS Callable con autenticación requerida (`onCall`).
- **Entradas:** `{ fileName?: string; folder?: string; contentType?: string }`.
- **Salidas:** `{ uploadUrl: string; publicUrl: string; objectKey: string }`.
- **Servicios Externos:** Bunny.net Storage Zone & Pull CDN vía `@aws-sdk/client-s3` y `@aws-sdk/s3-request-presigner`.
- **Módulo Frontend:** `components/RoundsControl.tsx`, `components/visitas/FormularioVisita.tsx`.

### 1.4 `getAttendanceShadowValidated`
- **Ubicación:** `functions/src/phase5d2/getAttendanceShadowValidated.js`
- **Propósito:** Paginación de asistencia con cursores cifrados y firmados con HMAC-SHA256 para evitar alteraciones de filtros o inyecciones de datos.
- **Trigger:** HTTPS Callable con inyección de secreto (`secrets: [cursorSecret]`).
- **Entradas:** `{ sucursalId?: string; fechaInicio?: string; cursor?: string; pageSize?: number }`.
- **Salidas:** `{ records: any[]; nextCursor: string | null }`.
- **Servicios Externos:** Google Cloud Secret Manager (`CURSOR_SIGNING_SECRET`).
- **Módulo Frontend:** `services/attendanceShadowService.ts`.

### 1.5 `forceCloseAttendanceValidated`
- **Ubicación:** `functions/src/phase5/forceCloseAttendanceValidated.js`
- **Propósito:** Permite a un administrador forzar el cierre de una jornada laboral que quedó abierta por descuido del trabajador, estableciendo motivo y timestamp de término auditado.
- **Trigger:** HTTPS Callable (solo rol `admin`).
- **Entradas:** `{ attendanceId: string; motivo: string; horasComputadas?: number }`.
- **Salidas:** `{ success: boolean; attendanceId: string }`.
- **Colecciones Afectadas:** `Asistencia`, `asistencia_digital`.

### 1.6 `saveProgramacionValidated`
- **Ubicación:** `functions/src/phase5/saveProgramacionValidated.js`
- **Propósito:** Valida y persiste asignaciones de turnos programados comprobando descansos mínimos entre jornadas, jornadas máximas y solapamientos de puestos.
- **Trigger:** HTTPS Callable (solo roles `admin`, `jefe_operaciones`).
- **Colecciones Afectadas:** `TurnosProgramados`, `ConflictWarnings`.

### 1.7 `regularizeContractValidated`
- **Ubicación:** `functions/src/phase3/`
- **Propósito:** Regularización contractual de registros antiguos que no cuentan con documento formal o fecha de término definida.
- **Trigger:** HTTPS Callable.

### 1.8 `getConsolidatedAttendance`
- **Ubicación:** `functions/src/attendanceConsolidation/getConsolidatedAttendance.js`
- **Propósito:** Devuelve la consolidación de asistencia calculando atrasos, horas nocturnas y horas extras para nómina.
- **Trigger:** HTTPS Callable.
- **Colecciones Afectadas:** `AsistenciasConsolidadas`.

### 1.9 `updateEmployeeEmail`
- **Ubicación:** `functions/src/auth/updateEmployeeEmail.js`
- **Propósito:** Actualiza atómicamente el correo electrónico tanto en Firebase Authentication como en el documento de `Colaboradores` e índice `RutIndex`.
- **Trigger:** HTTPS Callable (solo `admin`).

### 1.10 `registerFcmToken`
- **Ubicación:** `functions/index.js`
- **Propósito:** Asocia el token de notificaciones FCM del dispositivo móvil o navegador al perfil del colaborador autenticado.
- **Trigger:** HTTPS Callable.
- **Colecciones Afectadas:** `Colaboradores/{userId}`.

### 1.11 `validateSignedDocument`
- **Ubicación:** `functions/index.js`
- **Propósito:** Valida el hash SHA-256 de un documento contra la colección `validacionesDocumentos` y retorna el certificado de autenticidad.
- **Trigger:** HTTPS Callable público.

### 1.12 `resetUserPassword`
- **Ubicación:** `functions/index.js`
- **Propósito:** Restablece la contraseña de acceso de un colaborador desde el panel de administración sin requerir envío de correo si el guardia no tiene acceso a su casilla.
- **Trigger:** HTTPS Callable (solo `admin`).

---

## 2. Triggers Reactivos de Firestore

### 2.1 `calcularHashDocumentoFirmado`
- **Trigger:** `onDocumentUpdated('documents/{docId}')`.
- **Condición:** Se activa cuando el documento transiciona de `status: 'pending'` a `status: 'signed'`.
- **Efectos:**
  1. Descarga el PDF con la firma estampada desde Storage.
  2. Calcula el hash criptográfico SHA-256 del contenido binario.
  3. Crea un registro en `validacionesDocumentos/{docId}` con la traza legal.
  4. Si el documento corresponde a un contrato (`type === 'contrato'`), busca el registro en `Contratos` y actualiza `estadoDocumental: 'firmado_digital'`.

### 2.2 `notificarNuevoDocumento`
- **Trigger:** `onDocumentCreated('documents/{docId}')`.
- **Efectos:** Busca el `fcmToken` del guardia asignado (`assignedTo`) en `Colaboradores` y despacha una notificación push a su celular avisándole que tiene un nuevo documento por firmar.

### 2.3 `notificarSeguimientoNovedad`
- **Trigger:** `onDocumentCreated('novedades/{novedadId}/seguimientos/{seguimientoId}')`.
- **Efectos:** Envía una alerta a los supervisores y administradores informando que se agregó un avance o resolución a una novedad abierta.

### 2.4 `notificarSeguimientoVisita`
- **Trigger:** `onDocumentCreated('visitasSupervisor/{visitId}/seguimientos/{seguimientoId}')`.
- **Efectos:** Notifica al supervisor y jefe de operaciones sobre el cumplimiento de un compromiso derivado de una visita a faena.

### 2.5 `notificarNuevaOfertaTurno`
- **Trigger:** `onDocumentCreated('solicitudes_turnos/{docId}')`.
- **Efectos:** Emite notificaciones push a la dotación de guardias disponibles para cubrir un turno extra vacante (*Marketplace de Turnos*).

### 2.6 `shadowAttendanceResolver` (v1)
- **Trigger:** `functions.firestore.document('Asistencia/{attendanceId}').onCreate(...)`.
- **Efectos:** Compara en segundo plano cada nuevo marcaje contra las reglas de `asistencia_digital` y genera un diagnóstico en `AttendanceShadowComparisons` para asegurar paridad entre sistemas.

---

## 3. Tareas Programadas (Cloud Scheduler / Cron)

### 3.1 `autoCloseShifts`
- **Ubicación:** `functions/index.js` (apoyado en `autoCloseHelper.js`).
- **Trigger:** `onSchedule('every 1 hours')`.
- **Lógica de Negocio:**
  - Consulta registros de `Asistencia` que tengan `type: 'in'` y no posean un `type: 'out'` asociado tras 14 horas continuas de iniciada la jornada.
  - Para evitar turnos zombis o desajustes en el cómputo de horas, inyecta un cierre automático forzado con la marca `estadoCierre: 'cerrado_automatico'` y notifica la anomalía a los administradores.

