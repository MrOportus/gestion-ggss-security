# ASPRO — CONTRATOS V2 — FASE 5.1
## Sueldo Base Configurable y Referencia Legal Centralizada

**Fecha de Ejecución:** 21 de Octubre de 2026  
**Rama Activa:** `feature/contratos-v2-dev` (aislada de `master`)  
**Entorno:** Local / Laboratorio Técnico Controlado  
**Estado de Despliegue:** 0 deploys ejecutados — 0 escrituras en Firestore/Storage productivo — Generador legado preservado  

---

### 1. Resumen Ejecutivo y Corrección de Alcance

En la **Fase 5.1**, se implementó la arquitectura para gestionar el **sueldo base contractual** y la **referencia centralizada del sueldo mínimo legal en Chile**, dando cumplimiento estricto a las restricciones normativas y técnicas:

1. **Corrección de Alcance Remuneracional Estricto:** Se eliminó cualquier cálculo de gratificación legal, cotizaciones previsionales, descuentos de salud, liquidaciones o inferencias automáticas basadas en `sueldoLiquido`. El contrato estipula únicamente el **Sueldo Base Contractual pactado**.
2. **Referencia Legal Centralizada y Desacoplada:** Se diseñó un servicio independiente (`sueldoMinimoLegalService`) que mantiene el registro histórico de vigencias del ingreso mínimo mensual (IMM) en Chile (conforme a la Ley N° 21.578 y normativas precedentes/futuras). Ningún valor legal está codificado de forma permanente en el modal ni en las Cloud Functions.
3. **Registro Dinámico sin Edición de Código:** El servicio admite el registro de nuevas vigencias normativas en tiempo de ejecución (mediante UI o API mock/local), ajustando cronológicamente las vigencias precedentes sin requerir despliegues ni cambios en el código fuente.
4. **Validación Preventiva sin Modificaciones Silenciosas ni Bloqueos Automáticos:** Se compara el sueldo base ingresado frente al mínimo legal aplicable según la fecha de inicio del contrato y la jornada pactada. Si es inferior en jornada ordinaria completa, se emite una advertencia visual destacada. Si la jornada es parcial o no cuantificada, el sistema declara la validación como **«pendiente»** y no inventa resultados.
5. **Inmutabilidad y Trazabilidad Histórica:** Cada contrato emitido almacena una copia inmutable del `sueldoBase` pactado y un snapshot íntegro de sustitución en `metadataVariablesSnapshot`. Ninguna modificación posterior a las normas legales ni a las plantillas altera documentos ya emitidos.

---

### 2. Archivos Modificados y Creados

