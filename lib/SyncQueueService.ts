import localforage from 'localforage';

export interface QueueItem {
    id: string;
    operationId: string; // UUID idempotente — se usa como ID del documento en Firebase para evitar duplicados
    actionType: 'ADD_ROUND' | 'UPDATE_ROUND' | 'UPLOAD_EVIDENCE' | 'ADD_NOVEDAD' | 'UPLOAD_NOVEDAD_PHOTO' | 'CHECK_IN' | 'CHECK_OUT';
    payload: any;
    status: 'PENDING' | 'SYNCING' | 'SYNCED' | 'ERROR';
    timestamp: string;
    retryCount: number;
    lastError?: string;
    syncedAt?: string;
}

const MAX_RETRIES = 10;

const syncQueue = localforage.createInstance({
    name: 'GGSS_Offline_DB',
    storeName: 'sync_queue'
});

/** Genera un operationId único y determinista */
function generateOperationId(): string {
    return `op_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
}

export const SyncQueueService = {
    async enqueue(actionType: QueueItem['actionType'], payload: any, operationId?: string): Promise<QueueItem> {
        const id = `sq_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const item: QueueItem = {
            id,
            operationId: operationId || generateOperationId(),
            actionType,
            payload,
            status: 'PENDING',
            timestamp: new Date().toISOString(),
            retryCount: 0
        };

        await syncQueue.setItem(id, item);
        console.log(`[SyncQueue] Enqueued action: ${actionType} (ID: ${id}, opId: ${item.operationId})`);
        return item;
    },

    async getPending(): Promise<QueueItem[]> {
        const items: QueueItem[] = [];
        await syncQueue.iterate((value: QueueItem) => {
            // Incluir PENDING y ERROR (para reintentos), excluir los que superaron MAX_RETRIES
            if ((value.status === 'PENDING' || value.status === 'ERROR') && value.retryCount < MAX_RETRIES) {
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

    async getPendingCount(): Promise<number> {
        let count = 0;
        await syncQueue.iterate((value: QueueItem) => {
            if ((value.status === 'PENDING' || value.status === 'ERROR') && value.retryCount < MAX_RETRIES) count++;
        });
        return count;
    },

    async getErrorCount(): Promise<number> {
        let count = 0;
        await syncQueue.iterate((value: QueueItem) => {
            if (value.status === 'ERROR' && value.retryCount >= MAX_RETRIES) count++;
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

    async markCompleted(id: string): Promise<void> {
        await syncQueue.removeItem(id);
        console.log(`[SyncQueue] Marked completed and removed: ${id}`);
    },

    async markSyncing(item: QueueItem): Promise<void> {
        item.status = 'SYNCING';
        await syncQueue.setItem(item.id, item);
    },

    async incrementRetry(item: QueueItem, error?: string): Promise<void> {
        item.retryCount += 1;
        item.status = item.retryCount >= MAX_RETRIES ? 'ERROR' : 'PENDING';
        item.lastError = error || item.lastError;
        await syncQueue.setItem(item.id, item);
        console.warn(`[SyncQueue] Retry ${item.retryCount}/${MAX_RETRIES} para item ${item.id} (${item.actionType}): ${error || ''}`);
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
    }
};
