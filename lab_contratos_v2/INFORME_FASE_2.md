# ASPRO — CONTRATOS V2 — FASE 2
## Informe de Validación: Prototipo Funcional de Laboratorio (Cloud Function emitirContratoV2)

**Fecha:** 21 de Octubre de 2026  
**Fase:** 2 (Prototipo Aislado de Laboratorio)  
**Ubicación:** `lab_contratos_v2/INFORME_FASE_2.md`  
**Estado:** VALIDADO EN LABORATORIO AISLADO (Sin impacto en producción)

---

### 1. Resumen Ejecutivo

En cumplimiento de las decisiones técnicas aprobadas en la Fase 1C, se implementó y validó en laboratorio el prototipo ejecutable de la Cloud Function **`emitirContratoV2`** ([emitirContratoV2_proto.cjs](file:///e:/proyectos%20AntiGravity/gesti%C3%B3n-ggss-security/lab_contratos_v2/emitirContratoV2_proto.cjs)), acompañado de una suite automatizada de pruebas ([test_runner_phase2.cjs](file:///e:/proyectos%20AntiGravity/gesti%C3%B3n-ggss-security/lab_contratos_v2/test_runner_phase2.cjs)).

El prototipo demostró operatividad integral:
- **100% de los tests pasaron exitosamente (5 de 5).**
- **Tiempo de emisión en caliente: ~189 ms total** (sustitución DOCX + conversión Gotenberg + cálculo de hash SHA-256).
- **Idempotencia comprobada:** El reenvío de una solicitud idéntica detecta el duplicado y retorna el contrato previo sin re-ejecutar conversión ni generar basura en almacenamiento.
- **Control de acceso IAM y validación estricta:** Rechaza solicitudes de roles no autorizados (`worker`, `supervisor`) y frena emisiones incompletas antes de invocar servicios externos.

---

### 2. Resultados de la Suite Automatizada de Pruebas

| Test | Escenario Evaluado | Resultado | Comportamiento Observado |
| :--- | :--- | :---: | :--- |
| **Test 1** | **Emisión Canal Digital ASPRO** |  **PASÓ** | Generó PDF de 4 páginas A4, calculó SHA-256 (`eb87a11f...`), asignó `documentoId` para firma en app y generó payload canónico en 2.014 ms (arranque inicial Gotenberg). |
| **Test 2** | **Emisión Canal Físico Manuscrito** |  **PASÓ** | Generó PDF de 4 páginas A4 en **189 ms**, configuró `canalFirma: 'fisica_manuscrita'`, `documentoId: null` y `estadoDocumental: 'no_adjunto'`. |
| **Test 3** | **Idempotencia y Duplicados** |  **PASÓ** | Ante solicitud repetida, retornó inmediatamente `status: 'idempotent_duplicate'` y el `contratoId` existente sin consumir recursos de conversión. |
| **Test 4** | **Rechazo Datos Incompletos** |  **PASÓ** | Capturó error controlado: *"Los contratos a plazo fijo requieren obligatoriamente una fecha de término"*, abortando antes de tocar almacenamiento. |
| **Test 5** | **Control de Acceso por Roles** |  **PASÓ** | Rechazó solicitud de usuario con rol `worker` con código `permission-denied` y código HTTP 403. |

---

### 3. Estructura de los Payloads Canónicos Generados

El prototipo produce estructuras de datos listas para persistir en Firestore respetando exactamente las definiciones de la Fase 1C:

#### Payload para `Contratos/{contratoId}`:
```json
{
  "id": "cont_d0192915d74cd83c",
  "colaboradorId": "colab_101",
  "sucursalId": "1",
  "tipo": "Plazo Fijo",
  "estado": "pendiente_firma",
  "fechaInicio": "2026-11-01",
  "fechaTermino": "2026-12-31",
  "cargo": "Guardia de Seguridad OS-10",
  "jornada": "45 horas semanales",
  "sueldoBase": 550000,
  "gratificacion": 137500,
  "plantillaId": "tpl_sintetica_v2",
  "plantillaVersion": 2,
  "schemaVersion": 2,
  "estadoEmision": "emitido",
  "estadoDocumental": "pendiente_firma",
  "canalFirma": "digital_aspro",
  "documentoId": "doc_5efc0d70fea39840",
  "docxStoragePath": "contracts/cont_d0192915d74cd83c/contrato_rellenado.docx",
  "pdfStoragePath": "contracts/cont_d0192915d74cd83c/contrato_emitido.pdf",
  "pdfSha256": "eb87a11fb6199c87d46c4f82be81b838965027a0862089eb312cb6ecb1bfeb43",
  "creadoEn": "2026-10-21T03:12:48.115Z",
  "creadoPor": "admin_test_01",
  "metadataVariablesSnapshot": { "...": "Copia inmutable de datos sustituidos" }
}
```

#### Payload para `documents/{documentoId}` (Firma Digital):
```json
{
  "id": "doc_5efc0d70fea39840",
  "title": "Contrato de Trabajo — TRABAJADOR DE PRUEBA V2",
  "type": "Contrato",
  "assignedTo": "colab_101",
  "status": "pending",
  "originalUrl": "gs://contracts/cont_d0192915d74cd83c/contrato_emitido.pdf",
  "contratoId": "cont_d0192915d74cd83c",
  "createdAt": "2026-10-21T03:12:48.115Z",
  "signatureConfig": {
    "page": "last",
    "position": "center"
  }
}
```

---

### 4. Inventario de Archivos Creados en Fase 2

| Archivo | Tipo | Propósito |
| :--- | :--- | :--- |
| [`lab_contratos_v2/emitirContratoV2_proto.cjs`](file:///e:/proyectos%20AntiGravity/gesti%C3%B3n-ggss-security/lab_contratos_v2/emitirContratoV2_proto.cjs) | Creado | Prototipo funcional ejecutable de la Cloud Function `emitirContratoV2`. |
| [`lab_contratos_v2/test_runner_phase2.cjs`](file:///e:/proyectos%20AntiGravity/gesti%C3%B3n-ggss-security/lab_contratos_v2/test_runner_phase2.cjs) | Creado | Runner automatizado de validación con los 5 escenarios de prueba. |
| [`lab_contratos_v2/benchmark_results_phase2.json`](file:///e:/proyectos%20AntiGravity/gesti%C3%B3n-ggss-security/lab_contratos_v2/benchmark_results_phase2.json) | Creado | Registro de resultados de la suite en formato JSON. |
| [`lab_contratos_v2/proto_cont_d0192915d74cd83c.pdf`](file:///e:/proyectos%20AntiGravity/gesti%C3%B3n-ggss-security/lab_contratos_v2/proto_cont_d0192915d74cd83c.pdf) | Creado | PDF emitido en Test 1 (Canal Digital, 67.9 KB, 4 páginas). |
| [`lab_contratos_v2/proto_cont_9f4543aef40c5df6.pdf`](file:///e:/proyectos%20AntiGravity/gesti%C3%B3n-ggss-security/lab_contratos_v2/proto_cont_9f4543aef40c5df6.pdf) | Creado | PDF emitido en Test 2 (Canal Físico, 67.6 KB, 4 páginas). |
| [`lab_contratos_v2/INFORME_FASE_2.md`](file:///e:/proyectos%20AntiGravity/gesti%C3%B3n-ggss-security/lab_contratos_v2/INFORME_FASE_2.md) | Creado | Este informe de validación técnica de la Fase 2. |

---

### 5. Criterio de Cierre de la Fase 2

- El prototipo funciona de manera aislada y reproducible en laboratorio.
- No se han modificado archivos productivos (`functions/index.js`, `store/useAppStore.ts`, etc.).
- No se ha realizado deploy ni se han escrito datos en Firebase productivo.

El proceso queda **detenido**. Quedo a la espera de tu revisión de este prototipo y autorización para la siguiente fase.
