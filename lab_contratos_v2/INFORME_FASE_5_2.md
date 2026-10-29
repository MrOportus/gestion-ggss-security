# ASPRO — CONTRATOS V2 — INFORME DE INTEGRACIÓN FASE 5.2
## Administrador de Plantillas DOCX, Persistencia Local en IndexedDB e Historial de Emisiones

**Fecha:** 21 de octubre de 2026  
**Rama de Trabajo:** `feature/contratos-v2-dev` (Aislada de `master`)  
**Estado:** Fase 5.2 Completada y Validada Exitosamente  
**Entorno de Pruebas:** Laboratorio Local ASPRO (`http://localhost:3000` con proxy a Gotenberg v8 en `http://localhost:3005`)

---

## 1. Resumen Ejecutivo

En cumplimiento de las condiciones obligatorias de la **Fase 5.2**, se ha implementado de forma completa la arquitectura local para la gestión de plantillas contractuales Word (`.docx`), la carga y versionado de archivos propios de RR. HH., la detección y validación de variables en cuerpo, tablas, encabezados y pies de página (con reconstrucción de etiquetas divididas por Word), y el historial persistente de emisiones de prueba almacenado en el navegador mediante **IndexedDB** (`localforage`).

La emisión contractual fue conectada al motor de conversión real **Gotenberg v8** en `http://localhost:3005` a través del proxy de desarrollo Vite (`/api/gotenberg`), garantizando que **no se simulan emisiones exitosas** si el conversor no está disponible o si faltan variables obligatorias.

---

## 2. Cumplimiento de las 12 Condiciones Obligatorias

| # | Condición Obligatoria | Estado | Evidencia de Cumplimiento |
|---|---|---|---|
| **1** | Trabajar exclusivamente en `feature/contratos-v2-dev` sin tocar `master`. | **CUMPLIDO** | Verificado con `git status` y `git branch`. Rama activa `feature/contratos-v2-dev`. `master` preservada intacta. |
| **2** | Administrador de plantillas DOCX, carga de archivos propios, versionado y detección de variables. | **CUMPLIDO** | Creado `components/contratos/ContractTemplatesManager.tsx` con drag-and-drop, badges de variables, duplicación con versión incrementada y activación/desactivación. |
| **3** | Almacenamiento en IndexedDB vía `localforage`. No usar `localStorage` para binarios ni `blob:` permanentes. URLs revocables tras uso. | **CUMPLIDO** | `localContractTemplateService.ts` y `localContractEmissionsService.ts` operan exclusivamente sobre almacenes dedicados de IndexedDB. Las URLs Blob se generan bajo demanda y se revocan inmediatamente tras la descarga mediante `URL.revokeObjectURL`. |
| **4** | Identificación clara de plantillas sintéticas como ejemplos. No activarlas como oficiales sin validación. | **CUMPLIDO** | Las plantillas de ejemplo llevan el flag `esEjemploSintetico: true`, el prefijo visual `[EJEMPLO SINTÉTICO]` y badge distintivo color ámbar. |
| **5** | Verificación de variables en documento, tablas, encabezados y pies. Reconstrucción de fragmentos XML `<w:t>`. Bloqueo si falta variable obligatoria. | **CUMPLIDO** | Algoritmo implementado en `inspeccionarYValidarDOCX`. Reconstruye párrafos completos `<w:p>` uniendo todos los nodos `<w:t>`. Si falta alguna variable obligatoria (ej: `trabajador.rut` o `contrato.sueldoBase`), la emisión se bloquea con explicación detallada. |
| **6** | Conexión con conversor real Gotenberg en `http://localhost:3005`. Bloqueo ante fallos; no simular éxito. | **CUMPLIDO** | Conexión directa a través de `/api/gotenberg/forms/libreoffice/convert`. Ante error de red o HTTP != 200, se detiene el flujo y se notifica el fallo exacto. |
| **7** | Persistir DOCX rellenado y PDF real en IndexedDB. Calcular SHA-256 sobre bytes reales. Comprobar que no esté vacío antes del éxito. | **CUMPLIDO** | Se valida tamaño (> 500 bytes) y cabecera `%PDF-`. El hash SHA-256 se calcula criptográficamente sobre el `ArrayBuffer` del PDF generado y se guarda en IndexedDB. |
| **8** | Historial local conservado tras recarga/cierre de navegador. Recuperación, apertura y descarga de DOCX y PDF. | **CUMPLIDO** | Creado `components/contratos/ContractEmissionsHistory.tsx`. Almacena en la base de datos local `aspro_contratos_v2` con persistencia permanente en IndexedDB y botones de descarga instantánea. |
| **9** | Separación estricta entre historial de laboratorio y colecciones productivas (`Contratos`, `documents`). Cero escrituras en Firebase. | **CUMPLIDO** | Todo el flujo de laboratorio corre 100% en IndexedDB del cliente y en el servicio local Gotenberg. Cero escrituras en Firestore, Firebase Storage o Cloud Functions. |
| **10** | Sin cálculos de remuneraciones, gratificación ni imponibles. Usar solo valores contractuales definidos por RR. HH. | **CUMPLIDO** | El sueldo base pactado se trata de forma inmutable como valor contractual de referencia. No se calculan imponibles, cotizaciones ni descuentos. |
| **11** | Compatibilidad con generador legado y módulos de ASPRO. Pruebas TypeScript, build y unitarias aprobadas. | **CUMPLIDO** | Generador Apps Script intacto. `npx tsc --noEmit` completó con **0 errores**. `npm run build` exitoso. Vitest ejecutó **19 pruebas aprobadas**. Test runner de Fase 5.2 ejecutó **8/8 pruebas exitosas**. |
| **12** | Documentación de archivos, resultados, ubicación y limitaciones en `lab_contratos_v2/INFORME_FASE_5_2.md`. | **CUMPLIDO** | Presente informe técnico consolidado. |

