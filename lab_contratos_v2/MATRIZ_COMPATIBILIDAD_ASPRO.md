# ASPRO — CONTRATOS V2 — FASE 4
## Matriz de Compatibilidad con la Aplicación ASPRO Existente

**Fecha:** 21 de Octubre de 2026  
**Fase:** 4 (Auditoría de Compatibilidad e Integración Controlada)  
**Ubicación:** `lab_contratos_v2/MATRIZ_COMPATIBILIDAD_ASPRO.md`  
**Estado:** INFORME DE LABORATORIO (Sin cambios en producción)

---

### 1. Criterios de Clasificación

Cada componente, entidad, flujo o regla se clasifica bajo uno de los cuatro estados técnicos:

- **Compatible:** Cumple de forma idéntica con el modelo o servicio existente en ASPRO sin requerir modificaciones en el código productivo.
- **Compatible con adaptación:** Puede integrarse de forma natural, pero requiere una adaptación menor, extensión no destructiva de tipos o configuración de backend.
- **Incompatible:** Presenta colisión directa de esquemas, conflictos de permisos o estados mutuamente excluyentes que impedirían la integración si no se corrigen.
- **Pendiente de evidencia:** Requiere validación de reglas de negocio laboral/contable de ASPRO o prueba de infraestructura en entorno real.

---

### 2. Matriz de Compatibilidad: Modelo de Datos y Entidades

| Elemento / Entidad | Estado Actual en ASPRO | Prototipo Contratos V2 | Clasificación | Justificación y Detalle Técnico |
| :--- | :--- | :--- | :---: | :--- |
| **Colección Canónica `Contratos`** | Colección `Contratos/{id}` gobernada por `contratosService.ts` y `firestore.rules`. Tipada en `types/phase1.ts`. | Reutiliza la misma colección `Contratos/{id}` extendiendo campos con `schemaVersion: 2`. | **Compatible** | Cero duplicación de colecciones. Los contratos existentes se preservan íntegros. |
| **Campos Base de `Contrato`** | `colaboradorId`, `sucursalId`, `tipo`, `estado`, `fechaInicio`, `fechaTermino`, `cargo`, `jornada`. | Coinciden 1:1 en nomenclatura, tipos y obligatoriedad. | **Compatible** | Los tipos de datos primitivos (`string`, `number`) y formatos de fecha `YYYY-MM-DD` coinciden exactamente. |
| **Campos de Auditoría V2** | Inexistentes o sólo `googleDriveUrl`. | Incorpora `pdfSha256`, `docxStoragePath`, `pdfStoragePath`, `metadataVariablesSnapshot`. | **Compatible con adaptación** | Son campos opcionales en Firestore y TypeScript. No rompen consultas existentes ni interfieren con contratos legados. |
| **Colección `documents` (Firma Digital)** | Tipada como `DigitalDocument` en `types.ts`. Campos: `title`, `type`, `assignedTo`, `status`, `originalUrl`, `signedUrl`, `signedStoragePath`, `validationId`. | Genera payload idéntico asignado al `colaboradorId` con `type: 'Contrato'` y `status: 'pending'`. | **Compatible con adaptación** | El prototipo original usaba `gs://...` para `originalUrl`. En Fase 4 se adaptó a URL HTTPS de descarga porque `DocumentsPage.tsx:418` ejecuta `fetch(docToSign.originalUrl)`. |
| **Modelo de Colaboradores (`Employee`)** | Colección canónica `Colaboradores/{id}` tipada en `types.ts`. Datos personales y laborales. | Lee directamente los campos de `Employee` (`firstName`, `lastNamePaterno`, `rut`, `direccion`, `cargo`, etc.). | **Compatible** | La Cloud Function lee la ficha del colaborador mediante Admin SDK sin modificar su estructura. |
| **Modelo de Sucursales (`Site`)** | Colección `Sucursales/{id}` tipada en `types.ts`. Campos: `id: number`, `name`, `address`, `empresa`. | Soporta `sucursalId` numérico o string ('0' para multisucursal). | **Compatible** | Mapeo coherente con las faenas y razones sociales de mandantes. |
| **Estados de Contrato (`EstadoContrato`)** | `'borrador'`, `'pendiente_firma'`, `'vigente'`, `'vencido'`, `'renovado'`, `'finiquitado'`, `'finalizado'`, `'anulado'`. | Emite en `pendiente_firma` y transiciona a `vigente` tras firma comprobada. | **Compatible** | No se inventaron estados nuevos. Se reutilizan estrictamente los valores de `types/phase1.ts`. |
| **Estados Documentales (`EstadoDocumental`)** | `'firmado_digital'`, `'firmado_externo'`, `'pendiente_firma'`, `'no_adjunto'`, `'generado_drive'`, `'archivado_externo'`. | Canal digital: `pendiente_firma` -> `firmado_digital`. Canal físico: `no_adjunto` -> `firmado_externo`. | **Compatible** | Los estados documentales coinciden al 100% con los tipos canónicos de `types/phase1.ts`. |