| Archivo | Tipo de Cambio | Propósito y Responsabilidad |
|---|---|---|
| [`lib/contratos/sueldoMinimoLegalService.ts`](file:///e:/proyectos%20AntiGravity/gesti%C3%B3n-ggss-security/lib/contratos/sueldoMinimoLegalService.ts) | **NUEVO** | Servicio desacoplado de sueldo mínimo legal: vigencias históricas oficiales, registro dinámico en runtime, validación contextual por fecha/jornada y utilidades de formateo CLP. |
| [`lib/contratos/__tests__/sueldoMinimoLegalService.test.ts`](file:///e:/proyectos%20AntiGravity/gesti%C3%B3n-ggss-security/lib/contratos/__tests__/sueldoMinimoLegalService.test.ts) | **NUEVO** | Suite de 11 pruebas unitarias en Vitest que evalúan precarga, ausencia de datos, vigencias dinámicas, advertencias, jornadas parciales e inmutabilidad. |
| [`components/ContractEmissionModalV2.tsx`](file:///e:/proyectos%20AntiGravity/gesti%C3%B3n-ggss-security/components/ContractEmissionModalV2.tsx) | **MODIFICADO** | Modal de emisión V2: eliminación de gratificación/líquido, campo editable de `sueldoBase`, precarga segura solo desde contratos fiables previos, panel de estado legal (conforme, advertencia, pendiente) y resumen para emisión. |
| [`pages/HRContractsDashboard.tsx`](file:///e:/proyectos%20AntiGravity/gesti%C3%B3n-ggss-security/pages/HRContractsDashboard.tsx) | **MODIFICADO** | Inyección de la lista `contratos={contratos}` al modal `ContractEmissionModalV2` para permitir la búsqueda de antecedentes contractuales fiables. |
| [`functions/src/contratos/emitirContratoV2.js`](file:///e:/proyectos%20AntiGravity/gesti%C3%B3n-ggss-security/functions/src/contratos/emitirContratoV2.js) | **MODIFICADO** | Cloud Function: validación estricta de `sueldoBase > 0`, eliminación de gratificación, mapeo directo a variables `contrato.sueldo`, `contrato.sueldoBase` y `contrato.sueldoBaseFormatted`, y persistencia en Firestore/snapshot. |
| [`lab_contratos_v2/emitirContratoV2_proto.cjs`](file:///e:/proyectos%20AntiGravity/gesti%C3%B3n-ggss-security/lab_contratos_v2/emitirContratoV2_proto.cjs) | **MODIFICADO** | Sincronización del prototipo de backend de laboratorio con los cambios de `sueldoBase` y eliminación de gratificación. |
| [`lab_contratos_v2/ui/ContractEmissionModalV2.tsx`](file:///e:/proyectos%20AntiGravity/gesti%C3%B3n-ggss-security/lab_contratos_v2/ui/ContractEmissionModalV2.tsx) | **MODIFICADO** | Sincronización del componente de interfaz de usuario del laboratorio con la versión final de `components/`. |
| [`lab_contratos_v2/test_runner_phase4.cjs`](file:///e:/proyectos%20AntiGravity/gesti%C3%B3n-ggss-security/lab_contratos_v2/test_runner_phase4.cjs) | **MODIFICADO** | Actualización de la suite de 10 pruebas de integración para validar la obligatoriedad de `sueldoBase` y su verificación preventiva. |

---

### 3. Detalle de Implementación Técnica

#### 3.1. Modelo de Datos de la Referencia Legal (`VigenciaSueldoMinimo`)

```typescript
export interface VigenciaSueldoMinimo {
  id: string;
  montoCLP: number;
  vigenciaDesde: string;          // YYYY-MM-DD
  vigenciaHasta?: string | null;  // YYYY-MM-DD o null si está abierta
  fuenteLegal: string;           // ej. "Ley N° 21.578, D.O. 30/05/2023"
  registradoEn: string;          // ISO Timestamp
  registradoPor: string;          // UID / Email del auditor
  categoria: 'general_18_65' | 'menores_18_mayores_65' | 'fines_no_remuneracionales';
  notas?: string;
}
```

**Tabla Histórica Oficial Incorporada (Ley N° 21.578):**
- **01/07/2024 a la fecha:** $500.000 CLP (Vigencia plena actual).
- **01/09/2023 a 30/06/2024:** $460.000 CLP.
- **01/05/2023 a 31/08/2023:** $440.000 CLP.
- **01/01/2023 a 30/04/2023:** $410.000 CLP.

#### 3.2. Criterios de Precarga y Validación

1. **Precarga Responsable:**
   - Si se selecciona un trabajador que posee un contrato anterior en `Contratos` con `sueldoBase > 0`, dicho monto se precarga en el formulario.
   - Si no existe antecedente contractual fiable, el valor inicial es `$0` y el usuario debe digitarlo manualmente.
   - **Regla Estricta:** `Employee.sueldoLiquido` jamás se utiliza para calcular ni inferir el sueldo base.
2. **Validación Contextual:**
   - Para jornada ordinaria completa (45 o 44 horas semanales), si `sueldoBase < IMM_vigente`, el modal exhibe una alerta ámbar destacada advirtiendo el posible incumplimiento legal del Art. 44 del Código del Trabajo.
   - Para jornadas parciales (Part-Time) o turnos sin carga horaria semanal definida, el resultado es `validacion_pendiente` («Requiere revisión manual según horas pactadas»).
   - La validación es informativa: **no bloquea ni autoriza automáticamente** sin criterio humano de RR. HH.
3. **Mapeo en Plantillas Word (.docx):**
   - Variables sustituidas: `contrato.sueldo` (para compatibilidad con plantillas existentes), `contrato.sueldoBase` (numérico) y `contrato.sueldoBaseFormatted` (ej. `$550.000`).

---

### 4. Resultados de Pruebas Automatizadas

#### 4.1. Verificación Estricta de Tipos (TypeScript Compiler)
```bash
npx tsc --noEmit
Exit Code: 0 (Cero errores de compilación en toda la base de código)
```

#### 4.2. Pruebas Unitarias Vitest (`sueldoMinimoLegalService.test.ts`)
```bash
npx vitest run lib/contratos/__tests__/sueldoMinimoLegalService.test.ts

 ✓ lib/contratos/__tests__/sueldoMinimoLegalService.test.ts (11 tests) 45ms
   ✓ 1. Debe precargar el sueldo base desde un contrato previo fiable y nunca desde sueldoLiquido
   ✓ 2. En ausencia de contrato previo con sueldoBase, el valor inicial debe ser 0 para ingreso manual
   ✓ 3. Debe recuperar dinámicamente la referencia legal vigente según la fecha de inicio del contrato
   ✓ 4. Debe permitir registrar una nueva vigencia normativa en tiempo de ejecución sin alterar el código
   ✓ 5. Debe emitir advertencia expresa si el sueldo base pactado es inferior al mínimo para 45 horas
   ✓ 6. Debe calificar como conforme cuando el sueldo base es igual o superior al mínimo legal aplicable
   ✓ 7. Debe dejar la validación pendiente sin inventar resultados si la jornada es part-time
   ✓ 8. Debe dejar la validación pendiente si no se proporciona fecha de inicio del contrato
   ✓ 9. El registro de un nuevo mínimo legal no debe alterar contratos emitidos previamente (Inmutabilidad)
   ✓ 10. Confirma la ausencia de cálculos de gratificación, imposiciones o liquidaciones en el servicio
   ✓ 11. Formatea montos en pesos chilenos correctamente

 Test Files  1 passed (1)
      Tests  11 passed (11)
```

#### 4.3. Pruebas Unitarias de Cloud Function (`emitirContratoV2.unit.test.js`)
```bash
npx vitest run functions/src/contratos/__tests__/emitirContratoV2.unit.test.js

 ✓ functions/src/contratos/__tests__/emitirContratoV2.unit.test.js (3 tests) 8ms
   ✓ 1. Debe rechazar llamadas no autenticadas con error "unauthenticated"
   ✓ 2. Debe rechazar llamadas si falta el campo obligatorio colaboradorId
   ✓ 3. La Cloud Function debe estar exportada correctamente como Callable Function v2

 Test Files  1 passed (1)
      Tests  3 passed (3)
```

#### 4.4. Suite de Integración y Regresión de Laboratorio (`test_runner_phase4.cjs`)
```bash
node lab_contratos_v2/test_runner_phase4.cjs

================================================================
 RESUMEN FASE 4: 10/10 PRUEBAS EXITOSAS (2346 ms)
================================================================
 [OK] 1. Control de Roles (IAM) — admin y rrhh autorizados; supervisor, worker y anónimos bloqueados con 403/401.
 [OK] 2. Modalidades Plazo Fijo e Indefinido — Plazo Fijo exige fechaTermino y valida cronología; Indefinido procesado exitosamente con sueldoBase.
 [OK] 3. Datos Obligatorios Ausentes — Rechazo preventivo con 400 ante ausencia de colaboradorId, fechaInicio o sueldoBase.
 [OK] 4. Idempotencia y Prevención de Duplicados — Reintento retornó contrato existente #cont_02480633b7f2dbab sin reconvertir.
 [OK] 5. Fallo de Servicio Gotenberg (503/Timeout) — Error 503 capturado limpiamente; cero escrituras residuales en base de datos.
 [OK] 6. Compensación Reactiva en Storage — Fallo de Firestore disparó eliminación inmediata del archivo PDF huérfano en Storage.
 [OK] 7. Atomicidad en Asociación Documental — Transacción abortada: no se genera contrato desvinculado si falla la creación del documento digital.
 [OK] 8. Canal Físico y Posterior Adjunto — Emisión sin documentoId en estado no_adjunto; posterior adjunto de escaneado transiciona a vigente con SHA-256.
 [OK] 9. Preservación del Historial (Renovaciones) — Enlace bidireccional (#cont_5ddb69b88bbccdfd -> #cont_4a4735327e5702e5) con numeroRenovacion=2 sin sobreescritura.
 [OK] 10. Compatibilidad de Esquemas TypeScript — Contrato cumple types/phase1.ts (schemaVersion: 2) y DigitalDocument cumple types.ts con URL HTTPS válida.
```

#### 4.5. Validación de Interfaces y Adaptadores (`test_runner_phase3.cjs` y `test_runner_phase2.cjs`)
- `test_runner_phase3.cjs`: 4/4 pruebas pasadas al 100% (incluyendo compilación estricta de `ContractEmissionModalV2.tsx` y `labEmissionAdapter.ts`).
- `test_runner_phase2.cjs`: 5/5 pruebas pasadas al 100% (emisión digital, emisión física, idempotencia, campos obligatorios y control RBAC).

---

### 5. Respeto a las Restricciones No Negociables

- [x] **Exclusividad de rama:** Se trabajó únicamente en `feature/contratos-v2-dev`. La rama `master` no fue alterada.
- [x] **Cero despliegue:** No se ejecutó `firebase deploy`, ni despliegue de Gotenberg en Google Cloud Run.
- [x] **Cero escritura en Firebase productivo:** Todas las ejecuciones de prueba operaron con mocks aislados y Gotenberg local en Docker.
- [x] **Sin alteración del generador legado:** Google Apps Script y `generarContrato` se mantienen intactos.
- [x] **Sin cálculos remuneracionales no solicitados:** Se purgaron gratificaciones, imponibles, cotizaciones y descuentos de leyes sociales.
- [x] **Sin modificaciones automáticas a contratos históricos:** Los contratos existentes no sufrieron mutaciones ni migraciones masivas.
- [x] **Sin invención de valores legales:** Se adoptó la escala oficial de la Ley N° 21.578 y se mantuvo la opción de vigencias pendientes para jornadas especiales.

---

### 6. Procedimiento de Reversión (Rollback)

En caso de requerir revertir los cambios de la Fase 5.1:
1. Para revertir los archivos en la rama de desarrollo:
   ```bash
   git restore pages/HRContractsDashboard.tsx functions/src/contratos/emitirContratoV2.js lab_contratos_v2/
   rm -rf lib/contratos/
   ```
2. Al no haber deploy en Firebase ni escrituras en Firestore productivo, la base de datos de producción y los usuarios permanecen 100% inalterados.