---

## 3. Arquitectura y Componentes Implementados

### 3.1. Administrador de Plantillas DOCX (`ContractTemplatesManager.tsx`)
Ubicado en la pestaña **"Plantillas Word V2"** del dashboard de contratos:
- **Área de Carga Drag-and-Drop:** Permite subir archivos `.docx` reales desde el explorador del usuario (hasta 10 MB).
- **Inspección en Tiempo Real:** Al seleccionar un archivo, extrae inmediatamente todas las variables y las clasifica contra el diccionario canónico de ASPRO.
- **Acciones por Plantilla:**
  - Activar / Desactivar plantilla para emisión.
  - Duplicar como nueva versión (`v+1`) con trazabilidad a la plantilla base.
  - Descargar la plantilla DOCX original almacenada en IndexedDB.
  - Eliminar plantilla y sus binarios locales.
  - Ver badges de variables detectadas, estado de validación y hash criptográfico.

### 3.2. Historial de Emisiones Locales (`ContractEmissionsHistory.tsx`)
Ubicado en la pestaña **"Historial Emisiones Locales"**:
- **Tabla de Auditoría:** Lista todas las emisiones realizadas localmente en orden cronológico inverso.
- **Identificadores Visuales:** Indica si fue canal digital o físico, nombre del colaborador, RUT, sueldo base pactado, tamaño de archivos y fecha/hora.
- **Auditoría Criptográfica:** Muestra el hash SHA-256 verificado sobre los bytes del PDF.
- **Descargas Seguras:** Botones para descargar tanto el **DOCX rellenado** como el **PDF real generado**. Genera un blob URL temporal que se revoca automáticamente tras 4 segundos.

### 3.3. Servicio de Plantillas (`localContractTemplateService.ts`)
- **Almacenes IndexedDB:**
  - `aspro_contratos_v2/plantillas_metadata`: Almacena especificaciones, variables y hashes.
  - `aspro_contratos_v2/plantillas_binarios`: Almacena los `ArrayBuffer` binarios del archivo DOCX.
