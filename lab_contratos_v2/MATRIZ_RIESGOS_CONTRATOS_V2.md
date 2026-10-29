# ASPRO — CONTRATOS V2 — FASE 1C
## Matriz de Riesgos Técnicos, Seguridad y Privacidad

**Fecha:** 21 de Octubre de 2026  
**Fase:** 1C (Análisis, Diseño y Documentación)  
**Ubicación:** `lab_contratos_v2/MATRIZ_RIESGOS_CONTRATOS_V2.md`  
**Estado:** PROPUESTA TÉCNICA AISLADA (Sin cambios en producción)

---

### 1. Matriz General de Riesgos Técnicos y Mitigaciones

| ID | Riesgo Identificado | Probabilidad | Impacto | Nivel | Estrategia de Mitigación | Prueba de Validación Requerida |
| :--- | :--- | :---: | :---: | :---: | :--- | :--- |
| **R1** | **Diferencias de métricas tipográficas en Linux (Carlito vs Calibri)** que provoquen saltos de página no deseados o deformación de líneas de firma. | Media | Alto | **Medio** | Diseñar las cajas de firma en la plantilla DOCX utilizando bordes de tabla (`borderTop`) o tabulaciones de ancho fijo en lugar de caracteres continuos `____`. | Prueba visual comparativa en laboratorio con contratos de 3, 4 y 5 páginas. *(Validado con éxito en Fase 1B)*. |
| **R2** | **Arranque en frío (Cold Start) de Cloud Run** que supere el timeout de la Cloud Function en la primera emisión del día. | Media | Medio | **Medio** | Configurar `min-instances: 0` para costo cero, pero con timeout de 60s en la Cloud Function y 1 instancia mínima opcional durante horario laboral si el negocio lo aprueba. Gotenberg arranca en <3s en Cloud Run. | Simular invocación con contenedor detenido y medir tiempo hasta el primer byte. |
| **R3** | **Fallo de red entre Storage y Firestore** que deje archivos PDF huérfanos o registros sin PDF adjunto. | Baja | Alto | **Medio** | Implementar protocolo de compensación: si la escritura en Firestore falla tras subir a Storage, la Cloud Function borra reactivamente el archivo subido y retorna error controlado al cliente. | Prueba con mock de fallo de red en Firestore tras subida a Storage. |
| **R4** | **Exposición de datos sensibles (RUT, remuneraciones, domicilios) en los logs de Cloud Run o Cloud Functions**. | Media | Crítico | **Alto** | Sanitizar y ofuscar todo payload en los `console.log` y Cloud Logging. Registrar únicamente IDs opacos (`contratoId`, `colaboradorId`, `duracionMs`, `pdfSha256`), nunca campos de texto plano. | Auditoría de expresiones regulares en Cloud Logging buscando patrones de RUT y montos monetarios. |
| **R5** | **Modificación o actualización de una plantilla que altere contratos emitidos en el pasado**. | Alta | Crítico | **Alto** | Inmutabilidad estricta de plantillas: cada cambio genera una nueva versión (`version + 1`). Los contratos emitidos guardan `plantillaVersion` y `metadataVariablesSnapshot` congelados. | Modificar una plantilla en pruebas y verificar que el contrato previamente emitido no altere su contenido ni hash. |
| **R6** | **Emisión accidental duplicada de contratos por doble clic o reintento de red**. | Media | Medio | **Bajo** | Clave de idempotencia en Cloud Functions basada en `hash(colaboradorId + plantillaId + fechaInicio + fechaTermino)` y reutilización de `isDuplicateContract` existente. | Envío de 5 peticiones simultáneas idénticas y validación de que solo 1 se procesa. |
| **R7** | **Incompatibilidad de firmas: colaboradores que no pueden o rechazan firmar digitalmente**. | Alta | Medio | **Medio** | Flujo de firma dual: se habilita la opción de firma física tradicional con descarga del PDF, firma manuscrita y posterior subida del escaneo verificado. | Prueba de extremo a extremo del flujo `fisica_manuscrita` con PDF escaneado. |

---

### 2. Protocolo de Seguridad y Privacidad de Datos

#### 2.1 Validación de Permisos y Control de Acceso
1. **Control de Acceso en Cloud Functions:**
   - La Cloud Function `emitirContratoV2` solo podrá ser invocada por usuarios autenticados con rol verificado `admin` o `rrhh` (validado mediante `decodedToken.role` en el backend, no confiando en el cliente).
   - Los guardias y supervisores no tienen permisos para invocar la emisión de contratos.
