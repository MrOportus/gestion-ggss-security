# ASPRO — CONTRATOS V2 — FASE 4
## Informe de Auditoría de Compatibilidad e Integración Controlada

**Fecha:** 21 de Octubre de 2026  
**Fase:** 4 (Auditoría de Compatibilidad e Integración Controlada)  
**Ubicación:** `lab_contratos_v2/INFORME_FASE_4.md`  
**Estado:** INFORME DE LABORATORIO (Sin cambios en producción)

---

### 1. Resumen Ejecutivo de la Fase 4

El objetivo de la **Fase 4** ha sido evaluar de forma exhaustiva si el prototipo integral de **Contratos V2** (desarrollado y probado en las Fases 1A, 1B, 2 y 3) puede integrarse con total seguridad, retrocompatibilidad y sin riesgo de regresión en la plataforma ASPRO existente.

En estricto apego a las restricciones operacionales:
- **Cero despliegues** y cero modificaciones a bases de datos o servicios de producción.
- **Cero alteraciones** en componentes productivos, reglas de seguridad (`firestore.rules`) o esquemas existentes.
- **Cero eliminación** del generador legado en Google Apps Script.
- Toda la adaptación, pruebas de regresión y documentación se ejecutaron exclusivamente dentro de `lab_contratos_v2/`.

#### Resultado Global:
- **10 de 10 pruebas automatizadas superadas con 100% de éxito (2.368 ms).**
- **Cero incompatibilidades críticas detectadas.**
- De los 18 elementos auditados: **8 son 100% Compatibles**, **8 son Compatibles con adaptación menor en backend/UI**, y **2 están Pendientes de confirmación contable/laboral** por la administración de ASPRO.

---

### 2. Auditoría Detallada de Contratos, Documentos y Modelos

#### 2.1 Colección Canónica `Contratos`
- **Verificación en código:** Se confirmó que la colección canónica consultada por la vista principal `pages/HRContractsDashboard.tsx` y validada por `lib/phase3/contratosService.ts` es `Contratos/{id}`.
- **Compatibilidad del Modelo:** El prototipo Contratos V2 reutiliza y respeta al 100% la estructura de `Contrato` definida en `types/phase1.ts`.
- **Nuevos campos V2 incorporados (todos opcionales y no destructivos):**
  - `plantillaId: string` (identificador de la plantilla DOCX maestra).
  - `plantillaVersion: number` (versión inmutable utilizada al emitir).
  - `pdfSha256: string` (hash criptográfico del PDF emitido antes de firmar).
  - `docxStoragePath: string` y `pdfStoragePath: string` (rutas en Firebase Storage).
  - `estadoEmision: 'emitido' | 'generando' | 'error_emision'`.
  - `canalFirma: 'digital_aspro' | 'fisica_manuscrita'`.
  - `sueldoBase: number` y `gratificacion: number`.
  - `metadataVariablesSnapshot: json` (congelamiento de las variables sustituidas).
  - `schemaVersion: 2`.
- **Gobernanza en Firestore Rules:** La regla existente `match /Contratos/{id} { allow write: if isAdmin() || isRRHH(); }` cubre de forma nativa a los dos únicos roles autorizados para emitir contratos.

#### 2.2 Colección `documents` (Firma Digital)
- **Verificación en código:** El módulo `pages/DocumentsPage.tsx` y el store `useAppStore.ts` operan sobre la colección `documents/{docId}` tipada como `DigitalDocument` en `types.ts`.
- **Hallazgo Clave de Adaptación:**
  - El prototipo inicial de laboratorio utilizaba URLs con prefijo `gs://contracts/...` para el campo `originalUrl`.
  - La inspección minuciosa de `DocumentsPage.tsx:418` reveló la siguiente instrucción crítica:
    ```typescript
    const existingPdfBytes = await fetch(docToSign.originalUrl).then(res => res.arrayBuffer());
    ```
  - Un esquema `gs://` causaría una excepción en el navegador al invocar `fetch()`. En esta Fase 4 se adaptó el generador para emitir URLs de descarga HTTPS válidas de Firebase Storage, garantizando que el visor y el estampador `pdf-lib` de `DocumentsPage.tsx` funcionen de forma nativa.
