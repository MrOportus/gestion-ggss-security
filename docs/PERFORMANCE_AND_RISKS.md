# Rendimiento, Almacenamiento y Matriz de Riesgos

Este documento consolida los hallazgos técnicos respecto a cuellos de botella de rendimiento, almacenamiento acumulativo y riesgos de arquitectura detectados durante la auditoría.

---

## 1. Rendimiento y Consultas a Firestore

### 1.1 Descargas Masivas al Iniciar Sesión (`useAppStore.ts`)
- **Problema:** En la función `fetchInitialData`, la aplicación realiza llamadas `getDocs` sin límite sobre las colecciones `Colaboradores` y `Sucursales`:
  ```typescript
  const empSnapshot = await getDocs(collection(db, "Colaboradores"));
  const siteSnapshot = await getDocs(collection(db, "Sucursales"));
  ```
- **Impacto:** Conforme la dotación crezca a cientos de guardias y decenas de sucursales, cada inicio de sesión descargará la base completa de personal, incrementando drásticamente las lecturas en Firestore y el tiempo de carga inicial (*Time to Interactive*).
- **Recomendación para Futuras Fases:** Implementar paginación bajo demanda (*infinite scroll*) o almacenar un índice liviano en caché local con revalidación mediante timestamps (`updatedAt`).

### 1.2 Múltiples Listeners Concurrentes en Tiempo Real
- **Problema:** El store mantiene hasta 6 listeners `onSnapshot` abiertos simultáneamente sobre colecciones como `TurnosDiarios`, `Anticipos`, `Prestamos`, `Rondas` y `documents`.
- **Impacto:** En dispositivos móviles de gama media o baja (usados habitualmente por personal en faena), múltiples WebSockets abiertos generan consumo excesivo de memoria RAM y drenaje acelerado de batería.
- **Mitigación aplicada:** Se añadieron límites (`limit(100)`) en listeners de `documents` no-admin (`store/useAppStore.ts`), `SupervisorTasks`, `SupervisorSubTasks` y `Prestamos`, y `limit(50)` en consultas de `novedades` (seguimiento) y `company_documents` en `pages/WorkerAttendance.tsx`.
- **Recomendación:** Desactivar listeners pasivos en vistas que no estén activas en pantalla (desuscribirse al desmontar la vista o cambiar de módulo).

---

## 2. Almacenamiento Local y Persistencia Offline

### 2.1 Evidencias Fotográficas y Puntos GPS en Rondas (`lib/roundsDB.ts` + `lib/storage/StorageCleanupService.ts`)
- **Problema original:** Durante una ronda, las fotos (`pendingEvidences`) y puntos GPS (`pendingPoints`) quedaban en `RoundsOfflineDB` sin purga de `pendingPoints` ni protección de ronda activa en arranque; además `<input type="file" capture="environment">` en Android WebView (`BridgeWebChromeClient.showImageCapturePicker()`) dejaba los JPEG originales sin comprimir de forma permanente en `/Android/data/com.ggss.security/files/Pictures/` y varias rutas hacían fallback al archivo crudo sin comprimir o guardaban cadenas Base64 redundantes (`+33%`).
- **Mitigación aplicada vía OTA:**
  1. **Captura Nativa Segura Unificada (`lib/imageUtils.ts`):** `captureAndCompressPhoto` y `captureAndCompressPhotos` unifican cámara/galería en todos los módulos (`RoundsControl.tsx`, `WorkerAttendance.tsx`, `IncidenciasPage.tsx`, `FormularioVisita.tsx`, `visitasService.ts`, `NovedadSeguimientoModal.tsx`, `VisitaSeguimientoModal.tsx`, `InformarRenuncia.tsx`), decodifican mediante `URL.createObjectURL` (sin duplicar Base64 en RAM), fuerzan compresión JPEG (`maxWidth: 1024`) sin fallbacks crudos y, en Android nativo, usan `@capacitor/camera` (`Camera.getPhoto` con `CameraResultType.DataUrl` y `saveToGallery: false`) para que `LegacyCameraFlow.deleteImageFile()` elimine el archivo temporal nativo al retornar la foto.
  2. **Limpieza de `pendingPoints` y Retención Offline 14 días (`lib/roundsDB.ts`, `lib/OfflineCache.ts`, `lib/storage/StorageCleanupService.ts`):** `roundsDB.clearPointsForRound(roundId)` elimina puntos GPS tras confirmar sincronización `COMPLETED` en `processSyncQueue()`, `roundsDB.clearPointsOlderThan(cutoffIso, activeRoundId)` depura huérfanos `>15` días protegiendo la ronda activa (`App.tsx` pasa `activeRoundId`), y `OfflineCache.cleanOldShifts(14)` preserva `14` días de historial offline de turnos.