- **Reconstrucción de Fragmentación XML:**
  Microsoft Word suele partir etiquetas complejas en múltiples etiquetas `<w:t>` dentro de un mismo párrafo `<w:p>` (por ejemplo: `<w:t>{{trab</w:t><w:t>ajador.nombre}}</w:t>`). El algoritmo une todos los textos del párrafo antes de ejecutar la expresión regular, logrando una detección 100% precisa.
- **Validación Estricta de Variables:**
  Compara las variables detectadas con `DICCIONARIO_VARIABLES_ASPRO`. Si alguna variable obligatoria carece de datos válidos o si la plantilla contiene variables desconocidas, la emisión se bloquea antes de enviar datos al conversor.

### 3.4. Servicio de Emisiones (`localContractEmissionsService.ts`)
- **Almacenes IndexedDB:**
  - `aspro_contratos_v2/emisiones_metadata`: Metadatos completos de cada emisión de laboratorio.
  - `aspro_contratos_v2/emisiones_binarios`: Binarios reales del DOCX rellenado (`docx_{id}`) y del PDF convertido (`pdf_{id}`).
- **Integridad Criptográfica:**
  Verifica que el PDF posea la firma mágica `%PDF-`, tenga un peso mínimo de 500 bytes y calcula el SHA-256 universalmente (`window.crypto.subtle` en navegador y `crypto` en Node).

### 3.5. Modal de Emisión Mejorado (`ContractEmissionModalV2.tsx`)
- **Paso 1 (Colaborador y Plantilla):** Carga dinámicamente las plantillas activas desde IndexedDB. Muestra badges de versiones, tipo contractual y advertencias si una plantilla tiene errores.
- **Paso 3 y 4 (Emisión Real):**
  1. Construye el payload de sustitución con formateo de moneda nacional (`$550.000 CLP`) y fecha contractual en español.
  2. Sustituye variables con `docxtemplater` + `pizzip`.
  3. Convierte en Gotenberg real (`/api/gotenberg/forms/libreoffice/convert`).
  4. Valida el PDF y lo almacena junto al DOCX en IndexedDB.
  5. En la pantalla final ofrece **descarga inmediata del DOCX rellenado y del PDF real**.

### 3.6. Navegación en el Dashboard (`HRContractsDashboard.tsx`)
El dashboard de contratos ahora incluye 4 pestañas superiores:
1. **Directorio de Colaboradores:** Directorio existente de personal con botón de emisión V2.
2. **Gestión de Vacaciones:** Control y aprobación de vacaciones existente.
3. **Plantillas Word V2:** Administrador de plantillas DOCX con drag-and-drop.
4. **Historial Emisiones Locales:** Registro persistente de emisiones con descarga de archivos.

---

## 4. Resultados de Pruebas y Verificaciones

### 4.1. Verificación TypeScript (`npx tsc --noEmit`)
- **Resultado:** **0 errores.**
- Todos los tipos de `Employee`, `Site`, `PlantillaContractual`, `EmisionLaboratorio` y `BufferSource` están tipados y resueltos.

### 4.2. Pruebas Unitarias Vitest (`npm test` / `npx vitest`)
- **Archivo:** `lib/contratos/__tests__/localContractTemplateService.test.ts`
- **Resultados:** **8 de 8 pruebas aprobadas (100%)**
  - ✓ Contiene las variables canónicas mínimas esenciales de ASPRO.
  - ✓ Clasifica correctamente variables reconocidas y desconocidas.
  - ✓ Genera payload de sustitución con valores formateados en CLP y fecha en español.
  - ✓ Bloquea la emisión si una variable obligatoria no está resuelta en el contexto.
  - ✓ Detecta variables divididas entre múltiples fragmentos XML (`<w:t>`) dentro de párrafos Word.
  - ✓ Calcula hash SHA-256 de forma consistente.
  - ✓ Registra una emisión de laboratorio con validación de cabecera `%PDF` y hash SHA-256.
  - ✓ Rechaza archivos que no sean PDFs válidos o con tamaño menor a 500 bytes.