- **Reglas de Seguridad en `documents`:**
  - En `firestore.rules:54`, la regla es `allow create, delete: if isAdmin();` (no incluye a `isRRHH()`).
  - **Decisión arquitectónica:** La creación del registro en `documents` debe ser realizada por la Cloud Function `emitirContratoV2` usando Firebase Admin SDK. Esto permite que tanto administradores como usuarios de RR. HH. emitan contratos y habiliten la firma del guardia sin requerir relajar las reglas de Firestore en el cliente.

#### 2.3 Modelo de Colaboradores (`Colaboradores/{id}`)
- La Cloud Function lee directamente los datos vigentes del trabajador desde `Colaboradores/{id}` (`Employee` en `types.ts`) para poblar la Cláusula Primera (Comparecencia) y Cláusula Quinta (Remuneraciones). No se requiere ningún campo nuevo en la ficha del empleado.

---

### 3. Auditoría del Modal y Adaptador de Emisión

#### 3.1 Componentes Visuales Reutilizables
- `ContractEmissionModalV2.tsx` aprovecha la iconografía estándar de ASPRO (`lucide-react`: `FileText`, `CheckCircle2`, `Calendar`, `Building`, `Briefcase`, `Clock`, `DollarSign`, `Send`, `Download`).
- Reutiliza las funciones utilitarias consolidadas `normalizeText` y `matchesEmployeeSearch` de `lib/textUtils.ts` para la búsqueda en tiempo real de colaboradores por RUT o nombre.
- El diseño visual se ajusta al tema oscuro de la plataforma (`bg-slate-900`, `text-slate-100`, bordes `border-slate-800`).

#### 3.2 Desacoplamiento y Prevención de Errores
- **Inyección de Dependencias:** El modal no se conecta directamente a Firebase; recibe la función `emissionService` como prop opcional. En pruebas usa `labEmissionAdapter.ts` y en producción llamará a `httpsCallable(functions, 'emitirContratoV2')`.
- **Prevención de Doble Clic:** Al iniciar la emisión, la variable de estado `isEmitting` se activa a `true`, deshabilitando físicamente los botones de envío, bloqueando el avance del stepper y mostrando el progreso en tiempo real (`1/3 Generando DOCX...`, `2/3 Convirtiendo en Gotenberg...`, `3/3 Calculando hash...`).
- **Manejo de Fallos Parciales y Compensación:**
  - Si Gotenberg falla o agota el tiempo de espera (timeout), se retorna error HTTP 503/500, el modal muestra la alerta en rojo y no se crea ningún registro residual en Firestore ni en Storage.
  - Si la subida a Storage es exitosa pero la escritura en Firestore falla (desconexión de red transaccional), el backend ejecuta un **protocolo de compensación reactivo**, eliminando inmediatamente el PDF huérfano de Storage para no generar costos residuales ni inconsistencias de auditoría.
  - La creación de `Contratos/{contratoId}` y `documents/{documentoId}` se ejecuta en una transacción atómica; si falla uno, se anulan ambos.

---

### 4. Validación de los Canales de Firma

#### 4.1 Canal Digital (Firma Electrónica Simple en ASPRO)
1. La Cloud Function genera el PDF de 4 páginas y lo almacena en `contracts/{contratoId}/emitido.pdf`.
2. Crea el registro en `documents/{documentoId}` con:
   - `assignedTo = colaboradorId`
   - `status = 'pending'`
   - `signatureConfig = { page: 'last', position: 'right' }`
   - `originalUrl = https://firebasestorage.googleapis.com/...`
3. Registra el contrato en `Contratos/{contratoId}` con `estado = 'pendiente_firma'`, `estadoDocumental = 'pendiente_firma'` y `documentoId = documentoId`.
4. El guardia ingresa a `DocumentsPage.tsx`, visualiza el contrato, estampa su firma manuscrita y el cliente guarda el firmado en `signed_docs/signed_{docId}.pdf`.
5. El trigger existente `calcularHashDocumentoFirmado` en `functions/index.js:1098` calcula el SHA-256 del firmado y asigna el `validationId` (`ASP-...`).
6. **Mejora requerida en integración:** En `functions/index.js`, vincular la actualización del documento firmado con la actualización del contrato asociado para transicionar automáticamente a `estado: 'vigente'` y `estadoDocumental: 'firmado_digital'`.