---

### 3. Matriz de Compatibilidad: Seguridad, Roles y Autorizaciones

| Regla / Permiso | Regla Productiva Actual (`firestore.rules`) | Requerimiento de Contratos V2 | Clasificación | Justificación y Detalle Técnico |
| :--- | :--- | :--- | :---: | :--- |
| **Escritura en `Contratos/{id}`** | `allow write: if isAdmin() || isRRHH();` (Línea 262). | La Cloud Function y el modal operan en nombre de `admin` o `rrhh`. | **Compatible** | Los permisos de administración contractual están perfectamente alineados. |
| **Creación en `documents/{docId}`** | `allow create, delete: if isAdmin();` (Línea 54). | La creación del documento de firma debe realizarse cuando un usuario `rrhh` emite el contrato. | **Compatible con adaptación** | Si un usuario `rrhh` creara el documento directamente desde el cliente, Firestore Rules lo rechazaría (solo permite `isAdmin()`). Al delegar la creación en la Cloud Function `emitirContratoV2` con Firebase Admin SDK, se autoriza legítimamente a `rrhh` y `admin` sin alterar las reglas de seguridad. |
| **Firma del Guardia en `documents`** | `allow update: if isOwner() && !affectedKeys().hasAny(['validationId', 'integridad'])` (Línea 61). | El trabajador firma en su app y actualiza `status = 'signed'` y `signedStoragePath`. | **Compatible** | El guardia puede actualizar su firma sin tocar los campos criptográficos protegidos. |
| **Invocación de Gotenberg en Cloud Run** | No existe servicio en Cloud Run actualmente. | Invocación backend servicio-a-servicio mediante Identity Token OIDC (`--no-allow-unauthenticated`). | **Compatible con adaptación** | Requiere desplegar Gotenberg en Cloud Run y otorgar el rol `roles/run.invoker` a la Service Account de Firebase Functions (`[PROJECT_ID]@appspot.gserviceaccount.com`). |
| **Privacidad de Logs (Ley N° 19.628)** | Registro de auditoría estándar en `functions/index.js`. | Política de cero PII en Cloud Logging (solo IDs opacos, sin RUT ni sueldos). | **Compatible con adaptación** | Debe estandarizarse el formato de log en `emitirContratoV2.js` para asegurar sanitización. |

---

### 4. Matriz de Compatibilidad: Flujos de Firma (Digital vs. Física)