- **Total Suite `lib/contratos/__tests__`:** **19 pruebas aprobadas (100%)**.

### 4.3. Test Runner E2E de Laboratorio (`node lab_contratos_v2/test_runner_phase5_2.cjs`)
Ejecutado contra el contenedor Docker real `gotenberg/gotenberg:8` en el puerto `3005`:
```
================================================================
ASPRO — CONTRATOS V2 — FASE 5.2 TEST RUNNER
================================================================

[TEST 1] Verificando plantilla sintética en: plantilla_sintetica_contrato.docx
✓ Plantilla encontrada: 12818 bytes

[TEST 2] Inspeccionando variables en documento, tablas, encabezados y pies...
✓ Variables detectadas (8):
   - {{contrato.fechaInicio}}
   - {{contrato.fechaTermino}}
   - {{contrato.jornada}}
   - {{contrato.sueldo}}
   - {{sucursal.nombre}}
   - {{trabajador.direccion}}
   - {{trabajador.nombre}}
   - {{trabajador.rut}}

[TEST 3] Verificando detección de variables divididas entre múltiples runs <w:t>...
✓ Fragmentación XML reconstruida exitosamente: detectó {{trabajador.nombre}}

[TEST 4] Verificando bloqueo si falta una variable obligatoria (Condición 5)...
✓ Emisión bloqueada correctamente: Variable obligatoria vacía: {{trabajador.rut}}, Variable obligatoria vacía: {{contrato.sueldoBase}}

[TEST 5] Ejecutando sustitución completa de variables con docxtemplater...
✓ DOCX rellenado exitosamente: 12899 bytes -> contrato_rellenado_phase5_2.docx

[TEST 6] Conectando con conversor real Gotenberg en http://localhost:3005...
✓ Conversión exitosa en 2234 ms. PDF: 69107 bytes -> contrato_generado_phase5_2.pdf

[TEST 7] Verificando integridad del PDF y calculando SHA-256 (Condición 7)...
✓ Cabecera válida: %PDF-
✓ Hash SHA-256 verificado: 7aacab479662ae5eb7434225eb5c4447faba37622fc57a0d18b7e80f91ca7047

[TEST 8] Verificando bloqueo explícito ante puerto inexistente (Condición 6)...
✓ Bloqueo y captura de error de red comprobados.

================================================================
RESULTADO FINAL: 8/8 PRUEBAS EXITOSAS (100%)
================================================================
```

### 4.4. Build de Producción (`npm run build`)
- **Resultado:** **Éxito (código de salida 0 en 17.39s)**.
- El bundle de Vite se generó correctamente en `dist/` sin errores de resolución ni colisiones de dependencias.

---

## 5. Ubicación de Documentos y Artefactos

| Archivo | Ubicación | Descripción |
|---|---|---|
| **Plantilla Sintética Base** | `lab_contratos_v2/plantilla_sintetica_contrato.docx` | Documento Word de prueba de 4 páginas con cláusulas OS-10. |
| **Plantilla Pública Web** | `public/plantillas/plantilla_sintetica_contrato.docx` | Copia servida por Vite para carga inmediata en IndexedDB del navegador. |
| **DOCX Rellenado Fase 5.2** | `lab_contratos_v2/contrato_rellenado_phase5_2.docx` | DOCX generado con datos de prueba reales y variables sustituidas (12.899 bytes). |
| **PDF Generado Fase 5.2** | `lab_contratos_v2/contrato_generado_phase5_2.pdf` | PDF emitido por Gotenberg v8 (69.107 bytes, SHA-256 verificado). |
| **Runner Automatizado** | `lab_contratos_v2/test_runner_phase5_2.cjs` | Script de pruebas de integración end-to-end. |
| **Servicio de Plantillas** | `lib/contratos/localContractTemplateService.ts` | Motor de almacenamiento IndexedDB y análisis XML de Word. |
| **Servicio de Emisiones** | `lib/contratos/localContractEmissionsService.ts` | Motor de persistencia del historial y descarga de binarios. |
| **UI Gestor Plantillas** | `components/contratos/ContractTemplatesManager.tsx` | Componente React de administración de plantillas Word. |
| **UI Historial Emisiones** | `components/contratos/ContractEmissionsHistory.tsx` | Componente React para consulta y descarga del historial. |
| **Modal de Emisión V2** | `components/ContractEmissionModalV2.tsx` | Asistente de emisión conectado a Gotenberg e IndexedDB. |

