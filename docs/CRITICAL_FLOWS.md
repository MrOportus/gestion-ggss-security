# Flujos Críticos del Sistema ASPRO

Este documento detalla la secuencia operativa paso a paso de los procesos centrales y de mayor sensibilidad del sistema.

---

## 1. Flujo de Autenticación y Resolución de Roles

```mermaid
sequenceDiagram
    autonumber
    actor User as Usuario / Guardia
    participant UI as Login.tsx
    participant CF as Cloud Function (loginWithRut)
    participant Auth as Firebase Auth
    participant DB as Firestore (Colaboradores / RutIndex)
    participant Store as useAppStore.ts

    User->>UI: Ingresa RUT y Contraseña
    alt Autenticación por RUT
        UI->>CF: loginWithRut({ rut, password })
        CF->>DB: Consulta RutIndex/{rut} para resolver UID/Email
        CF->>Auth: Verifica credenciales
        CF-->>UI: Retorna Custom Token y perfil básico
        UI->>Auth: signInWithCustomToken(token)
    else Autenticación por Email directo
        UI->>Auth: signInWithEmailAndPassword(email, password)
    end
    Auth-->>Store: Trigger onAuthStateChanged (User Authenticated)
    Store->>DB: Lee Colaboradores/{uid} para cargar Rol y Permisos
    Store-->>UI: Asigna currentUser.role ('admin', 'supervisor', 'worker', 'mandante')
    UI->>UI: Renderiza vista según rol (App.tsx)
```

---

## 2. Flujo de Marcaje de Asistencia y Regla de Turno Nocturno

### 2.1 Regla Obligatoria del Turno Nocturno
> **Regla de Negocio:** Cuando un turno de guardia inicia durante la noche de un día y finaliza durante la mañana del día siguiente (por ejemplo: turno 4x4 o noche regular de **19:30 a 07:30**), toda la jornada laboral y su asistencia **pertenecen y se registran bajo la fecha del día de inicio**. Si el guardia entra el 22 a las 19:30 y sale el 23 a las 07:30, la propiedad `fechaTurno` de ambos marcajes es estrictamente `"2026-10-22"`.

### 2.2 Secuencia de Marcaje
1. El guardia presiona **"Marcar Entrada"** o **"Marcar Salida"** en `WorkerAttendance.tsx`.
2. Se ejecuta `getCurrentPosition()` mediante `@capacitor/geolocation` para obtener latitud y longitud.
3. Se invoca `lib/gpsUtils.ts` para calcular la distancia haversine respecto a la sucursal asignada. Si la distancia excede la geocerca permitida (ej. 300 metros), la app muestra una advertencia visual.
4. **Evaluación de Conectividad:**
   - **Con Conexión:** Se escribe directamente el documento en la colección `Asistencia`. La Cloud Function `shadowAttendanceResolver` procesa el registro y actualiza las pautas de `TurnosDiarios`.
   - **Sin Conexión (Offline):** Se despacha la acción a `lib/SyncQueueService.ts`, la cual genera un `operationId` determinista y lo guarda en `GGSS_Offline_DB` (`localforage`). En cuanto se restablece la red, `SyncManager.ts` vacía la cola sin duplicar registros.

---

## 3. Flujo de Rondas de Seguridad y Captura de Evidencias

