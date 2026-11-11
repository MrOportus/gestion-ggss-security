# Índice de Módulos, Páginas y Componentes

Este índice detalla cada módulo funcional de ASPRO, sus archivos de entrada, componentes dependientes, colecciones de Firestore asociadas y roles autorizados.

---

## 1. Módulos Principales (Páginas)

| Módulo / Vista | Ruta / Componente | Roles | Colecciones Firestore | Estado Verificado |
| :--- | :--- | :--- | :--- | :--- |
| **Dashboard Principal** | `pages/AdminDashboard.tsx` | `admin` | `Colaboradores`, `Asistencia`, `Sucursales`, `Contratos`, `novedades` | **Implementado:** KPIs en tiempo real, guardias en servicio, alertas de contratos por vencer y vencidos (15 días). |
| **Asistencia Guardia** | `pages/WorkerAttendance.tsx` | `worker` | `Asistencia`, `documents`, `Colaboradores`, `Rondas` | **Implementado:** Marcaje con GPS, geocercas, rondas, botón de emergencia y firma de documentos. |
| **Consolidado Asistencia** | `pages/AttendancePage.tsx` | `admin` | `Asistencia`, `AsistenciasConsolidadas`, `asistencia_digital`, `asistencia_manual` | **Implementado:** Vista diaria/semanal, horas extras, cálculo nocturno y cierres forzados. |
| **Diagnóstico Asistencia** | `pages/AttendanceShadowQA.tsx` | `admin` (con flag) | `AttendanceShadowDiagnostics`, `AttendanceShadowComparisons` | **Implementado:** Comparador de paridad de datos entre motor legado y V2 consolidado. |
| **Gestión Contractual RRHH** | `pages/HRContractsDashboard.tsx` | `admin`, `rrhh` | `Contratos`, `plantillas_contratos`, `HistoricoContratos`, `Colaboradores` | **Implementado:** Métricas de renovación, alertas críticas, emisión V2 y descarga de contratos. |
| **Gestión de Colaboradores** | `pages/EmployeesPage.tsx` | `admin`, `rrhh` | `Colaboradores`, `RutIndex`, `app_config/gemini` | **Implementado:** Directorio, edición de datos, tallas de uniforme, importación Excel y escaneo IA con Gemini. |
| **Documentos y Firmas** | `pages/DocumentsPage.tsx` | `admin`, `rrhh`, `supervisor` | `documents`, `validacionesDocumentos`, `signatureTemplates` | **Implementado:** Bandeja pendientes/firmados, asignación masiva, biblioteca corporativa y trazabilidad SHA-256. |
| **Pautas y Turnos** | `pages/ShiftManagement.tsx` | `admin`, `jefe_operaciones` | `TurnosProgramados`, `TurnosDiarios`, `ConflictWarnings`, `programacion` | **Implementado:** Grilla mensual/semanal, reemplazos de vacantes, transferencias y turnos nocturnos. |
| **Rondas de Seguridad** | `pages/RoundsAdminPage.tsx` | `admin`, `supervisor` | `Rondas`, `Sucursales` | **Implementado:** Monitoreo de rondas (filtrado por sucursales asignadas en vista supervisor), visualización de rutas sobre mapas Leaflet y verificación de evidencias. |
| **Visitas de Supervisor** | `pages/VisitasSupervisorPage.tsx` | `supervisor`, `admin` | `visitasSupervisor`, subcol. `seguimientos`, `Sucursales` | **Implementado:** Formularios de auditoría en terreno, checklists por instalación y geolocalización. |
| **Libro de Novedades** | `pages/AdminLibroNovedadesPage.tsx` | `admin`, `supervisor` | `novedades`, subcol. `seguimientos`, `Sucursales` | **Implementado:** Bitácora digital de eventos, incidencias graves/leves y seguimiento con responsables. |
| **Portal Mandante** | `pages/MandanteView.tsx` | `mandante`, `admin` | `Sucursales`, `Asistencia`, `Rondas`, `novedades`, `asistencia_manual` | **Implementado:** Portal ejecutivo en tiempo real con vista dual adaptativa (`con_rondas` y `sin_rondas`), modal interactivo de novedades/accesos (personas y vehículos), cobertura operativa y exportación PDF. |
| **Gestión Mandantes** | `pages/MandanteManagement.tsx` | `admin` | `Sucursales`, `Colaboradores` | **Implementado:** Asignación de sucursales autorizadas y selector de modo de vista (`auto`, `con_rondas`, `sin_rondas`) para clientes mandantes. |
| **Préstamos y Anticipos** | `pages/LoansPage.tsx` | `admin` | `Anticipos`, `Prestamos`, `Colaboradores` | **Implementado:** Solicitudes, autorizaciones, cuotas y reportes financieros de personal. |
| **Instalaciones / Faenas** | `pages/SitesPage.tsx` | `admin` | `Sucursales` | **Implementado:** Catálogo de puestos, geocercas GPS, horarios operativos y flags de rondas. |
| **Tareas de Supervisor** | `pages/SupervisorManagement.tsx` | `admin`, `supervisor` | `SupervisorTasks`, `RecurringSupervisorTasks`, `SupervisorSubTasks` | **Implementado:** Planificación y verificación de tareas operativas y rondas de supervisión. |
| **Notas y Recordatorios** | `pages/NotesPage.tsx` | `admin`, `supervisor` | `BoardNotes` | **Implementado:** Tablero de notas adhesivas para cambios de turno y pendientes operativos. |
| **Pagos Diarios Turnos** | `pages/TasksPage.tsx` | `admin` | `TurnosDiarios`, `Sucursales` | **Implementado:** Registro y control de liquidación diaria de turnos extra cubiertos en faenas. |
| **Validación Pública** | `pages/ValidacionPage.tsx` | Público (`/validar/:id`) | `validacionesDocumentos` | **Implementado:** Verificación abierta de autenticidad criptográfica e integridad del documento. |

