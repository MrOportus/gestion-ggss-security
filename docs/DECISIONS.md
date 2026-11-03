# Registro de Decisiones de Arquitectura (ADR)

Este documento registra las decisiones técnicas clave adoptadas en el diseño y evolución de la plataforma ASPRO.

---

### AD-01: Generación de Contratos mediante Plantillas DOCX y Gotenberg v8
- **Contexto:** Se requería emitir contratos laborales legales con formato formal idéntico a Word, cláusulas dinámicas, saltos de página controlados y coordenadas exactas para la firma digital del guardia.
- **Alternativas Evaluadas:**
  1. Generación pura en cliente con `jsPDF` o `html2pdf`: Descartada por mala fidelidad tipográfica, problemas de paginación e inconsistencias entre navegadores.
  2. Cloud Function con Chromium headless (`puppeteer`): Descartada por alto consumo de memoria RAM (>2GB) y arranques lentos en serverless.
- **Decisión:** Utilizar `docxtemplater` para sustituir variables en documentos Word `.docx` maestros y delegar la conversión a PDF en un contenedor privado de **Gotenberg v8** en Google Cloud Run.
- **Resultado:** Renderizado idéntico al documento original de RRHH, soporte completo de tablas complejas y bajo consumo de cómputo en las Cloud Functions.

---

### AD-02: Bypass de Egress en Firebase Storage usando Bunny.net
- **Contexto:** Las rondas de seguridad y visitas de supervisor capturan cientos de fotografías diarias de evidencia. Almacenarlas y servirlas masivamente desde Firebase Storage genera costos elevados de transferencia de salida (*egress*).
- **Decisión:** Integrar **Bunny.net Object Storage** compatible con S3 y su red CDN global. La app solicita una URL prefirmada mediante la función `generateBunnyUploadUrl` y sube los archivos directamente a Bunny sin tocar los servidores de Firebase.
- **Resultado:** Reducción sustancial de costos de transferencia y mayor velocidad de carga de fotografías en paneles administrativos mediante el CDN.

---

### AD-03: Actualizaciones Híbridas (OTA Silencioso vs. APK Nativo)
- **Contexto:** Distribuir una nueva versión de APK para cada ajuste de interfaz obligaba a los guardias en terreno a descargar e instalar paquetes manualmente, provocando que muchos quedaran en versiones desactualizadas.
- **Decisión:** Implementar `@capgo/capacitor-updater` para canalizar el 95% de los cambios (UI, lógica React, estilos) a través de actualizaciones silenciosas por aire (OTA) descargando un ZIP en segundo plano. El forzado de APK se reserva exclusivamente para cambios en plugins nativos o permisos de Android.
- **Resultado:** Despliegues inmediatos y transparentes sin fricción para el personal en faena.

---

### AD-04: Servicio en Primer Plano (Foreground Service) para Rondas GPS
- **Contexto:** En dispositivos Android modernos, los mecanismos de optimización de batería suspenden los procesos en segundo plano y las llamadas a geolocalización cuando el guardia apaga la pantalla del teléfono durante su ronda de vigilancia.
- **Decisión:** Incorporar el plugin `@capacitor-community/background-geolocation` con un servicio en primer plano persistente (`LocationService`) configurado en `AndroidManifest.xml` con notificación activa en la barra de estado.
- **Resultado:** Adherencia GPS continua y registro ininterrumpido de la ruta de la ronda, aun con la pantalla del dispositivo bloqueada en el bolsillo del guardia.

---

### AD-05: Criptografía HMAC-SHA256 para Paginación de Asistencia V2
- **Contexto:** Las consultas de asistencia en faenas con alta rotación requerían paginación stateless segura que impidiera al usuario manipular los parámetros del cursor (ej. saltarse filtros de sucursal o alterar fechas).
- **Decisión:** Firmar los tokens de cursor con HMAC-SHA256 utilizando un secreto simétrico gestionado directamente en **Google Cloud Secret Manager** (`CURSOR_SIGNING_SECRET`).
- **Resultado:** Integridad garantizada de la paginación con comportamiento *fail-closed* ante manipulaciones no autorizadas.

---

### AD-06: Regla Canónica de Turno Nocturno en Asistencia
- **Contexto:** En servicios de seguridad privada, los turnos nocturnos inician habitualmente a las 19:30 o 20:00 y terminan al día siguiente a las 07:30 o 08:00. Registrar la salida bajo la fecha del día siguiente fragmentaba el cómputo de la jornada en dos días distintos.
- **Decisión:** Establecer a nivel de dominio que toda la jornada (entrada y salida) pertenece inmutablemente a la fecha del día de inicio (`fechaTurno`).
- **Resultado:** Consistencia total en el cálculo de horas trabajadas, reportes de asistencia para nómina y cuadraturas operativas.

---

### AD-07: Prohibición de Alertas Nativas del Navegador
- **Contexto:** Los diálogos nativos `window.confirm()` y `alert()` rompen la experiencia de usuario en aplicaciones móviles empacadas con Capacitor y pueden ser bloqueados por los motores de WebView.
- **Decisión:** Prohibir terminantemente el uso de popups nativos y canalizar todas las confirmaciones a través del método reactivo `showConfirmation` provisto por `store/useAppStore.ts`.
- **Resultado:** Experiencia de usuario uniforme, estética corporativa coherente y control total sobre los eventos de confirmación y cancelación.

---

### AD-08: Migración de Plantillas DOCX a Firebase Storage + Firestore
- **Contexto:** Inicialmente, las plantillas DOCX personalizadas se almacenaban localmente en el IndexedDB del navegador donde se subían, impidiendo que otros administradores o computadores accedieran a ellas.
- **Decisión:** Centralizar los archivos binarios DOCX en Firebase Storage (`contract_templates/`) y sus metadatos en Firestore (`plantillas_contratos/`), manteniendo compatibilidad offline e implementando migración automática en el primer arranque.
- **Resultado:** Acceso ubicuo a las plantillas maestras desde cualquier equipo y respaldo seguro en la nube.

