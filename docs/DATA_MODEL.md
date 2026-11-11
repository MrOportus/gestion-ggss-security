# Modelo de Datos del Sistema ASPRO

Este documento define la estructura de datos persistente en **Cloud Firestore**, sus subcolecciones, relaciones y los esquemas locales en **IndexedDB**.

---

## 1. Colecciones de Cloud Firestore

### 1.1 `Colaboradores` (Personal y Guardias)
- **ID de Documento:** `userId` (Firebase Auth UID del usuario).
- **Campos Principales:**
  - `firstName` *(string)*: Nombres.
  - `lastNamePaterno` *(string)*: Primer apellido.
  - `lastNameMaterno` *(string, opcional)*: Segundo apellido.
  - `rut` *(string)*: RUT chileno con puntos y guion (ej. `12.345.678-9`).
  - `rutNormalized` *(string)*: RUT limpio sin puntos ni guion para indexación rápida.
  - `email` *(string)*: Correo electrónico (identificador para Firebase Auth).
  - `phone` *(string, opcional)*: Teléfono móvil de contacto.
  - `cargo` *(string)*: Cargo contractual (ej. `"GUARDIA DE SEGURIDAD"`).
  - `role` *(string)*: Rol de acceso (`'admin' | 'supervisor' | 'worker' | 'mandante' | 'rrhh' | 'jefe_operaciones'`).
  - `sueldoLiquido` *(number, opcional)*: Sueldo líquido pactado.
  - `fechaNacimiento` *(string, ISO)*: Fecha de nacimiento.
  - `fechaVencimientoOS10` *(string, ISO)*: Vencimiento de la credencial OS-10 de Carabineros.
  - `tipoContrato` *(string)*: `'Plazo Fijo' | 'Indefinido' | 'Obra y Faena'`.
  - `fechaInicioContrato` *(string, ISO)*: Fecha de inicio de la relación laboral vigente.
  - `fechaTerminoContrato` *(string, ISO)*: Fecha de término (obligatoria en Plazo Fijo).
  - `isActive` *(boolean)*: Estado operativo del trabajador.
  - `fcmToken` *(string, opcional)*: Token para notificaciones push en Android/iOS o Web.
  - `assignedSites` *(string[] | number[], opcional)*: Lista de IDs de sucursales autorizadas para usuarios con rol `mandante` (o supervisores).
  - `mandanteViewMode` *(string, opcional)*: Preferencia de vista para el Portal Mandante (`'auto' | 'con_rondas' | 'sin_rondas'`). Por defecto `'auto'` deduce el modo según `rondasEnabled` de las sucursales asignadas.

### 1.2 `Contratos` (Registro Histórico y Vigente de Contratos)
- **ID de Documento:** `contratoId` (auto-generado o prefijado `contrato_{timestamp}_{random}`).
- **Campos Principales:**
  - `empleadoId` *(string)*: Referencia a `Colaboradores/{userId}`.
  - `nombreEmpleado` *(string)*: Nombre completo para reportes directos.
  - `rutEmpleado` *(string)*: RUT del titular.
  - `cargo` *(string)*: Cargo asignado en el contrato.
  - `tipoContrato` *(string)*: Modalidad contractual.
  - `fechaInicio` *(string, YYYY-MM-DD)*: Fecha de inicio de la vigencia.
  - `fechaTermino` *(string, YYYY-MM-DD)*: Fecha de finalización.
  - `sueldoBase` *(number)*: Sueldo base en pesos chilenos (CLP).
  - `plantillaId` *(string)*: Referencia a `plantillas_contratos/{plantillaId}`.
  - `plantillaNombre` *(string)*: Nombre de la plantilla maestra utilizada.
  - `documentoId` *(string, opcional)*: Referencia a `documents/{docId}` si se emitió con firma digital.
  - `urlPdf` *(string)*: URL pública en Firebase Storage del PDF generado.
  - `sha256` *(string)*: Hash criptográfico SHA-256 del archivo PDF oficial.
  - `estado` *(string)*: `'vigente' | 'renovado' | 'caducado'`.
  - `estadoDocumental` *(string)*: `'pendiente_firma' | 'firmado_digital' | 'firmado_fisico'`.
  - `fechaEmision` *(Timestamp)*: Momento exacto de la emisión serverless.

### 1.3 `plantillas_contratos` (Plantillas Maestras DOCX)
- **ID de Documento:** `plantillaId` (UUID o identificador alfanumérico).
- **Campos Principales:**
  - `nombre` *(string)*: Nombre descriptivo (ej. `"Contrato Plazo Fijo - Jornada 4x4"`).
  - `tipoContrato` *(string)*: Modalidad legal asociada.
  - `storagePath` *(string)*: Ruta en Firebase Storage (`contract_templates/{fileName}`).
  - `downloadUrl` *(string)*: URL pública protegida de descarga del archivo DOCX.
  - `variablesDetectadas` *(array de strings)*: Lista de variables dinámicas encontradas en el DOCX (ej. `["nombre_trabajador", "rut_trabajador", "sueldo_base"]`).
  - `activa` *(boolean)*: Si la plantilla está disponible para nuevas emisiones.
  - `esEjemploSintetico` *(boolean)*: Indica si es una plantilla de pruebas preconfigurada.
  - `createdAt` / `updatedAt` *(Timestamp)*.

