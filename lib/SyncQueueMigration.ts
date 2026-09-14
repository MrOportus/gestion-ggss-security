/**
 * SyncQueueMigration — Migración segura de la cola offline existente.
 *
 * Responsabilidades:
 *   1. Crear un backup completo de la cola actual (OFFLINE_QUEUE_BACKUP).
 *   2. Migrar cada item para añadir el campo `userId` inferido del payload.
 *   3. Marcar items irrecuperables como `needs_recovery_review`.
 *   4. Garantizar idempotencia (migrationVersion).
 *
 * REGLAS:
 *   - NO elimina datos originales.
 *   - NO ejecuta operaciones pendientes.
 *   - NO modifica payloads.
 *   - El backup se preserva indefinidamente.
 */

import localforage from 'localforage';

// ── Stores ──────────────────────────────────────────────────────────────────────

const syncQueue = localforage.createInstance({
    name: 'GGSS_Offline_DB',
    storeName: 'sync_queue'
});

const backupStore = localforage.createInstance({
    name: 'GGSS_Offline_DB',
    storeName: 'sync_queue_backup'
});

const migrationMeta = localforage.createInstance({
    name: 'GGSS_Offline_DB',
    storeName: 'migration_meta'
});

// ── Types ───────────────────────────────────────────────────────────────────────

interface LegacyQueueItem {
    id: string;
    operationId: string;
    actionType: string;
    payload: any;
    status: string;
    timestamp: string;
    retryCount: number;
    lastError?: string;
    syncedAt?: string;
    // May or may not have userId (pre-migration items won't)
    userId?: string;
}

export interface MigrationResult {
    totalItems: number;
    migratedWithUserId: number;
    markedForReview: number;
    alreadyHadUserId: number;
    backupCreated: boolean;
    migrationVersion: number;
    details: MigrationItemDetail[];
}

export interface MigrationItemDetail {
    id: string;
    operationId: string;
    actionType: string;
    inferredUserId: string | null;
    source: string; // How userId was determined
    status: string;
    timestamp: string;
    retryCount: number;
    lastError?: string;
}

// ── Migration Version ───────────────────────────────────────────────────────────

const CURRENT_MIGRATION_VERSION = 1;

