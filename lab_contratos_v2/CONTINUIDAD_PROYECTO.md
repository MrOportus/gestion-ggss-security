# ASPRO — CONTRATOS V2 | REGISTRO DE CONTINUIDAD Y PAUSA SEGURA

**Fecha y hora de registro:** 21 de octubre de 2026, 02:00 hrs (hora local)  
**Rama activa de Git:** `feature/contratos-v2-dev`  
**Rama principal (`master`):** Intacta, sin cambios, sin merges ni modificaciones.  
**Estado de despliegue:** Cero deploys. No se ha ejecutado deploy a Firebase Hosting, Cloud Functions, Cloud Run ni Google Cloud.

---

## 1. Estado Actual de Git y Archivos

### 1.1. Rama Activa
- **Rama:** `feature/contratos-v2-dev`
- **Condición:** No se ha cambiado de rama, no se ha hecho `git reset`, `git clean` ni `git checkout` destructivo. No se han realizado commits automáticos.

### 1.2. Cambios no Confirmados (Unstaged Changes)
```
modified:   functions/index.js
modified:   functions/package-lock.json
modified:   functions/package.json
modified:   package-lock.json
modified:   package.json
modified:   pages/HRContractsDashboard.tsx
modified:   types/phase1.ts
modified:   vite.config.ts
```

### 1.3. Archivos Nuevos Sin Seguimiento (Untracked Files)
```
components/ContractEmissionModalV2.tsx
components/contratos/
  ├── ContractTemplatesManager.tsx
  └── ContractEmissionsHistory.tsx
functions/src/contratos/
lab_contratos_v2/
  ├── CONTINUIDAD_PROYECTO.md (este archivo)
  ├── INFORME_FASE_5_2.md
  ├── plantilla_sintetica_contrato.docx
  ├── contrato_rellenado_phase5_2.docx
  ├── contrato_generado_phase5_2.pdf
  └── test_runner_phase5_2.cjs
lib/contratos/
  ├── localContractTemplateService.ts
  ├── localContractEmissionsService.ts
  ├── sueldoMinimoLegalService.ts
  └── __tests__/
        ├── localContractTemplateService.test.ts
        └── sueldoMinimoLegalService.test.ts
public/plantillas/
  └── plantilla_sintetica_contrato.docx
```

---

## 2. Última Fase Completada: Fase 5.2

### 2.1. Objetivos Alcanzados en Fase 5.2
1. **Administrador de Plantillas DOCX (`ContractTemplatesManager.tsx`):**
   - Carga de archivos `.docx` propios mediante arrastrar y soltar (*drag-and-drop*) o explorador.
   - Inspección inmediata de variables `{{...}}` y clasificación frente al esquema canónico de ASPRO.
   - Duplicación con incremento de versión (`v+1`) y activación/desactivación.
   - Descarga de la plantilla DOCX original almacenada.
2. **Detección de Variables con Reconstrucción de Fragmentación XML:**
   - Algoritmo en `localContractTemplateService.ts` que une todos los nodos `<w:t>` dentro de cada párrafo `<w:p>`, resolviendo la división de etiquetas que hace Word (ej. `{{trab` + `ajador.nombre}}`).
   - Bloqueo estricto de emisión si falta alguna variable obligatoria (ej: `trabajador.rut`, `contrato.sueldoBase`), explicando el motivo sin emitir documentos vacíos.
3. **Persistencia Local en IndexedDB (`localforage`):**
   - Almacenes `plantillas_metadata`, `plantillas_binarios`, `emisiones_metadata` y `emisiones_binarios` en la base local `aspro_contratos_v2`.
   - Sin uso de `localStorage` para binarios pesados.
   - Las URLs Blob temporales se revocan tras su uso mediante `URL.revokeObjectURL`.
4. **Conversor Real Gotenberg v8 (`http://localhost:3005`):**
   - Conectado a través del proxy de Vite en `/api/gotenberg/forms/libreoffice/convert`.
   - Verificación de cabecera `%PDF-` y tamaño mayor a 500 bytes.
   - Cálculo criptográfico del hash **SHA-256** sobre los bytes reales del PDF persistido.
   - Si Gotenberg está apagado o falla, la emisión se detiene con error explícito; no se simulan emisiones falsas.
5. **Historial de Emisiones Locales (`ContractEmissionsHistory.tsx`):**
   - Persiste al cerrar y reabrir el navegador.
   - Permite descargar tanto el DOCX rellenado como el PDF real generado.
6. **Integración en `HRContractsDashboard.tsx`:**
   - 4 pestañas: Directorio de Colaboradores, Gestión de Vacaciones, Plantillas Word V2 e Historial Emisiones Locales.

### 2.2. Pruebas Técnicas Ejecutadas y Aprobadas
| Prueba | Comando | Resultado |
|---|---|---|
| **TypeScript Typecheck** | `npx tsc --noEmit` | **0 errores** |
| **Pruebas Unitarias** | `npx vitest run lib/contratos/__tests__/` | **19/19 aprobadas (100%)** |
| **Test Runner Fase 5.2** | `node lab_contratos_v2/test_runner_phase5_2.cjs` | **8/8 aprobadas (100%)** |
| **Compilación de Producción** | `npm run build` | **Exitosa (17.39s)** |

