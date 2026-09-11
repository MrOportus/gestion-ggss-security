/**
 * OfflineCache — Cache local persistente para datos de Vista Guardia.
 * 
 * Usa localforage (IndexedDB) para almacenar datos que permiten
 * al guardia operar sin conectividad:
 *   - Turno programado del día
 *   - Datos básicos del employee
 * 
 * Se actualiza cada vez que una consulta online tiene éxito.
 * Se lee como fallback cuando la consulta online falla/timeout.
 */

import localforage from 'localforage';

const offlineCache = localforage.createInstance({
    name: 'GGSS_Offline_DB',
    storeName: 'offline_cache'
});

export interface CachedShiftData {
    employeeId: string;
    date: string; // YYYY-MM-DD
    siteId: string | number;
    status: string; // 'programado' | 'noche' | 'descanso' etc.
    shiftDocData: any; // Raw data from programacion collection
    cachedAt: string; // ISO timestamp
}

export interface CachedEmployeeData {
    id: string;
    firstName: string;
    lastNamePaterno: string;
    rut: string;
    currentSiteId?: string | number;
    cachedAt: string;
}

const SHIFT_CACHE_KEY = (employeeId: string, date: string) => `shift_${employeeId}_${date}`;
const EMPLOYEE_CACHE_KEY = (employeeId: string) => `employee_${employeeId}`;

export const OfflineCache = {
    // ── Turno Programado ──────────────────────────────────────────────

    async cacheShift(data: CachedShiftData): Promise<void> {
        const key = SHIFT_CACHE_KEY(data.employeeId, data.date);
        await offlineCache.setItem(key, { ...data, cachedAt: new Date().toISOString() });
        console.log(`[OfflineCache] Turno cacheado: ${key}`);
    },

    async getCachedShift(employeeId: string, date: string): Promise<CachedShiftData | null> {
        const key = SHIFT_CACHE_KEY(employeeId, date);
        const cached = await offlineCache.getItem<CachedShiftData>(key);
        if (cached) {
            console.log(`[OfflineCache] Turno encontrado en cache: ${key}`);
        }
        return cached;
    },

    // ── Employee Data ────────────────────────────────────────────────

    async cacheEmployee(data: CachedEmployeeData): Promise<void> {
        const key = EMPLOYEE_CACHE_KEY(data.id);
        await offlineCache.setItem(key, { ...data, cachedAt: new Date().toISOString() });
    },

    async getCachedEmployee(employeeId: string): Promise<CachedEmployeeData | null> {
        const key = EMPLOYEE_CACHE_KEY(employeeId);
        return offlineCache.getItem<CachedEmployeeData>(key);
    },

    // ── Limpieza de cache antiguo ────────────────────────────────────

    /** Elimina entradas de turnos que sean de fechas anteriores a hoy - 3 días */
    async cleanOldShifts(): Promise<void> {
        const threeDaysAgo = new Date();
        threeDaysAgo.setDate(threeDaysAgo.getDate() - 3);
        
        const keysToRemove: string[] = [];
        await offlineCache.iterate((value: any, key: string) => {
            if (key.startsWith('shift_') && value?.cachedAt) {
                const cachedDate = new Date(value.cachedAt);
                if (cachedDate < threeDaysAgo) {
                    keysToRemove.push(key);
                }
            }
        });
        
        for (const key of keysToRemove) {
            await offlineCache.removeItem(key);
        }
        
        if (keysToRemove.length > 0) {
            console.log(`[OfflineCache] Limpiados ${keysToRemove.length} turnos antiguos.`);
        }
    }
};
