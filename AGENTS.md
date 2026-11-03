# Guía Operativa para Agentes de IA en ASPRO (GGSS Security)

> **Regla de Oro:** Este documento es el punto de partida obligatorio para cualquier sesión de desarrollo o asistencia técnica. Léelo antes de inspeccionar o modificar código en este repositorio.

---

## 1. Principios Mandatorios de Trabajo

1. **Leer Documentación Relevante Primero:**
   - Antes de iniciar cambios en el código, consulta la documentación técnica en `docs/` según el área de trabajo:
     - Visión global y diagramas: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)
     - Ubicación de componentes, páginas y servicios: [`docs/MODULES_INDEX.md`](docs/MODULES_INDEX.md)
     - Esquemas de Firestore e IndexedDB: [`docs/DATA_MODEL.md`](docs/DATA_MODEL.md)
     - Backend y endpoints serverless: [`docs/CLOUD_FUNCTIONS.md`](docs/CLOUD_FUNCTIONS.md)
     - Servicios de terceros (Gotenberg, Bunny.net, Gemini): [`docs/INTEGRATIONS.md`](docs/INTEGRATIONS.md)
     - Procesos clave (asistencia nocturna, contratos, OTA): [`docs/CRITICAL_FLOWS.md`](docs/CRITICAL_FLOWS.md)
     - Riesgos y optimizaciones pendientes: [`docs/PERFORMANCE_AND_RISKS.md`](docs/PERFORMANCE_AND_RISKS.md)
     - Registro de decisiones de arquitectura: [`docs/DECISIONS.md`](docs/DECISIONS.md)
     - Estado de las ramas y tareas actuales: [`docs/CURRENT_STATUS.md`](docs/CURRENT_STATUS.md)

2. **Revisar Existencias Antes de Crear:**
   - Consulta [`docs/MODULES_INDEX.md`](docs/MODULES_INDEX.md) para verificar si ya existe un hook, servicio o componente que resuelva la necesidad. No dupliques servicios de sincronización, formateadores de RUT ni modales de confirmación.

3. **Preservar Compatibilidad Hacia Atrás:**
   - Existen colecciones en Firestore y estructuras en IndexedDB con datos históricos en producción (`Asistencia`, `Colaboradores`, `Contratos`).
   - Si creas una nueva versión de un modelo (ej. V2), mantén adaptadores o capas de lectura dual ("shadow") para no romper clientes antiguos ni instalaciones móviles desactualizadas.

4. **Prohibición de Popups Nativos:**
   - Está estrictamente prohibido usar `window.confirm()`, `alert()` o `prompt()`. Utiliza siempre el sistema de confirmaciones integrado de la aplicación: `showConfirmation` desde `store/useAppStore.ts`.

5. **Regla de Marcaje Nocturno:**
   - Si un turno de guardia inicia durante la noche de un día y termina la mañana del día siguiente (ej. 19:30 a 07:30), todo el registro de asistencia debe indexarse bajo la fecha del día de inicio (`fechaTurno`).

6. **Despliegues y Producción:**
   - **Nunca** ejecutes despliegues (`firebase deploy`, `npm run publish:apk`, `npm run publish:ota`) sin instrucción y confirmación expresa del usuario.
   - **Nunca** modifiques datos directamente en la consola de Firebase ni elimines colecciones vivas.

7. **Preservar Cambios Locales y Secretos:**
   - Nunca ejecutes comandos destructivos de Git (`git reset --hard`, `git clean -fd`).
   - Protege los archivos de secretos y credenciales locales: `.env.local`, `serviceAccountKey.json`, `android/local.properties`, `functions/.env`.
   - Si introduces un cambio estructural en datos, rutas o flujos, actualiza el archivo correspondiente en `docs/`.

