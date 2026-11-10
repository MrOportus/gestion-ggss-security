# Estado Actual del Sistema (Current Status)

> **Fecha de Actualización:** 02 de Noviembre de 2026  
> **Rama Activa:** `feature/contratos-v2-dev`  
> **Versión del Sistema:** `v6.1.0`

---

## 1. Resumen Ejecutivo del Estado del Repositorio

El sistema se encuentra en un estado funcional estable y operativo. La versión `v6.1.0` incorpora la infraestructura completa de **Contratos V2** (plantillas DOCX sincronizadas en la nube, integración con microservicio Gotenberg v8 en Cloud Run, cálculo automático de sueldo mínimo legal y firma digital criptográfica SHA-256), además de un nuevo build del binario APK para Android con el logo oficial de ASPRO.

---

## 2. Funcionalidades Verificadas y Operativas

### 2.1 Emisión y Gestión Contractual V2
- **Plantillas Maestras en la Nube:** Migración exitosa desde IndexedDB local hacia Firestore (`plantillas_contratos`) y Firebase Storage (`contract_templates/`), garantizando acceso cruzado entre computadores y navegadores.
- **Validación Legal Automática:** Detección de jornada ordinaria vs. parcial y comprobación contra el sueldo mínimo legal vigente en Chile (`lib/contratos/sueldoMinimoLegalService.ts`).
- **Conversión de Alta Fidelidad:** Integración fluida con Gotenberg v8 mediante OIDC autenticado en Cloud Run y previsualización interactiva con selector de coordenadas de firma.
- **Trazabilidad DT:** Registro automático del contrato en `Contratos/{id}` y despacho del documento para firma del guardia en `documents/{id}` con validación pública en `/validar/{id}`.

### 2.2 Dashboard y Alertas Preventivas
- **Panel de RRHH:** Visualización clara de colaboradores con contrato vigente, por vencer y contratos vencidos críticos en una ventana de 15 días para evitar multas de la Dirección del Trabajo.

### 2.3 Operaciones en Terreno (Guardias y Supervisores)
- **Control de Asistencia:** Marcaje geolocalizado en faena con soporte completo de la **Regla de Turno Nocturno** (toda la jornada 19:30-07:30 se almacena bajo la fecha de inicio).
- **Modo Offline Resiliente:** Encolamiento automático en `GGSS_Offline_DB` (`localforage`) cuando el guardia pierde señal en faena, con sincronización idempotente al recuperar red.
- **Rondas de Vigilancia:** Foreground Service en Android que mantiene el rastreo GPS con el teléfono bloqueado y subida directa de fotografías a Bunny.net Object Storage para evitar costos de egress.
- **Visitas de Supervisor:** Checklists de auditoría en terreno y seguimiento de compromisos con el cliente. Soporte de registro fotográfico para el libro de novedades (con o sin observación) y constancia obligatoria en caso afirmativo.
- **Bandeja de Actividad de Supervisores:** Monitoreo y resolución administrativa de alertas/novedades operacionales con filtro predeterminado de novedades no solucionadas (pendientes) y auditoría inmutable en `historialGestion`.

### 2.4 Aplicación Móvil Nativa (Android)
- **Compilación Exitosa:** APK generado y disponible en la raíz del proyecto ([`SistemaAspro-v6.1.0.apk`](file:///e:/proyectos%20AntiGravity/gesti%C3%B3n-ggss-security/SistemaAspro-v6.1.0.apk)) y en el directorio Gradle ([`android/app/build/outputs/apk/debug/app-debug.apk`](file:///e:/proyectos%20AntiGravity/gesti%C3%B3n-ggss-security/android/app/build/outputs/apk/debug/app-debug.apk)).
- **Identidad Corporativa:** El instalador y el icono del teléfono incluyen el escudo oficial de ASPRO generado en todas las densidades de pantalla (`mdpi` a `xxxhdpi` y versión adaptativa con fondo `#000000`).

---

## 3. Asuntos Pendientes y Próximos Pasos

1. **Renovación de API Key de Gemini:**
   - El escaneo óptico de fichas y cédulas de identidad en `components/AIEmployeeModal.tsx` requiere que el usuario ingrese una clave válida en `app_config/gemini` o ejecute `node scripts/set-gemini-key.cjs <KEY>` debido al error HTTP 402 en la cuenta previa.
2. **Merge hacia `master`:**
   - La rama actual `feature/contratos-v2-dev` contiene todas las mejoras de contratos y almacenamiento en la nube; una vez aprobada por el usuario en pruebas de campo, puede fusionarse con la rama principal.
3. **Optimización Futura de Consultas:**
   - Programar la paginación de `Colaboradores` y `Sucursales` en `fetchInitialData` para prevenir lecturas masivas a medida que aumente la dotación.

