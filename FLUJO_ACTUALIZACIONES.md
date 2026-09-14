# Flujo de Actualizaciones de la Aplicación

Este documento define el flujo estándar para realizar actualizaciones en Gestión GGSS Security dependiendo del tipo de cambios realizados.

Existen dos tipos de actualizaciones principales:
1. **Actualizaciones Nativas (APK):** Requieren reinstalar la aplicación.
2. **Actualizaciones por Aire (OTA):** Se actualizan solas al abrir la app.

---

## ⚡ Flujo 1: Actualización Rápida (OTA / Web)
**Cuándo usar:** Para cambios en lógica de negocio (TypeScript), interfaces de usuario (React/CSS), solución de bugs visuales o peticiones a APIs. *Básicamente, todo lo que no involucre tocar carpetas de Android/iOS o instalar plugins nativos.*

**El flujo correcto paso a paso:**
1. **Desarrollo:** Realizas tus cambios y pruebas localmente (`npm run dev`).
2. **Control de versiones:** Guardas tus cambios en Git.
   ```bash
   git add .
   git commit -m "feat: nuevo color en botones de ronda"
   git push
   ```
3. **Despliegue de Panel Web (Admin):** Si tu aplicación tiene versión web para administradores, realizas el deploy a tu hosting web (Firebase Hosting, Vercel, etc).
   ```bash
   npm run deploy # O el comando que utilices para tu web
   ```
4. **Despliegue a los Teléfonos (OTA):** Envías silenciosamente el código JS/HTML actualizado a los teléfonos que ya tienen la app instalada.
   ```bash
   npm run publish:ota 5.0.7 "Color de botones arreglado"
   ```

✅ **Resultado:** La próxima vez que los guardias abran la app, verán un aviso para "Aplicar Actualización" y en 3 segundos tendrán tu nuevo código sin tener que descargar nada de la PlayStore ni instalar un APK manualmente.

---

## 📱 Flujo 2: Actualización Nativa (APK Completo)
**Cuándo usar:** Cuando instales o actualices paquetes de npm que modifiquen cosas de Capacitor (ej. `@capacitor/camera`, notificaciones push, permisos de GPS nativos, ajustes en `AndroidManifest.xml` o `capacitor.config.ts`).

**El flujo correcto paso a paso:**
1. **Desarrollo:** Realizas tus cambios y pruebas localmente (idealmente corriendo en un emulador o dispositivo Android conectado).
2. **Control de versiones:** 
   ```bash
   git add .
   git commit -m "feat: añadido plugin de lector de código de barras"
   git push
   ```
3. **Despliegue a los Teléfonos (APK):** Generas un nuevo ejecutable completo de Android. Este proceso toma más tiempo porque compila Java/Kotlin.
   ```bash
   npm run publish:apk 6.0.0 "Soporte nativo para códigos de barra"
   ```

✅ **Resultado:** La aplicación detectará que existe un **nuevo APK obligatorio**. Obligará al usuario a descargar el archivo `.apk` a su teléfono e instalarlo manualmente por encima de la versión anterior.

---

## Resumen Regla de Oro
- Cambios en `src/`, `components/`, `pages/`, `lib/`, `store/` ➔ **`npm run publish:ota <version> "<notas>"`**
- Cambios en `android/`, `capacitor.config.ts` o instalación de nuevos plugins `@capacitor/*` ➔ **`npm run publish:apk <version> "<notas>"`**