### 1.4 `documents` (Bandeja Digital de Firma de Documentos)
- **ID de Documento:** `docId` (auto-generado).
- **Campos Principales:**
  - `title` *(string)*: Título visible para el trabajador (ej. `"Contrato Individual de Trabajo"`).
  - `type` *(string)*: `'contrato' | 'anexo' | 'reglamento' | 'epp' | 'odi'`.
  - `assignedTo` *(string)*: UID del trabajador (`Colaboradores/{userId}`).
  - `status` *(string)*: `'pending' | 'signed'`.
  - `fileUrl` *(string)*: URL del PDF original por firmar.
  - `signedUrl` *(string, opcional)*: URL del PDF final con la firma y QR estampados.
  - `signatureCoordinates` *(object)*: `{ page: number, x: number, y: number, width: number, height: number }`.
  - `sha256Hash` *(string)*: Hash criptográfico del documento final firmado.
  - `createdAt` *(Timestamp)*.
  - `signedAt` *(Timestamp, opcional)*.

### 1.5 `validacionesDocumentos` (Registro Público de Integridad DT)
- **ID de Documento:** `docId` (mismo ID del documento o token de validación).
- **Campos Principales:**
  - `documentId` *(string)*: ID del documento en `documents`.
  - `sha256` *(string)*: Hash criptográfico inmutable.
  - `signedAt` *(Timestamp)*: Fecha y hora exacta de la firma.
  - `signerName` *(string)*: Nombre del firmante.
  - `signerRut` *(string)*: RUT del firmante.
  - `validationUrl` *(string)*: URL pública para verificar desde cualquier navegador.

### 1.6 `Sucursales` (Instalaciones y Puestos de Vigilancia)
- **ID de Documento:** `id` (numérico o string).
- **Campos Principales:**
  - `name` *(string)*: Nombre de la faena o instalación cliente.
  - `address` *(string)*: Dirección física.
  - `empresa` *(string)*: Razón social del mandante.
  - `rutEmpresa` *(string)*: RUT de la empresa mandante.
  - `active` *(boolean)*: Instalación activa.
  - `rondasEnabled` *(boolean)*: Habilita el módulo de rondas GPS para esta faena.
  - `cargosFijos` *(array de strings)*: Dotación requerida (ej. `["Guardia Diurno", "Guardia Nocturno"]`).
  - `horario` *(object)*: `{ inicio: "07:30", termino: "19:30" }`.
  - `lat` / `lng` *(number)*: Coordenadas geográficas para validación de geocerca.

### 1.7 `Asistencia` & `AsistenciasConsolidadas` (Control Horario)
- **ID de Documento:** `logId` (auto-generado o compuesto `asist_{userId}_{fechaTurno}_{tipo}`).
- **Campos Principales:**
  - `userId` *(string)*: UID del guardia.
  - `userName` / `userRut` *(string)*: Metadatos para auditorías rápidas.
  - `siteId` *(number | string)*: ID de la sucursal.
  - `type` *(string)*: `'in'` (Entrada) o `'out'` (Salida).
  - `timestamp` *(string o Timestamp)*: Momento exacto del registro.
  - `fechaTurno` *(string, YYYY-MM-DD)*: Fecha canónica a la que pertenece la jornada (clave para turnos nocturnos).
  - `horasTurno` *(number)*: Horas computadas trabajadas.
  - `esNocturno` *(boolean)*: Indica si la jornada cruzó la medianoche.
  - `lat` / `lng` *(number)*: Posición GPS capturada al momento del marcaje.
  - `estadoCierre` *(string)*: `'abierto' | 'cerrado_normal' | 'cerrado_automatico' | 'cerrado_forzado'`.

### 1.8 `Rondas` (Rastreo GPS de Guardia en Terreno)
- **ID de Documento:** `roundId` (compuesto `round_{guardId}_{timestamp}`).
- **Campos Principales:**
  - `guardId` *(string)*: UID del guardia que ejecutó la ronda.
  - `siteId` *(number | string)*: Instalación auditada.
  - `startTime` / `endTime` *(string, ISO)*: Rango temporal de la ronda.
  - `status` *(string)*: `'en_progreso' | 'completada' | 'incompleta'`.
  - `totalPoints` *(number)*: Cantidad de coordenadas GPS registradas.
  - `points` *(array de objetos)*: `[{ lat, lng, timestamp }]`.
  - `evidences` *(array de objetos)*: `[{ id, photoUrl, lat, lng, timestamp }]`.