---

## 2. Componentes Especializados

### 2.1 Emisión Contractual V2 (`components/contratos/`)
- **`ContractEmissionModalV2.tsx`:** Modal orquestador del flujo wizard de 4 pasos (Colaborador/Plantilla, Sueldo Base/Cláusulas, Previsualización y Posicionamiento de Firma, Confirmación).
- **`ContractPdfSignaturePositioner.tsx`:** Visor interactivo del PDF real generado por Gotenberg con zoom, selector de página y arrastre de recuadro para definir coordenadas de firma (X, Y, Pág).
- **`ContractTemplatesManager.tsx`:** Gestión integral de plantillas maestras DOCX (subida a Firebase Storage, detección automática de variables, activación/desactivación).
- **`ContractEmissionsHistory.tsx`:** Tabla histórica de contratos emitidos con descarga de PDF, estado documental y visualización de hash SHA-256.

### 2.2 Asistencia y Turnos (`components/attendance/` y raíz)
- **`ConsolidatedAttendanceTable.tsx`:** Grilla avanzada con soporte de filtros, horas efectivas, indicadores de puntualidad y estado de cierre.
- **`ConsolidatedAttendanceDetailModal.tsx`:** Detalle completo de una jornada, logs de auditoría y traza de modificaciones.
- **`DailyShiftPayment.tsx`:** Gestión de transferencias y pagos diarios para guardias de apoyo y turnos adicionales.
- **`ShiftTransferModal.tsx`:** Reasignación controlada de pautas de turnos programados entre colaboradores.

### 2.3 Supervisión y Terreno (`components/visitas/`)
- **`SupervisorVisitas.tsx`:** Interfaz móvil para supervisores en terreno: lista de instalaciones asignadas, estado de auditorías y botón de nueva visita.
- **`FormularioVisita.tsx`:** Checklist dinámico, captura de firmas manuscritas y toma de fotografías subidas a Bunny.net.
- **`VisitasAdminPanel.tsx`:** Panel gerencial de análisis de visitas, porcentaje de conformidad y seguimiento de hallazgos.
- **`VisitaSeguimientoModal.tsx`:** Gestión de compromisos acordados con el cliente o la guardia en terreno.

### 2.4 Libro de Novedades (`components/novedades/`)
- **`NovedadesPendientes.tsx`:** Listado de eventos abiertos organizados por nivel de urgencia.
- **`IniciarSeguimientoModal.tsx`:** Registro de acciones correctivas inmediatas ante una novedad reportada.
- **`NovedadSeguimientoModal.tsx`:** Bitácora histórica con comentarios, fechas de avance y cambio a estado resuelto.

### 2.5 Personal y Documentación
- **`AIEmployeeModal.tsx`:** Escaneo de fichas de personal y carnets mediante la API multimodal de Google Gemini.
- **`SignatureModal.tsx`:** Lienzo táctil (`canvas`) para captura manuscrita de la firma del trabajador en teléfonos y tablets.
- **`TemplateAssignModal.tsx`:** Asignación de reglamentos internos, comprobantes de entrega de EPP y directivas legales.

---

## 3. Servicios Core (`lib/`)

- **`lib/mandante/mandanteMetricsService.ts`:** Servicio puro para el Portal Mandante: resolución del modo de vista (`auto` / `con_rondas` / `sin_rondas`), cálculo de duración promedio excluyendo rondas `> 25 min`, rendimiento por guardia/día, cobertura de servicio (`Asistencia`), filtrado de accesos de personas/vehículos (`novedades`) y normalización de novedades.
- **`components/mandante/`:** Componentes ejecutivos del Portal Mandante (`NovedadesResumenModal.tsx`, `RendimientoRondasCard.tsx`, `MandanteReportes.tsx`, `mandanteUiConstants.ts`).
- **`lib/contratos/localContractTemplateService.ts`:** Servicio que administra la sincronización de plantillas DOCX entre Firestore y Firebase Storage, con fallback a IndexedDB y migración transparente.
- **`lib/contratos/sueldoMinimoLegalService.ts`:** Validador en tiempo real del sueldo mínimo legal en Chile, con detección de jornada parcial, advertencias y cálculo proporcional.
- **`lib/SyncManager.ts` & `lib/SyncQueueService.ts`:** Orquestador de la cola offline en IndexedDB con reintentos idempotentes al recuperar conectividad.
- **`lib/UpdateService.ts`:** Controlador de actualizaciones por aire (OTA) y comprobación de versiones de APK nativo.
- **`lib/roundsDB.ts`:** Almacenamiento local de puntos GPS y Blobs de fotos para rondas de seguridad.
- **`lib/gpsUtils.ts`:** Cálculo de distancias haversine y validación de geocercas respecto a sucursales.