export const SyncQueueMigration = {

    /**
     * Check if migration has already been applied.
     */
    async getMigrationVersion(): Promise<number> {
        const version = await migrationMeta.getItem<number>('migrationVersion');
        return version || 0;
    },

    /**
     * Create a full backup of the current sync queue.
     * Does NOT delete originals. Idempotent — overwrites previous backup.
     */
    async createBackup(): Promise<{ count: number }> {
        let count = 0;

        // Clear previous backup (idempotent)
        await backupStore.clear();

        await syncQueue.iterate((value: LegacyQueueItem, key: string) => {
            backupStore.setItem(key, JSON.parse(JSON.stringify(value)));
            count++;
        });

        const backupTimestamp = new Date().toISOString();
        await migrationMeta.setItem('lastBackupAt', backupTimestamp);
        await migrationMeta.setItem('lastBackupCount', count);

        console.log(`[SyncQueueMigration] Backup creado: ${count} items at ${backupTimestamp}`);
        return { count };
    },

    /**
     * Read all backup items (for inspection / debugging).
     */
    async getBackupItems(): Promise<LegacyQueueItem[]> {
        const items: LegacyQueueItem[] = [];
        await backupStore.iterate((value: LegacyQueueItem) => {
            items.push(value);
        });
        return items;
    },

    /**
     * Read all current queue items (for inspection before migration).
     */
    async getAllCurrentItems(): Promise<LegacyQueueItem[]> {
        const items: LegacyQueueItem[] = [];
        await syncQueue.iterate((value: LegacyQueueItem) => {
            items.push(value);
        });
        return items;
    },

    /**
     * Infer userId from a queue item's payload.
     * Returns { userId, source } or { userId: null, source: 'unresolved' }.
     */
    inferUserId(item: LegacyQueueItem): { userId: string | null; source: string } {
        // Already has userId
        if (item.userId) {
            return { userId: item.userId, source: 'existing_field' };
        }

        const payload = item.payload;
        if (!payload) {
            return { userId: null, source: 'no_payload' };
        }

        switch (item.actionType) {
            case 'ADD_ROUND': {
                // payload IS the round object, which has workerId (= Firebase UID)
                if (payload.workerId) {
                    return { userId: payload.workerId, source: 'payload.workerId' };
                }
                break;
            }

            case 'UPDATE_ROUND': {
                // payload = { id, data: {...} }
                // The data may have workerId if it was included in the update
                if (payload.data?.workerId) {
                    return { userId: payload.data.workerId, source: 'payload.data.workerId' };
                }
                // We can cross-reference with ADD_ROUND for the same round ID
                // but that requires async lookup — handled in migrateToUserScoped
                return { userId: null, source: 'update_round_needs_crossref' };
            }

            case 'UPLOAD_EVIDENCE': {
                // payload = { roundId, photoBase64, lat, lng, timestamp }
                // No direct userId — needs cross-reference with ADD_ROUND
                return { userId: null, source: 'evidence_needs_crossref' };
            }

            case 'ADD_NOVEDAD': {
                // payload = { registroId, data: { autorUid, ... } }
                if (payload.data?.autorUid) {
                    return { userId: payload.data.autorUid, source: 'payload.data.autorUid' };
                }
                if (payload.data?.colaboradorId) {
                    return { userId: payload.data.colaboradorId, source: 'payload.data.colaboradorId' };
                }
                break;
            }

            case 'UPLOAD_NOVEDAD_PHOTO': {
                // payload = { registroId, photoBase64, photoIndex }
                // No direct userId — needs cross-reference with ADD_NOVEDAD
                return { userId: null, source: 'novedad_photo_needs_crossref' };
            }

            case 'CHECK_IN':
            case 'CHECK_OUT': {
                // If these exist, look for userId in payload
                if (payload.userId) return { userId: payload.userId, source: 'payload.userId' };
                if (payload.workerId) return { userId: payload.workerId, source: 'payload.workerId' };
                if (payload.employeeId) return { userId: payload.employeeId, source: 'payload.employeeId' };
                break;
            }

            default:
                break;
        }

        return { userId: null, source: 'unresolved' };
    },

    /**
     * Main migration function. Idempotent — safe to run multiple times.
     *
     * 1. Creates backup
     * 2. Reads all items
     * 3. Builds a cross-reference map (roundId → userId) from ADD_ROUND items
     * 4. Infers userId for each item
     * 5. Updates items in-place with userId field
     * 6. Marks unresolvable items as needs_recovery_review
     * 7. Sets migrationVersion
     */
    async migrateToUserScoped(): Promise<MigrationResult> {
        // Check if already migrated
        const currentVersion = await this.getMigrationVersion();
        if (currentVersion >= CURRENT_MIGRATION_VERSION) {
            console.log(`[SyncQueueMigration] Ya migrado (v${currentVersion}). Saltando.`);
            const items = await this.getAllCurrentItems();
            return {
                totalItems: items.length,
                migratedWithUserId: items.filter(i => i.userId && i.status !== 'needs_recovery_review').length,
                markedForReview: items.filter(i => i.status === 'needs_recovery_review').length,
                alreadyHadUserId: items.length,
                backupCreated: false,
                migrationVersion: currentVersion,
                details: []
            };
        }

        console.log('[SyncQueueMigration] Iniciando migración v1...');

        // Step 1: Backup
        const backup = await this.createBackup();

        // Step 2: Read all items
        const allItems: LegacyQueueItem[] = [];
        await syncQueue.iterate((value: LegacyQueueItem) => {
            allItems.push(value);
        });

        console.log(`[SyncQueueMigration] ${allItems.length} items a migrar.`);

        // Step 3: Build cross-reference maps
        // roundId → userId (from ADD_ROUND items)
        const roundIdToUserId = new Map<string, string>();
        // registroId → userId (from ADD_NOVEDAD items)
        const registroIdToUserId = new Map<string, string>();

        for (const item of allItems) {
            if (item.actionType === 'ADD_ROUND' && item.payload?.workerId) {
                // Round ID is item.payload.id
                roundIdToUserId.set(item.payload.id, item.payload.workerId);
            }
            if (item.actionType === 'ADD_NOVEDAD' && item.payload?.data?.autorUid) {
                registroIdToUserId.set(item.payload.registroId, item.payload.data.autorUid);
            }
        }

        // Step 4: Migrate each item
        let migratedWithUserId = 0;
        let markedForReview = 0;
        let alreadyHadUserId = 0;
        const details: MigrationItemDetail[] = [];

        for (const item of allItems) {
            let userId: string | null = null;
            let source = 'unresolved';

            // First try direct inference
            const directResult = this.inferUserId(item);
            userId = directResult.userId;
            source = directResult.source;

            // If not resolved, try cross-reference
            if (!userId) {
                if (item.actionType === 'UPDATE_ROUND' && item.payload?.id) {
                    const crossRefUserId = roundIdToUserId.get(item.payload.id);
                    if (crossRefUserId) {
                        userId = crossRefUserId;
                        source = 'crossref_roundId_to_workerId';
                    }
                }

                if (item.actionType === 'UPLOAD_EVIDENCE' && item.payload?.roundId) {
                    const crossRefUserId = roundIdToUserId.get(item.payload.roundId);
                    if (crossRefUserId) {
                        userId = crossRefUserId;
                        source = 'crossref_roundId_to_workerId';
                    }
                }

                if (item.actionType === 'UPLOAD_NOVEDAD_PHOTO' && item.payload?.registroId) {
                    const crossRefUserId = registroIdToUserId.get(item.payload.registroId);
                    if (crossRefUserId) {
                        userId = crossRefUserId;
                        source = 'crossref_registroId_to_autorUid';
                    }
                }
            }

            // Record detail
            const detail: MigrationItemDetail = {
                id: item.id,
                operationId: item.operationId,
                actionType: item.actionType,
                inferredUserId: userId,
                source,
                status: item.status,
                timestamp: item.timestamp,
                retryCount: item.retryCount,
                lastError: item.lastError,
            };
            details.push(detail);

            // Update the item
            if (item.userId) {
                // Already had userId — just ensure migrationVersion
                alreadyHadUserId++;
            } else if (userId) {
                item.userId = userId;
                migratedWithUserId++;
            } else {
                // Cannot determine owner — mark for manual review
                // Preserve original status in lastError for recovery
                const originalStatus = item.status;
                item.status = 'needs_recovery_review' as any;
                item.lastError = `[MIGRATION] Original status: ${originalStatus}. Could not infer userId. Source: ${source}`;
                markedForReview++;
            }

            // Write updated item back
            await syncQueue.setItem(item.id, item);
        }

        // Step 5: Set migration version
        await migrationMeta.setItem('migrationVersion', CURRENT_MIGRATION_VERSION);
        await migrationMeta.setItem('migrationTimestamp', new Date().toISOString());
        await migrationMeta.setItem('migrationDetails', JSON.stringify(details));

        const result: MigrationResult = {
            totalItems: allItems.length,
            migratedWithUserId,
            markedForReview,
            alreadyHadUserId,
            backupCreated: backup.count > 0,
            migrationVersion: CURRENT_MIGRATION_VERSION,
            details
        };

        console.log(`[SyncQueueMigration] Migración completada:`, {
            total: result.totalItems,
            migrated: result.migratedWithUserId,
            review: result.markedForReview,
            existing: result.alreadyHadUserId,
        });

        return result;
    },

    /**
     * Get migration details from the last run (stored in migration_meta).
     */
    async getLastMigrationDetails(): Promise<MigrationItemDetail[] | null> {
        const raw = await migrationMeta.getItem<string>('migrationDetails');
        if (!raw) return null;
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }
};