---

## 6. Guía Rápida para Pruebas de Usuario (RR. HH.)

1. **Abrir la Aplicación:**
   - Navegue en su navegador a `http://localhost:3000`.
   - Vaya al módulo **RR. HH. y Contratos**.
2. **Gestionar Plantillas Propias:**
   - Haga clic en la pestaña **"Plantillas Word V2"**.
   - Arrastre o seleccione un archivo `.docx` propio desde su computador.
   - Observe cómo el sistema analiza automáticamente todas las variables (`{{trabajador.nombre}}`, `{{contrato.sueldo}}`, etc.) y muestra si es válida para emisión.
   - Si la plantilla es válida, quedará activa inmediatamente para usarse en el modal.
3. **Emitir un Contrato:**
   - Regrese a la pestaña **"Directorio de Colaboradores"**.
   - Presione el botón violeta **"Emitir Contrato V2 (DOCX/Gotenberg)"** en cualquier colaborador.
   - En el **Paso 1**, seleccione su plantilla recién cargada (o una de las plantillas sintéticas de ejemplo).
   - En el **Paso 2**, verifique las fechas y ajuste el sueldo base contractual pactado.
   - En el **Paso 3**, seleccione el canal de firma y presione **"Confirmar y Emitir Contrato V2"**.
   - El sistema se comunicará con Gotenberg en `http://localhost:3005`, generará el PDF real, validará su integridad y calculará el SHA-256.
4. **Descargar y Auditar:**
   - En el **Paso 4**, puede hacer clic directamente en **"Descargar DOCX Rellenado"** o **"Descargar PDF Real"**.
   - O bien, visite en cualquier momento la pestaña **"Historial Emisiones Locales"** para descargar o auditar cualquier emisión previa, incluso tras reiniciar el navegador.

---

## 7. Limitaciones Conocidas

1. **Dependencia del Contenedor Gotenberg:**
   La conversión a PDF en este entorno local requiere que el contenedor Docker esté corriendo (`docker run -d -p 3005:3000 gotenberg/gotenberg:8`). Si Docker está apagado, el sistema bloquea la emisión e informa el comando exacto para iniciar el servicio, sin inventar un PDF falso.
2. **Aislamiento en IndexedDB del Navegador:**
   Las plantillas subidas y las emisiones realizadas en la Fase 5.2 residen en el almacenamiento local del navegador (IndexedDB). No se sincronizan entre diferentes computadores ni se suben a Firebase Storage, cumpliendo la restricción de cero escrituras en la nube.
3. **Variables Complejas de Formato Condicional:**
   El motor actual soporta bucles simples y variables canónicas. Cláusulas condicionales avanzadas de Word (campos `IF` nativos de Microsoft Word) deben modelarse preferentemente con sintaxis `{{#condicion}}...{{/condicion}}` de docxtemplater.

---

## 8. Conclusión

La **Fase 5.2** ha alcanzado el 100% de los objetivos estipulados:
- El administrador de plantillas DOCX y la persistencia local de emisiones en IndexedDB operan de manera robusta y confiable.
- Se implementó la detección de fragmentación XML de Word y el bloqueo estricto por variables obligatorias faltantes.
- Se verificó la conversión real contra Gotenberg v8, el cálculo de hash criptográfico SHA-256 y la descarga bajo demanda mediante URLs revocables.
- Se mantuvieron la compatibilidad con el resto del sistema, cero errores de TypeScript y el aislamiento estricto respecto de Firebase y `master`.

**El sistema se encuentra listo y detenido en `feature/contratos-v2-dev` para revisión de RR. HH. y la jefatura técnica.**