```mermaid
sequenceDiagram
    autonumber
    actor Guard as Guardia en Terreno
    participant App as RoundsControl.tsx
    participant BG as Background Geolocation
    participant LocalDB as RoundsOfflineDB (IndexedDB)
    participant CF as Cloud Function (generateBunnyUploadUrl)
    participant Bunny as Bunny.net Object Storage
    participant DB as Firestore (Rondas)

    Guard->>App: Presiona "Iniciar Ronda"
    App->>BG: Inicia Foreground Service de GPS continuo
    App->>DB: Crea documento Rondas/{roundId} con status: 'en_progreso'
    loop Durante el recorrido
        BG->>LocalDB: Almacena puntos GPS intermedios en 'pendingPoints'
        opt Si toma fotografía de evidencia
            Guard->>App: Captura foto con la cámara
            App->>LocalDB: Guarda foto como Blob binario en 'pendingEvidences'
        end
    end
    Guard->>App: Presiona "Finalizar Ronda"
    App->>BG: Detiene el rastreo en segundo plano
    loop Por cada foto en pendingEvidences
        App->>CF: generateBunnyUploadUrl({ fileName, folder: 'rondas' })
        CF-->>App: Retorna uploadUrl (PUT S3) y publicUrl (CDN)
        App->>Bunny: Sube Blob binario directo a Bunny.net vía PUT
    end
    App->>DB: Actualiza Rondas/{roundId} con puntos finales, evidencias y status: 'completada'
    App->>LocalDB: Limpia stores 'pendingPoints' y 'pendingEvidences'
```

---

## 4. Flujo de Emisión y Firma Digital de Contratos V2

```mermaid
sequenceDiagram
    autonumber
    actor Admin as Administrador / RRHH
    participant UI as ContractEmissionModalV2
    participant Gotenberg as Gotenberg Cloud Run
    participant CF as Cloud Function (emitirContratoV2)
    participant Storage as Firebase Storage
    participant DB as Firestore (Contratos / documents)
    actor Worker as Guardia de Seguridad
    participant SigUI as SignatureModal.tsx
    participant Trigger as calcularHashDocumentoFirmado

    Admin->>UI: Selecciona Colaborador y Plantilla DOCX
    UI->>UI: Valida Sueldo Mínimo Legal (sueldoMinimoLegalService)
    UI->>Gotenberg: Renderiza vista previa del PDF para posicionar firma
    Admin->>UI: Arrastra recuadro de firma (pág, X, Y) y presiona "Emitir"
    UI->>CF: emitirContratoV2({ empleadoId, plantillaId, coordenadasFirma, ... })
    CF->>CF: Compila DOCX con docxtemplater (sustituye 19 variables)
    CF->>Gotenberg: Convierte DOCX a PDF oficial
    CF->>Storage: Sube PDF a /generated_docs/
    CF->>DB: Crea Contratos/{id} (vigente) y documents/{id} (pending)
    CF->>DB: Actualiza fechas de vigencia en Colaboradores/{id}
    CF-->>UI: Retorna éxito con enlaces y hash SHA-256
    Note over Worker: Notificación Push en el celular
    Worker->>SigUI: Abre documento y dibuja firma manuscrita en pantalla
    SigUI->>Storage: Sube firma y genera PDF firmado
    SigUI->>DB: Actualiza documents/{id} a status: 'signed'
    Trigger->>Trigger: onDocumentUpdated detecta firma completada
    Trigger->>DB: Registra en validacionesDocumentos/{id} y marca Contratos como 'firmado_digital'
```

---

## 5. Flujo de Actualización en Caliente (OTA) y Forzado de APK

1. **Al iniciar la aplicación móvil (`App.tsx`):**
   - Se invoca `notifyAppReady()` en `lib/UpdateService.ts` para confirmar a `CapacitorUpdater` que el paquete cargó correctamente (evita rollbacks automáticos).
   - Se activa el listener reactivo de versiones en segundo plano `initAutoUpdateListener()`.
2. **Evaluación de la Versión Nativa (APK):**
   - El servicio lee el documento `app_config/version` en Firestore.
   - Si la versión instalada en el dispositivo es menor que `version` y tiene la bandera `mandatory: true`, se bloquea la interfaz con un modal obligatorio que redirige al usuario a descargar el nuevo APK desde la URL provista (`apkUrl`).
3. **Evaluación de la Versión Web OTA:**
   - Si no requiere nuevo APK, pero existe una `webVersion` superior al paquete local:
     - Se verifica si `SyncQueueService.getPending()` tiene elementos por subir. Si hay marcajes pendientes de sincronización, la actualización se pospone para evitar pérdida de datos.
     - Se descarga en segundo plano el archivo `dist.zip` desde `webUrl`.
     - El bundle queda listo y se activa silenciosamente en la próxima apertura de la app.

