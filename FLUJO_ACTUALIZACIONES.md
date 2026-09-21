# 🚀 Flujo de Actualizaciones y Despliegue

Este documento es la **Guía Oficial** para cualquier desarrollador, manager o encargado del proyecto. Define exactamente qué comandos ejecutar para publicar cambios sin romper el sistema de versiones ni la app de los guardias.

Existen **dos tipos** de actualizaciones:
1. **Actualizaciones por Aire (OTA / Web):** Para el 95% de los casos (cambios en UI, lógica, bugs).
2. **Actualizaciones Nativas (APK):** Solo cuando instalas nuevos plugins de Capacitor o tocas código Java/Android.

---

## ⚡ 1. Flujo Rápido (OTA + Web) — El más común

**Cuándo usar:** Hiciste cambios en `pages/`, `components/`, `store/`, `lib/`, etc. Básicamente cualquier cambio en React/TypeScript/CSS.

### Paso a paso:

**1. Sube tu código a GitHub**
```bash
git add .
git commit -m "fix: tu mensaje aquí"
git push
```

**2. Despliega el Panel Web Admin (Firebase Hosting)**
*(Esto actualiza la página web para los administradores)*
```bash
npm run build
firebase deploy --only hosting
```

**3. Despliega la App de los Guardias (OTA)**
*(Esto envía silenciosamente la actualización a los celulares)*
```bash
# Opción A: Automático (Incrementa el último número de versión solo)
npm run publish:ota

# Opción B: Manual con mensaje (Recomendado)
npm run publish:ota 6.1.0 "Se agregó un nuevo módulo de reportes"
```

✅ **Resultado:**
- El panel web estará actualizado inmediatamente.
- El script `publish-ota` leerá el archivo `VERSION`, validará que todo esté en orden, subirá el ZIP a Firebase Storage y los guardias recibirán la nueva versión al abrir su app.

---

## 📱 2. Flujo Nativo (APK Completo) — Rara vez

**Cuándo usar:** Añadiste un plugin nuevo (`npm install @capacitor/camera`), cambiaste permisos de GPS, editaste `capacitor.config.ts` o tocaste la carpeta `android/`.

### Paso a paso:

**1. Sube tu código a GitHub**
```bash
git add .
git commit -m "feat: integración de cámara nativa"
git push
```

**2. Despliega el Panel Web Admin (Firebase Hosting)**
```bash
npm run build
firebase deploy --only hosting
```

**3. Genera y publica el nuevo APK**
```bash
npm run publish:apk 7.0.0 "Soporte para cámara nativa"
```

✅ **Resultado:** La aplicación bloqueará la pantalla del guardia y le exigirá descargar e instalar el nuevo archivo `.apk`.

---

## 💡 Reglas de Oro y Notas Importantes

1. **NO edites manualmente el archivo `VERSION` ni el `package.json`**:
   El script `npm run publish:ota` actualiza estos archivos automáticamente si el despliegue es exitoso.

2. **Loop de Actualizaciones (Error común)**:
   Nunca intentes publicar por OTA una versión **menor o igual** a la que ya está en producción. Si haces esto, los celulares entrarán en un loop infinito tratando de actualizarse. El nuevo script `publish-ota` ya tiene un candado de seguridad para evitar este error humano.

3. **Deploy Web != Deploy OTA**:
   Hacer `firebase deploy --only hosting` NO actualiza la app de los celulares. Hacer `npm run publish:ota` NO actualiza el panel web admin. **Siempre debes hacer ambos** si tus cambios afectan a ambas partes.