2. **Autenticación Service-to-Service (IAM):**
   - El microservicio de Gotenberg en Cloud Run se desplegará con el modificador `--no-allow-unauthenticated`.
   - La Cloud Function obtiene automáticamente un ID Token OIDC mediante la librería oficial `google-auth-library`:
     ```javascript
     const auth = new GoogleAuth();
     const client = await auth.getIdTokenClient(CLOUD_RUN_GOTENBERG_URL);
     const res = await client.request({
       url: `${CLOUD_RUN_GOTENBERG_URL}/forms/libreoffice/convert`,
       method: 'POST',
       data: formData,
       headers: formData.getHeaders(),
       responseType: 'arraybuffer'
     });
     ```
   - No se almacenan claves API, contraseñas ni secrets en texto plano ni en variables de entorno.

#### 2.2 Protección de Datos Personales (Ley N° 19.628 / GDPR)
1. **Zero Persistence en el Microservicio de Conversión:**
   - Gotenberg procesa los archivos en memoria (`/tmp` montado en tmpfs RAM).
   - Una vez finalizada la respuesta HTTP, LibreOffice y Gotenberg limpian los descriptores de archivo y eliminan todo residuo. No hay base de datos ni volumen persistente acoplado al contenedor de conversión.
2. **Ofuscación Estricta en Logs de Monitoreo:**
   - **Prohibido en logs:** Nombres de colaboradores, números de RUT, sueldos pactados, direcciones residenciales y teléfonos.
   - **Permitido en logs:**
     ```json
     {
       "event": "contract_issued",
       "contratoId": "cont_8f29d1a",
       "colaboradorId": "usr_991823",
       "plantillaId": "tpl_ggss_plazo_fijo",
       "plantillaVersion": 2,
       "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
       "duracionMs": 782,
       "status": "success"
     }
     ```

#### 2.3 Control de Acceso a Archivos en Firebase Storage
1. **Rutas Seguras:**
   - Contratos emitidos: `contracts/{contratoId}/emitido.pdf`
   - Documentos de firma digital: `signed_docs/signed_{documentoId}.pdf`
2. **Reglas de Storage:**
   - Los archivos de `contracts/` solo son legibles por administradores, personal de RR. HH. y el colaborador titular (`resource.metadata.colaboradorId == request.auth.uid`).
   - Se prohíbe la sobreescritura (`allow write: if false` una vez creado) para garantizar la inmutabilidad de la prueba documental.

---

### 3. Matriz de Auditoría y Trazabilidad

Para dar cumplimiento a inspecciones de la Dirección del Trabajo (DT) y auditorías corporativas:

| Evento del Ciclo de Vida | Evidencia Registrada | Servicio / Colección | Actor Responsable |
| :--- | :--- | :--- | :--- |
| **Emisión del Contrato** | Fecha/hora ISO, UID del emisor, `plantillaVersion`, hash SHA-256 del PDF emitido, snapshot de variables. | `Contratos/{id}` | Admin / RR. HH. |
| **Descarga de PDF para Firma Física** | Timestamp de descarga, UID de quien descargó, canal marcado como `fisica_manuscrita`. | Subcolección `Contratos/{id}/auditoria/` | Admin / RR. HH. |
| **Firma Digital por el Guardia** | IP, User-Agent, fecha/hora exacta, trazado de firma, hash SHA-256 del firmado, `validationId`. | `documents/{docId}` + `validacionesDocumentos/` | Colaborador (Guardia) |
| **Carga de Escaneado Físico** | Timestamp de carga, UID del administrador que cargó, hash SHA-256 del escaneado. | `Contratos/{id}` | Admin / RR. HH. |
| **Renovación Contractual** | Enlace bidireccional (`contratoAnteriorId` y `contratoSiguienteId`), número de renovación incremental. | `Contratos/{id}` | Admin / RR. HH. |

---

### 4. Clasificación Metodológica de Decisiones

| Decisión de Seguridad y Riesgo | Hecho Verificado | Propuesta Arquitectónica | Supuesto por Validar |
| :--- | :---: | :---: | :---: |
| Autenticación Cloud Run privada con Identity Token OIDC |  Soportado de forma nativa por GCP |  Protege Gotenberg de accesos no autorizados | — |
| Sanitización de logs (RUT y Sueldos) | — |  Política de cero PII en Cloud Logging |  Revisión con equipo de auditoría ASPRO |
| Regla de inmutabilidad en Storage para contratos |  Reglas existentes en `firestore.rules` |  Extender política estricta a `storage.rules` |  Aprobación de storage.rules en Fase 2 |
| Trazabilidad de renovaciones con enlace doble |  Verificado en `contratosService.ts:134` |  Preservar modelo de enlace atómico | — |