---

## 3. Estado de Servicios y Procesos Locales Comprobados

| Servicio / Proceso | Puerto / Dirección | Estado al Pausar | Método de Verificación |
|---|---|---|---|
| **Contenedor Docker Gotenberg v8** | `http://localhost:3005` | **ACTIVO** | `docker ps --filter "name=gotenberg_lab"` -> Up (contenedor `ab3e45d9697a`). Salud verificada en `/health`. |
| **Servidor de Desarrollo Vite** | `http://localhost:3000` | **ACTIVO** | `Invoke-WebRequest -Uri "http://localhost:3000"` -> HTTP 200 OK. |
| **Proxy Gotenberg Vite** | `http://localhost:3000/api/gotenberg/health` | **ACTIVO** | Proxy redirige transparentemente a `http://localhost:3005/health` -> Status `"up"`. |
| **Firebase Cloud Functions / Cloud Run** | Producción | **INACTIVO / SIN TOCAR** | Ningún deploy realizado. |

---

## 4. Instrucciones para Iniciar los Servicios Mañana

Al retomar la sesión de trabajo, seguir estos pasos:

### Paso 1: Verificar e Iniciar Docker y Gotenberg
Comprobar si el contenedor está corriendo:
```bash
docker ps --filter "name=gotenberg_lab"
```
Si el contenedor está detenido, iniciarlo con:
```bash
docker start gotenberg_lab
```
*(Si el contenedor fue eliminado o no existe, crearlo con: `docker run -d --name gotenberg_lab -p 3005:3000 gotenberg/gotenberg:8`)*

Verificar que responde:
```bash
curl http://localhost:3005/health
```
*(Debe retornar `{"status":"up","details":{"libreoffice":{"status":"up"}}}`)*

### Paso 2: Iniciar la Aplicación ASPRO
Desde la raíz del proyecto (`e:\proyectos AntiGravity\gestión-ggss-security`):
```bash
npm run dev
```
Abrir en el navegador:
`http://localhost:3000`

---

## 5. Errores Conocidos y Limitaciones

1. **Docker obligatorio para conversión:** Si Docker Desktop o el contenedor `gotenberg_lab` están apagados, el modal de emisión detendrá el proceso mostrando el error de conexión. Esto es intencional para evitar generar PDFs falsos o simulados.
2. **Persistencia local por navegador:** Las plantillas cargadas y las emisiones registradas residen en el IndexedDB (`aspro_contratos_v2`) del navegador utilizado. Si se usa una ventana de incógnito o un navegador distinto, se deberá cargar la plantilla nuevamente.
3. **Plantillas sintéticas de laboratorio:** `plantilla_sintetica_contrato.docx` es un ejemplo técnico de prueba y **no debe utilizarse como contrato oficial**.

---

## 6. Alcance Funcional Confirmado para Contratos V2

- Cargar y organizar plantillas Word (`.docx`) aportadas por RR. HH.
- Mapear y autocompletar variables usando la información real del trabajador en ASPRO.
- Permitir ingresar manualmente valores contractuales faltantes (fechas, turnos, sucursal).
- Conservar el sueldo base pactado de forma inmutable, sin inferirlo desde el sueldo líquido.
- **No incorporar cálculos de liquidaciones, gratificaciones, imponibles, cotizaciones ni descuentos.**
- Conservar historial persistente local con descarga bajo demanda de DOCX y PDF real.
- Mantener estrictamente aisladas las pruebas de laboratorio respecto de las colecciones `Contratos` y `documents` de producción.

---

## 7. Punto Exacto para Retomar Mañana

**Tarea prioritaria:** Prueba funcional integral con una **plantilla Word contractual propia de RR. HH.**:

1. Iniciar Gotenberg (`docker start gotenberg_lab`) y la app (`npm run dev`).
2. Ir a `http://localhost:3000` -> Módulo **RR. HH. y Contratos** -> Pestaña **"Plantillas Word V2"**.
3. Cargar un archivo `.docx` real anonimizado de contrato de seguridad.
4. Inspeccionar la lista de variables detectadas por el sistema.
5. Verificar si hay variables no reconocidas o faltantes frente a `DICCIONARIO_VARIABLES_ASPRO`.
6. Emitir un contrato de prueba seleccionando un colaborador en el modal V2.
7. Comprobar la generación del DOCX rellenado y del PDF real en Gotenberg.
8. Comparar visualmente el PDF generado contra el documento Word original (márgenes, cláusulas, tablas, encabezados, saltos de página y firmas).
9. Cerrar y reabrir el navegador, dirigirse a la pestaña **"Historial Emisiones Locales"** y verificar que los archivos persisten y se pueden descargar.
10. Registrar cualquier observación o discrepancia antes de modificar código.
