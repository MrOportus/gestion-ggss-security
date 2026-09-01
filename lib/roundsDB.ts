
/**
 * IndexedDB helper for rounds tracking.
 * Stores GPS points and photos when offline.
 *
 * v2: Adds a second object store "pendingEvidences" to hold
 * compressed photo Blobs during an active round. These are flushed
 * to Firebase Storage only when the round is finalized.
 */

export interface PendingEvidence {
    id?: number; // autoIncrement PK
    roundId: string;
    blob: Blob;
    lat: number;
    lng: number;
    timestamp: string;
}

export const roundsDB = {
    dbName: 'RoundsOfflineDB',
    storeName: 'pendingPoints',
    evidenceStore: 'pendingEvidences',

    async open() {
        return new Promise<IDBDatabase>((resolve, reject) => {
            // Bumped to v2 to add the new "pendingEvidences" object store
            const request = indexedDB.open(this.dbName, 2);
            request.onupgradeneeded = (event) => {
                const db = request.result;
                if (!db.objectStoreNames.contains(this.storeName)) {
                    db.createObjectStore(this.storeName, { keyPath: 'id', autoIncrement: true });
                }
                if (!db.objectStoreNames.contains(this.evidenceStore)) {
                    const store = db.createObjectStore(this.evidenceStore, { keyPath: 'id', autoIncrement: true });
                    store.createIndex('roundId', 'roundId', { unique: false });
                }
            };
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
        });
    },

    // ─── GPS Points ───────────────────────────────────────────────────────────

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
    },

    // ─── Pending Evidences (Offline-First Photo Buffer) ───────────────────────

    /**
     * Save a compressed photo Blob locally during an active round.
     * Returns the auto-assigned IDB key so it can be revoked later.
     */
    async savePendingEvidence(evidence: Omit<PendingEvidence, 'id'>): Promise<number> {
        const db = await this.open();
        return new Promise<number>((resolve, reject) => {
            const tx = db.transaction(this.evidenceStore, 'readwrite');
            const req = tx.objectStore(this.evidenceStore).add(evidence);
            req.onsuccess = () => resolve(req.result as number);
            tx.onerror = () => reject(tx.error);
        });
    },

    /**
     * Retrieve all pending evidences for a given round.
     */
    async getPendingEvidences(roundId: string): Promise<PendingEvidence[]> {
        const db = await this.open();
        return new Promise<PendingEvidence[]>((resolve, reject) => {
            const tx = db.transaction(this.evidenceStore, 'readonly');
            const index = tx.objectStore(this.evidenceStore).index('roundId');
            const req = index.getAll(roundId);
            req.onsuccess = () => resolve(req.result as PendingEvidence[]);
            req.onerror = () => reject(req.error);
        });
    },

    /**
     * Delete all pending evidences for a given round (after successful upload).
     */
    async clearPendingEvidences(roundId: string): Promise<void> {
        const db = await this.open();
        return new Promise<void>((resolve, reject) => {
            const tx = db.transaction(this.evidenceStore, 'readwrite');
            const index = tx.objectStore(this.evidenceStore).index('roundId');
            const req = index.getAllKeys(roundId);
            req.onsuccess = () => {
                const keys = req.result;
                keys.forEach(key => tx.objectStore(this.evidenceStore).delete(key));
                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error);
            };
            req.onerror = () => reject(req.error);
        });
    }
};