#### 4.2 Canal Físico (Firma Manuscrita Tradicional)
1. El administrador emite el contrato seleccionando "Firma Física / Manuscrita".
2. La Cloud Function genera el PDF de 4 páginas idéntico, pero **no crea registro en `documents`**.
3. Registra el contrato en `Contratos/{contratoId}` con:
   - `estado = 'pendiente_firma'`
   - `estadoDocumental = 'no_adjunto'`
   - `canalFirma = 'fisica_manuscrita'`
   - `documentoId = null`
4. El administrador descarga e imprime el PDF para su firma en papel ante notaría o en oficina.
5. El contrato permanece en `pendiente_firma` hasta que el administrador sube el PDF escaneado con las firmas reales mediante `ContractManagementModal.tsx`, registrando el hash SHA-256 del escaneado y transicionando el contrato a `estado: 'vigente'` y `estadoDocumental: 'firmado_externo'`.

---

### 5. Auditoría de Cálculos Contractuales y Remuneracionales

En el análisis de las fórmulas legales aplicables a contratos individuales de trabajo en Chile (Código del Trabajo):

#### 5.1 Distinción entre Sueldo Base Imponible y Sueldo Líquido
- En la base de datos de ASPRO, `Employee.sueldoLiquido` almacena el valor líquido pactado (ej: $539.000 CLP).
- **Advertencia Legal:** Los contratos de trabajo estipulan formalmente montos **brutos o imponibles** en la Cláusula Quinta. Si se redacta el sueldo líquido como sueldo base, tras aplicar los descuentos legales obligatorios (~20% entre AFP, Fonasa/Isapre y AFC), el trabajador recibiría un monto líquido inferior al acordado.
- Por tanto, el modal desglosa y permite editar de forma explícita el **Sueldo Base** y la **Gratificación**, mostrando el **Total Imponible Pactado**.

#### 5.2 Gratificación Legal — Artículo 50 del Código del Trabajo
- El Artículo 50 faculta al empleador a eximirse de la gratificación proporcional de utilidades líquidas (Art. 47) abonando a sus trabajadores el **25% de lo devengado en el respectivo ejercicio comercial por concepto de remuneraciones mensuales**.
- **Tope Legal Anual:** `4,75 Ingresos Mínimos Mensuales (IMM)`.
- **Tope Legal Mensual:** `(4,75 * IMM) / 12`.
- Con el IMM vigente en Chile fijado en **$500.000 CLP**:
  $$\text{Tope Anual} = 4,75 \times \$500.000 = \$2.375.000\text{ CLP}$$
  $$\text{Tope Mensual} = \frac{\$2.375.000}{12} = \$197.916,67 \approx \$197.917\text{ CLP}$$
- **Lógica de Cálculo Recomendada para el Modal:**
  $$\text{Gratificación} = \min(\text{Sueldo Base} \times 0,25,\ 197.917)$$
  - Si Sueldo Base = $550.000 CLP $\rightarrow$ 25% = $137.500 CLP ($\le \$197.917 \rightarrow$ **$137.500 CLP**).
  - Si Sueldo Base = $850.000 CLP $\rightarrow$ 25% = $212.500 CLP ($> \$197.917 \rightarrow$ **Topeado a $197.917 CLP**).
- El modal permite sobreescritura manual en caso de pactos especiales con clientes/mandantes.

---

### 6. Resultados de la Suite Automatizada de Pruebas de Regresión

La suite de pruebas de laboratorio `lab_contratos_v2/test_runner_phase4.cjs` evaluó los 10 escenarios obligatorios arrojando **100% de éxito**:

