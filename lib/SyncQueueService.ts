import localforage from 'localforage';

export interface QueueItem {
    id: string;
    operationId: string; // UUID idempotente — se usa como ID del documento en Firebase para evitar duplicados
    userId: string;      // Firebase UID del usuario que creó la operación
    actionType: 'ADD_ROUND' | 'UPDATE_ROUND' | 'UPLOAD_EVIDENCE' | 'ADD_NOVEDAD' | 'UPLOAD_NOVEDAD_PHOTO' | 'CHECK_IN' | 'CHECK_OUT' | 'ADD_VISITA_SUPERVISOR' | 'UPLOAD_VISITA_PHOTO';
    payload: any;
    status: 'PENDING' | 'SYNCING' | 'SYNCED' | 'ERROR';
    timestamp: string;
    retryCount: number;
    lastError?: string;
    lastAttemptAt?: string;
    syncedAt?: string;
}

const MAX_RETRIES = 10;

const syncQueue = localforage.createInstance({
    name: 'GGSS_Offline_DB',
    storeName: 'sync_queue'
});

// IDs en transmisión activa para impedir coalescing/mutación concurrente mientras processSyncQueue sube el ítem
const inFlightIds = new Set<string>();

/** Genera un operationId único y determinista */
function generateOperationId(): string {
    return `op_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

export const SyncQueueService = {
    /**
     * Indica si el driver activo de IndexedDB/localforage soporta almacenamiento binario de Blobs
     * (evita inflar payloads un +33% convirtiendo Blobs a Base64).
     */
    supportsBlobPayloads(): boolean {
        try {
            const driver = typeof syncQueue.driver === 'function' ? syncQueue.driver() : null;
            if (driver === localforage.LOCALSTORAGE) return false;
            return typeof Blob !== 'undefined' && typeof indexedDB !== 'undefined';
        } catch {
            return false;
        }
    },

    async enqueue(actionType: QueueItem['actionType'], payload: any, userId: string, operationId?: string): Promise<QueueItem> {
        // Coalescing O(1) para UPDATE_ROUND: fusiona actualizaciones GPS y de estado
        // pendientes de la misma ronda sin generar crecimiento O(N²) en IndexedDB.
        if (actionType === 'UPDATE_ROUND' && payload?.id) {
            let existingMatch: QueueItem | null = null;
            await syncQueue.iterate((value: QueueItem) => {
                if (
                    value.actionType === 'UPDATE_ROUND' &&
                    value.userId === userId &&
                    value.payload?.id === payload.id &&
                    value.status !== 'SYNCING' &&
                    !inFlightIds.has(value.id) &&
                    value.retryCount < MAX_RETRIES &&
                    (value.status === 'PENDING' || value.status === 'ERROR')
                ) {
                    if (!existingMatch || new Date(value.timestamp).getTime() >= new Date(existingMatch.timestamp).getTime()) {
                        existingMatch = value;
                    }
                }
            });

            if (existingMatch) {
                const updated: QueueItem = {
                    ...(existingMatch as QueueItem),
                    payload: {
                        ...(existingMatch as QueueItem).payload,
                        id: payload.id,
                        data: {
                            ...((existingMatch as QueueItem).payload?.data || {}),
                            ...(payload.data || {}),
                        },
                    },
                    status: 'PENDING',
                    retryCount: 0,
                    lastError: undefined,
                    timestamp: (existingMatch as QueueItem).timestamp,
                };
                await syncQueue.setItem(updated.id, updated);
                return updated;
            }
        }

        const id = `sq_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const item: QueueItem = {
            id,
            operationId: operationId || generateOperationId(),
            userId,
            actionType,
            payload,
            status: 'PENDING',
            timestamp: new Date().toISOString(),
            retryCount: 0
        };

        await syncQueue.setItem(id, item);
        console.log(`[SyncQueue] Enqueued action: ${actionType} (ID: ${id}, opId: ${item.operationId}, user: ${userId})`);
        return item;
    },

    /**
     * Compacta múltiples operaciones UPDATE_ROUND duplicadas ya almacenadas para una misma ronda
     * (recupera espacio histórico acumulado O(N²) de versiones OTA anteriores sin perder puntos ni orden).
     */
    async compactPendingUpdateRounds(): Promise<{ merged: number; removed: number }> {
        const items: QueueItem[] = [];
        await syncQueue.iterate((value: QueueItem) => {
            if (
                value.actionType === 'UPDATE_ROUND' &&
                value.payload?.id &&
                value.status !== 'SYNCING' &&
                !inFlightIds.has(value.id) &&
                value.retryCount < MAX_RETRIES &&
                (value.status === 'PENDING' || value.status === 'ERROR')
            ) {
                items.push(value);
            }
        });

        const groups = new Map<string, QueueItem[]>();
        for (const item of items) {
            const key = `${item.userId || ''}::${item.payload.id}`;
            const list = groups.get(key) || [];
            list.push(item);
            groups.set(key, list);
        }

        let merged = 0;
        let removed = 0;

        for (const group of groups.values()) {
            if (group.length <= 1) continue;
            group.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

            // Conserva el primer slot cronológico (garantiza orden tras ADD_ROUND) con la suma ordenada de datos
            const keeper = group[0];
            let mergedData: Record<string, any> = {};
            for (const g of group) {
                mergedData = { ...mergedData, ...(g.payload?.data || {}) };
            }

            const compactedKeeper: QueueItem = {
                ...keeper,
                payload: {
                    ...keeper.payload,
                    data: mergedData,
                },
                status: 'PENDING',
                retryCount: 0,
                lastError: undefined,
            };

            await syncQueue.setItem(compactedKeeper.id, compactedKeeper);
            for (let i = 1; i < group.length; i++) {
                await syncQueue.removeItem(group[i].id);
                removed++;
            }
            merged++;
        }

        if (removed > 0) {
            console.log(`[SyncQueue] Compactados ${merged} grupos UPDATE_ROUND, eliminados ${removed} duplicados.`);
        }
        return { merged, removed };
    },

    /**
     * Get pending items. If userId is provided, returns only items for that user.
     * If userId is omitted, returns ALL pending items (for migration/diagnostics only).
     */
    async getPending(userId?: string): Promise<QueueItem[]> {
        const items: QueueItem[] = [];
        await syncQueue.iterate((value: QueueItem) => {
            // Skip needs_recovery_review items
            if ((value as any).status === 'needs_recovery_review') return;

            // Incluir PENDING y ERROR (para reintentos), excluir los que superaron MAX_RETRIES
            if ((value.status === 'PENDING' || value.status === 'ERROR') && value.retryCount < MAX_RETRIES) {
                // Filter by userId if provided
                if (userId && value.userId && value.userId !== userId) return;
                items.push(value);
            } else if (value.retryCount >= MAX_RETRIES) {
                console.warn(`[SyncQueue] Item ${value.id} superó MAX_RETRIES (${MAX_RETRIES}). Marcando como ERROR permanente.`);
                // No borrar — mantener para diagnóstico. Marcar como ERROR permanente.
                value.status = 'ERROR';
                value.lastError = `Superó máximo de reintentos (${MAX_RETRIES})`;
                syncQueue.setItem(value.id, value);
            }
        });
        
        // Sort chronologically (oldest first)
        return items.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    },

    /**
     * Count pending items. If userId is provided, counts only that user's items.
     */
    async getPendingCount(userId?: string): Promise<number> {
        let count = 0;
        await syncQueue.iterate((value: QueueItem) => {
            if ((value as any).status === 'needs_recovery_review') return;
            if ((value.status === 'PENDING' || value.status === 'ERROR') && value.retryCount < MAX_RETRIES) {
                if (userId && value.userId && value.userId !== userId) return;
                count++;
            }
        });
        return count;
    },

    async getErrorCount(userId?: string): Promise<number> {
        let count = 0;
        await syncQueue.iterate((value: QueueItem) => {
            if (value.status === 'ERROR' && value.retryCount >= MAX_RETRIES) {
                if (userId && value.userId && value.userId !== userId) return;
                count++;
            }
        });
        return count;
    },

    async clearErrors(): Promise<void> {
        const idsToRemove: string[] = [];
        await syncQueue.iterate((value: QueueItem, key: string) => {
            if (value.status === 'ERROR' && value.retryCount >= MAX_RETRIES) {
                idsToRemove.push(key);
            }
        });
        for (const id of idsToRemove) {
            await syncQueue.removeItem(id);
        }
        console.log(`[SyncQueue] Limpiados ${idsToRemove.length} errores permanentes.`);
    },

    /**
     * Purges only permanent errors (status === 'ERROR' and retryCount >= MAX_RETRIES)
     * strictly older than cutoffIso (e.g. 15 days).
     * Never deletes PENDING, SYNCING, needs_recovery_review, or items without valid old timestamp.
     */
    async clearPermanentErrorsOlderThan(cutoffIso: string): Promise<number> {
        const cutoffTime = new Date(cutoffIso).getTime();
        const idsToRemove: string[] = [];
        
        await syncQueue.iterate((value: QueueItem, key: string) => {
            if (value.status === 'ERROR' && value.retryCount >= MAX_RETRIES) {
                const itemTime = value.timestamp ? new Date(value.timestamp).getTime() : NaN;
                if (!isNaN(itemTime) && itemTime < cutoffTime) {
                    idsToRemove.push(key);
                }
            }
        });
        
        for (const id of idsToRemove) {
            await syncQueue.removeItem(id);
        }
        
        console.log(`[SyncQueue] Limpiados ${idsToRemove.length} errores permanentes mayores a 15 días.`);
        return idsToRemove.length;
    },

    async markCompleted(id: string): Promise<void> {
        inFlightIds.delete(id);
        await syncQueue.removeItem(id);
        console.log(`[SyncQueue] Marked completed and removed: ${id}`);
    },

    async markSyncing(item: QueueItem): Promise<void> {
        inFlightIds.add(item.id);
        item.status = 'SYNCING';
        item.lastAttemptAt = new Date().toISOString();
        await syncQueue.setItem(item.id, item);
    },

    async incrementRetry(item: QueueItem, error?: string): Promise<void> {
        inFlightIds.delete(item.id);
        item.retryCount += 1;
        item.status = item.retryCount >= MAX_RETRIES ? 'ERROR' : 'PENDING';
        item.lastError = error || item.lastError;
        item.lastAttemptAt = new Date().toISOString();
        await syncQueue.setItem(item.id, item);
        console.warn(`[SyncQueue] Retry ${item.retryCount}/${MAX_RETRIES} para item ${item.id} (${item.actionType}): ${error || ''}`);
    },

    /**
     * Recupera ítems que quedaron en SYNCING por cierre abrupto de app (> 2 min sin progreso)
     * cuando no están siendo procesados en la sesión actual.
     */
    async recoverStaleSyncingItems(userId?: string, staleMs = 2 * 60 * 1000): Promise<number> {
        const now = Date.now();
        const toReset: QueueItem[] = [];
        await syncQueue.iterate((value: QueueItem) => {
            if (value.status !== 'SYNCING' || inFlightIds.has(value.id)) return;
            if (userId && value.userId && value.userId !== userId) return;
            const refTs = value.lastAttemptAt || value.timestamp;
            const age = refTs ? now - new Date(refTs).getTime() : staleMs + 1;
            if (isNaN(age) || age > staleMs) {
                value.status = 'PENDING';
                toReset.push(value);
            }
        });
        for (const item of toReset) {
            await syncQueue.setItem(item.id, item);
        }
        return toReset.length;
    },

    async clearQueue(): Promise<void> {
        await syncQueue.clear();
    },

    /** Limpia solo los items completados (SYNCED) que se hayan quedado */
    async cleanSynced(): Promise<void> {
        const toRemove: string[] = [];
        await syncQueue.iterate((value: QueueItem) => {
            if (value.status === 'SYNCED') toRemove.push(value.id);
        });
        for (const id of toRemove) {
            await syncQueue.removeItem(id);
        }
    },

    /** Resets the retry count and status for queue items related to a specific visit */
    async resetRetriesForVisit(visitId: string): Promise<void> {
        const itemsToUpdate: QueueItem[] = [];
        await syncQueue.iterate((value: QueueItem) => {
            if (value.operationId === `visita_${visitId}` || value.operationId?.startsWith(`foto_${visitId}_`)) {
                if (value.retryCount > 0 || value.status === 'ERROR') {
                    value.retryCount = 0;
                    value.status = 'PENDING';
                    value.lastError = undefined;
                    itemsToUpdate.push(value);
                }
            }
        });
        for (const item of itemsToUpdate) {
            await syncQueue.setItem(item.id, item);
        }
        if (itemsToUpdate.length > 0) {
            console.log(`[SyncQueue] Se han reseteado los reintentos de ${itemsToUpdate.length} ítems para la visita ${visitId}`);
        }
    },

    /** Get ALL items regardless of status (for diagnostics/migration) */
    async getAllItems(): Promise<QueueItem[]> {
        const items: QueueItem[] = [];
        await syncQueue.iterate((value: QueueItem) => {
            items.push(value);
        });
        return items.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    }
};