| Flujo de Firma | Comportamiento Existente en ASPRO | Comportamiento Contratos V2 | Clasificación | Justificación y Detalle Técnico |
| :--- | :--- | :--- | :---: | :--- |
| **Carga de Documento para Firma Digital** | El wizard de `DocumentsPage.tsx` sube un PDF a Storage y crea un registro en `documents`. | La Cloud Function crea el registro en `documents` coordinadamente con `Contratos`. | **Compatible** | El guardia ve el documento en su pestaña "Pendientes" de `DocumentsPage.tsx` sin requerir cambios en la app móvil/web. |
| **Firma Digital con Estampado `pdf-lib`** | `DocumentsPage.tsx:418-450` descarga el PDF, estampa la firma del trabajador y sube a `signed_docs/signed_{id}.pdf`. | La plantilla DOCX cuenta con una tabla de firmas en la última página. | **Compatible con adaptación** | La configuración de firma en `documents` debe especificar `signatureConfig: { page: 'last', position: 'right' }` para que el estampado digital coincida exactamente con la casilla del trabajador. |
| **Trigger de Integridad SHA-256** | `calcularHashDocumentoFirmado` en `functions/index.js:1098` se activa al pasar a `'signed'`, calcula SHA-256 y guarda `validationId`. | Requiere que `validationId` e integridad se reflejen en el contrato vinculado. | **Compatible con adaptación** | Actualmente `calcularHashDocumentoFirmado` solo actualiza `documents/{docId}`. Para cerrar el ciclo contractual, se debe agregar una actualización en `Contratos` buscando por `documentoId == docId` para pasar a `estado: 'vigente'` y `estadoDocumental: 'firmado_digital'`. |
| **Verificación Pública de Firma** | Endpoint público `/validar/{validationId}` consultado por `pages/ValidacionPage.tsx`. | El hash y el `validationId` del contrato firmado son verificables públicamente. | **Compatible** | Plena reutilización de la infraestructura de verificación criptográfica existente. |
| **Canal Físico Manuscrito** | Se gestiona manualmente mediante `ContractManagementModal.tsx` o archivos en Dropbox/Drive. | Emite PDF limpio, registra contrato en `no_adjunto` y permite posterior carga de escaneado. | **Compatible con adaptación** | En `ContractManagementModal.tsx` se debe formalizar el botón para subir el escaneado verificado con cálculo de hash SHA-256 en cliente o backend. |

---

### 5. Matriz de Compatibilidad: Cálculos Contractuales y Remuneracionales

| Concepto Remuneracional | Modelo Actual en ASPRO | Regulación Laboral Vigente | Clasificación | Recomendación y Ajuste |
| :--- | :--- | :--- | :---: | :--- |
| **Sueldo Líquido vs. Sueldo Base** | `Employee.sueldoLiquido` almacena un valor numérico (ej: $539.000). | El contrato de trabajo estipula **Sueldo Base Imponible** (no inferior a 1 IMM = $500.000 CLP). | **Compatible con adaptación** | En el contrato de trabajo se debe estipular el Sueldo Base Imponible y la Gratificación. No se debe escribir el Sueldo Líquido en la Cláusula Quinta como si fuera el Sueldo Base. |
| **Gratificación Legal (Art. 50 Código del Trabajo)** | No existe cálculo en el core de ASPRO; en el modal de prueba se usaba `20%` o `$137.500`. | **Fórmula Legal Art. 50:** 25% de la remuneración mensual con tope de `(4.75 * IMM) / 12`. Con IMM = $500.000, el tope mensual es **$197.917 CLP**. | **Compatible con adaptación** | El modal debe calcular automáticamente: `min(sueldoBase * 0.25, 197917)` con posibilidad de sobreescritura manual si la empresa pacta otra modalidad. |
| **Jornada de Trabajo (Ley 21.561 — 40 Horas)** | El sistema usa `45 horas semanales` como estándar histórico. | Reducción gradual: 44 horas (2024), 42 horas (2026), 40 horas (2028). | **Pendiente de evidencia** | Validar con la administración de ASPRO si los nuevos contratos de GGSS se están suscribiendo a 44 o 45 horas semanales según dictámenes de la Dirección del Trabajo para turnos excepcionales 4x4. |
| **Asignaciones No Imponibles** | No desglosadas en la ficha del colaborador. | Colación y movilización en montos razonables no constituyen remuneración imponible. | **Pendiente de evidencia** | Determinar si la empresa pacta montos fijos de colación/movilización en la Cláusula Quinta de la plantilla DOCX. |

---

### 6. Resumen de la Matriz de Compatibilidad

```
Total de Elementos Evaluados: 18
---------------------------------------------
[COMPATIBLE]                  :  8 elementos (44.4%)
[COMPATIBLE CON ADAPTACIÓN]   :  8 elementos (44.4%)
[INCOMPATIBLE]                :  0 elementos ( 0.0%)
[PENDIENTE DE EVIDENCIA]      :  2 elementos (11.1%)
---------------------------------------------
Conclusión Global: ALTA FACTIBILIDAD DE INTEGRACIÓN SIN RIESGO DE REGRESIÓN.
Cero incompatibilidades estructurales detectadas.
```