```
================================================================
 ASPRO — CONTRATOS V2 — FASE 4: AUDITORÍA Y REGRESIÓN (10 TESTS)
================================================================
 [OK] 1. Control de Roles (IAM) — admin y rrhh autorizados; supervisor, worker y anónimos bloqueados con 403/401.
 [OK] 2. Modalidades Plazo Fijo e Indefinido — Plazo Fijo exige fechaTermino y valida cronología; Indefinido procesado exitosamente.
 [OK] 3. Datos Obligatorios Ausentes — Rechazo preventivo con 400 antes de iniciar procesamiento o conversión.
 [OK] 4. Idempotencia y Prevención de Duplicados — Reintento retornó contrato existente #cont_c6a97d37b1ae3488 sin reconvertir.
 [OK] 5. Fallo de Servicio Gotenberg (503/Timeout) — Error 503 capturado limpiamente; cero escrituras residuales en base de datos.
 [OK] 6. Compensación Reactiva en Storage — Fallo de Firestore disparó eliminación inmediata del archivo PDF huérfano en Storage.
 [OK] 7. Atomicidad en Asociación Documental — Transacción abortada: no se genera contrato desvinculado si falla la creación del documento digital.
 [OK] 8. Canal Físico y Posterior Adjunto — Emisión sin documentoId en estado no_adjunto; posterior adjunto de escaneado transiciona a vigente con SHA-256.
 [OK] 9. Preservación del Historial (Renovaciones) — Enlace bidireccional (#cont_3fdfc22d5dd4d9b4 -> #cont_fc3e9a8d552477b4) con numeroRenovacion=2 sin sobreescritura.
 [OK] 10. Compatibilidad de Esquemas TypeScript — Contrato cumple types/phase1.ts (schemaVersion: 2) y DigitalDocument cumple types.ts con URL HTTPS válida.
================================================================
 RESUMEN FASE 4: 10/10 PRUEBAS EXITOSAS (2.368 ms)
================================================================
```

---

### 7. Identificación Expresa de Archivos Productivos a Modificar

Para la futura integración productiva (Fase 5), se requerirá intervenir los siguientes archivos, los cuales se han mantenido **100% intactos** durante esta fase:

1. `functions/package.json`: Incorporar dependencias backend (`docxtemplater`, `pizzip`, `pdf-lib`, `google-auth-library`).
2. `functions/src/contratos/emitirContratoV2.js`: Incorporar la función de emisión ya validada en laboratorio.
3. `functions/index.js`: Exportar `emitirContratoV2` y añadir hook de actualización en `calcularHashDocumentoFirmado`.
4. `types/phase1.ts`: Extender interfaz `Contrato` con los campos opcionales V2 (`plantillaId`, `pdfSha256`, `canalFirma`, etc.).
5. `components/ContractEmissionModalV2.tsx`: Incorporar componente de emisión en el directorio productivo de componentes.
6. `pages/HRContractsDashboard.tsx`: Integrar botón de emisión V2 protegido bajo el Feature Flag `featureFlags.contratosV2`.
7. `store/useAppStore.ts`: Conectar llamada `httpsCallable` y lectura de Feature Flags.

---

### 8. Criterio de Cierre y Recomendación

La auditoría de compatibilidad e integración controlada concluye de forma plenamente satisfactoria. Se cuenta con:
1. Matriz de compatibilidad exhaustiva ([MATRIZ_COMPATIBILIDAD_ASPRO.md](file:///e:/proyectos%20AntiGravity/gesti%C3%B3n-ggss-security/lab_contratos_v2/MATRIZ_COMPATIBILIDAD_ASPRO.md)).
2. Plan de integración controlada por pasos ([PLAN_INTEGRACION_CONTROLADA.md](file:///e:/proyectos%20AntiGravity/gesti%C3%B3n-ggss-security/lab_contratos_v2/PLAN_INTEGRACION_CONTROLADA.md)).
3. Suite de regresión automatizada con 10/10 pruebas exitosas ([benchmark_results_phase4.json](file:///e:/proyectos%20AntiGravity/gesti%C3%B3n-ggss-security/lab_contratos_v2/benchmark_results_phase4.json)).

Me detengo en este punto a la espera de la autorización explícita para coordinar los pasos de integración en producción.
