import localforage from 'localforage';

export interface QueueItem {
    id: string;
    actionType: 'ADD_ROUND' | 'UPDATE_ROUND' | 'UPLOAD_EVIDENCE';
    payload: any;
    status: 'PENDING';
    timestamp: string;
    retryCount: number;
}

const MAX_RETRIES = 5;

const syncQueue = localforage.createInstance({
    name: 'GGSS_Offline_DB',
    storeName: 'sync_queue'
});

export const SyncQueueService = {
    async enqueue(actionType: QueueItem['actionType'], payload: any): Promise<QueueItem> {
        const id = `sq_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
        const item: QueueItem = {
            id,
            actionType,
            payload,
            status: 'PENDING',
            timestamp: new Date().toISOString(),
            retryCount: 0
        };

        await syncQueue.setItem(id, item);
        console.log(`[SyncQueue] Enqueued action: ${actionType} (ID: ${id})`);
        return item;
    },

    async getPending(): Promise<QueueItem[]> {
        const items: QueueItem[] = [];
        await syncQueue.iterate((value: QueueItem) => {
            // Excluir elementos que superaron el límite de reintentos
            if (value.status === 'PENDING' && value.retryCount < MAX_RETRIES) {
                items.push(value);
            } else if (value.retryCount >= MAX_RETRIES) {
                console.warn(`[SyncQueue] Item ${value.id} superó MAX_RETRIES (${MAX_RETRIES}). Descartando.`);
                syncQueue.removeItem(value.id);
            }
        });
        
        // Sort chronologically (oldest first)
        return items.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    },

    async getPendingCount(): Promise<number> {
        let count = 0;
        await syncQueue.iterate((value: QueueItem) => {
            if (value.status === 'PENDING' && value.retryCount < MAX_RETRIES) count++;
        });
        return count;
    },

    async markCompleted(id: string): Promise<void> {
        await syncQueue.removeItem(id);
        console.log(`[SyncQueue] Marked completed and removed: ${id}`);
    },

    async incrementRetry(item: QueueItem): Promise<void> {
        item.retryCount += 1;
        await syncQueue.setItem(item.id, item);
        console.warn(`[SyncQueue] Retry ${item.retryCount}/${MAX_RETRIES} para item ${item.id} (${item.actionType})`);
    },

    async clearQueue(): Promise<void> {
        await syncQueue.clear();
    }
};