- **Limitación Nativa Residual (Requiere APK si se desea purga histórica):** Ningún plugin compilado en el APK base (`6.0.0`) expone listado o borrado de archivos previos acumulados en `/Android/data/com.ggss.security/files/Pictures/`. Los nuevos disparos vía `Camera.getPhoto` ya no acumulan allí, pero el histórico previo a la OTA permanece hasta una eventual actualización nativa aprobada.

### 2.2 Cola de Sincronización Offline y Payloads Binarios (`lib/SyncQueueService.ts` + `store/useAppStore.ts`)
- **Problemas originales:** Cada punto GPS durante una ronda generaba un ítem `UPDATE_ROUND` completo (`O(N²)` en `sync_queue`), los ítems de foto siempre serializaban Base64 (`+33%`), errores tras `MAX_RETRIES = 10` quedaban en estado `ERROR` sin recuperación de `SYNCING` colgados por cierre abrupto, y la cola multiusuario requiere monitoreo visual.
- **Mitigación aplicada vía OTA:**
  - `SyncQueueService.enqueue('UPDATE_ROUND', ...)` realiza coalescencia O(1) fusionando actualizaciones pendientes/error no en vuelo de la misma ronda y usuario.
  - `SyncQueueService.compactPendingUpdateRounds()` (ejecutada al inicio de `processSyncQueue()` y en `StorageCleanupService.compactSyncQueue()`) consolida duplicados históricos cronológicamente.
  - `SyncQueueService.recoverStaleSyncingItems()` restablece ítems dejados en `SYNCING` >2 minutos tras cierres abruptos de la app.
  - Lectura y almacenamiento dual (`photoBlob || photoBase64`) mediante `SyncQueueService.supportsBlobPayloads()` + `uploadBytes` directo para `Blob` en `useAppStore.uploadBase64`, preservando retrocompatibilidad completa con colas previas.
- **Recomendación pendiente:** Añadir indicador visual en UI para ítems que superaron `MAX_RETRIES = 10` (`status === 'ERROR'`) o permanecen en `needs_recovery_review`.

---

## 3. Dependencias Críticas y Servicios de Terceros

### 3.1 Disponibilidad del Contenedor Gotenberg en Cloud Run
- **Riesgo:** La emisión de contratos V2 depende al 100% de la disponibilidad del contenedor de Gotenberg en Cloud Run.
- **Comportamiento en Frío:** Si el servicio escala a cero instancias por inactividad, la primera solicitud puede experimentar una latencia de arranque en frío (*cold start*) de 10 a 15 segundos.
- **Mitigación:** Se configuró un timeout de 60 segundos y 1GiB de memoria en la Cloud Function `emitirContratoV2`, pero se recomienda fijar `min-instances: 1` en Cloud Run si la emisión de contratos se vuelve continua en horarios laborales.

### 3.2 Cuota y Facturación de Google Gemini API
- **Riesgo:** El escáner de fichas y cédulas de personal (`components/AIEmployeeModal.tsx`) invoca modelos multimodales de Google Gemini. Si la API Key se asocia a un proyecto con saldo negativo o límite de cuota alcanzado, la API responde con error HTTP 402 (*Pre-payment required*).
- **Mitigación:** Se dispone del script `scripts/set-gemini-key.cjs` para actualizar la clave de forma centralizada tanto en `.env.local` como en `app_config/gemini` en Firestore.

---

## 4. Coexistencia de Modelos Legados y Nuevos

### 4.1 Transición de Asistencia (Legado `Asistencia` vs. `AsistenciasConsolidadas`)
- **Situación:** El sistema convive entre el modelo tradicional de marcajes en `Asistencia` y el nuevo modelo consolidado con cursores seguros y cierres automáticos (`lib/phase5d2/`).
- **Riesgo de Regresión:** Cualquier modificación directa a la colección `Asistencia` debe respetar los campos requeridos por `shadowAttendanceResolver` para no alterar el cálculo de turnos diarios.