### 1.9 `visitasSupervisor` y Subcolección `seguimientos`
- **ID de Documento:** `visitId` (auto-generado).
- **Campos Principales:**
  - `supervisorId` *(string)*: UID del supervisor en terreno.
  - `siteId` *(number | string)*: Sucursal auditada.
  - `fechaHora` *(string, ISO)*: Timestamp de la auditoría.
  - `estado` *(string)*: `'conforme' | 'con_observaciones'`.
  - `respuestasChecklist` *(object)*: Evaluación de uniforme, libro de asistencia, libro de novedades, puesto.
  - `libroNovedades` *(object)*: `{ estado: 'ok' | 'con_observacion', observacion?: string, dejoConstancia: boolean }`.
  - `fotos` *(Record<string, FotoVisitaRemota>)*: URLs en Firebase Storage con ámbito (`'visita' | 'observacion' | 'libro_novedades' | 'constancia_libro'`). Si `dejoConstancia` es `true`, es obligatoria la foto con ámbito `'constancia_libro'`.
  - `compromisos` *(string, opcional)*: Acuerdos fijados con la guardia o el cliente.
- **Subcolección `seguimientos/{seguimientoId}`:**
  - `creadoPor` *(string)*: UID del usuario que registra el avance.
  - `comentario` *(string)*: Detalle de la acción realizada.
  - `fecha` *(Timestamp)*.
  - `nuevoEstado` *(string)*.

### 1.10 `novedades` y Subcolección `seguimientos`
- **ID de Documento:** `docId` (auto-generado).
- **Campos Principales:**
  - `guardId` *(string)*: UID del guardia o supervisor que reporta.
  - `siteId` *(number | string)*: Faena de la ocurrencia.
  - `tipo` *(string)*: `'falta_guardia' | 'incidente' | 'instalacion' | 'visita_cliente'`.
  - `descripcion` *(string)*: Relato de los hechos.
  - `prioridad` *(string)*: `'baja' | 'media' | 'alta' | 'urgente'`.
  - `estado` *(string)*: `'abierta' | 'en_seguimiento' | 'resuelta'`.
  - `timestamp` *(string)*.
  - `fotos` *(array de strings)*: Evidencias fotográficas.
- **Subcolección `seguimientos/{seguimientoId}`:**
  - Histórico de actualizaciones y trazabilidad de resolución.

---

## 2. Bases de Datos Locales (IndexedDB / Offline-First)

### 2.1 `GGSS_Offline_DB` (`localforage`)
- **Object Store:** `sync_queue`
- **Estructura de `QueueItem`:**
  - `id` *(string, PK)*: Identificador local único (`sq_{timestamp}_{random}`).
  - `operationId` *(string, UUID)*: Identificador determinista usado como ID en Firestore para garantizar idempotencia.
  - `userId` *(string)*: UID del creador para aislamiento por sesión.
  - `actionType` *(string)*: `'ADD_ROUND' | 'UPDATE_ROUND' | 'UPLOAD_EVIDENCE' | 'ADD_NOVEDAD' | 'UPLOAD_NOVEDAD_PHOTO' | 'CHECK_IN' | 'CHECK_OUT' | 'ADD_VISITA_SUPERVISOR' | 'UPLOAD_VISITA_PHOTO'`.
  - `payload` *(any)*: Objeto JSON con los datos del registro.
  - `status` *(string)*: `'PENDING' | 'SYNCING' | 'SYNCED' | 'ERROR'`.
  - `retryCount` *(number)*: Intentos ejecutados (tope en `MAX_RETRIES = 10`).

### 2.2 `RoundsOfflineDB` (IndexedDB Nativo v2)
- **Object Store 1 (`pendingPoints`):** Coordenadas GPS intermedias registradas durante la ronda activa.
- **Object Store 2 (`pendingEvidences`):** Almacena objetos binarios `Blob` de fotografías tomadas durante la ronda, indexadas por `roundId`, para subirlas por presigned URLs solo al finalizar el recorrido.


## notificaciones_supervisor/{id} (Notificaciones internas Supervisor/Administracion)
- Campos: destinatarioUid, tipo (consulta_admin | respuesta_supervisor | seguimiento_novedad), titulo, mensaje, siteId, siteName, origenTipo, origenId, vista, creadaPorUid, creadaPorNombre, leida, leidaEn, creadoEn.
- Lectura/actualizacion de leida solo por el destinatario; sin borrado. Servicio: lib/supervisor/notificacionesSupervisorService.ts. UI: components/supervisor/NotificacionesSupervisorCenter.tsx (campana flotante con contador).
- Ventana operativa estricta: solo se reciben/muestran notificaciones nuevas dentro de las últimas 24 horas o no vistas en un máximo de 36 horas. Registros anteriores a 36 horas (o vistos hace más de 24 horas) se descartan en memoria y no saturan los paneles ni emiten alertas.
- Las alertas del dashboard y el historialGestion usan onSnapshot (tiempo real).
