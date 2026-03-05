
/**
 * IndexedDB helper for rounds tracking.
 * Stores GPS points and photos when offline.
 */
export const roundsDB = {
    dbName: 'RoundsOfflineDB',
    storeName: 'pendingPoints',

    async open() {
        return new Promise<IDBDatabase>((resolve, reject) => {
            const request = indexedDB.open(this.dbName, 1);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'id', autoIncrement: true });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async savePoint(point: any) {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, 'readwrite');
            tx.objectStore(this.storeName).add(point);
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    },

    async getAllPoints() {
        const db = await this.open();
        return new Promise<any[]>((resolve, reject) => {
            const tx = db.transaction(this.storeName, 'readonly');
            const request = tx.objectStore(this.storeName).getAll();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    async clearPoints() {
        const db = await this.open();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(this.storeName, 'readwrite');
            tx.objectStore(this.storeName).clear();
            tx.oncomplete = () => resolve(true);
            tx.onerror = () => reject(tx.error);
        });
    }
};
