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
- **Recomendación:** Desactivar listeners pasivos en vistas que no estén activas en pantalla (desuscribirse al desmontar la vista o cambiar de módulo).

---

## 2. Almacenamiento Local y Persistencia Offline

### 2.1 Retención de Evidencias Fotográficas Huérfanas (`roundsDB.ts`)
- **Problema:** Durante la ejecución de una ronda, las fotografías se almacenan como `Blob` binarios dentro del store `pendingEvidences` de IndexedDB.
- **Impacto:** Si la aplicación se cierra inesperadamente por el sistema operativo, o el usuario desinstala o reinicia la app sin presionar "Finalizar Ronda", estos objetos binarios de alta resolución quedan retenidos en el almacenamiento local del teléfono indefinidamente sin un mecanismo de purga por expiración (*TTL*).
- **Recomendación:** Implementar una rutina de limpieza al inicio de sesión que elimine evidencias huérfanas con más de 48 horas de antigüedad.

### 2.2 Agotamiento de Reintentos en la Cola Offline (`SyncQueueService.ts`)
- **Problema:** La cola de sincronización offline define `MAX_RETRIES = 10`. Si una petición falla 10 veces continuas por problemas de payload o conectividad deficiente, queda en estado de estancamiento silencioso (*silent failure*).
- **Impacto:** El guardia asume que su marcaje fue enviado, pero el registro queda congelado en IndexedDB sin alertar visualmente al usuario ni al administrador.
- **Recomendación:** Crear un banner o alerta en el perfil del guardia cuando existan elementos que hayan superado el umbral de reintentos con opción de "Reintentar ahora" o reportar al supervisor.

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

