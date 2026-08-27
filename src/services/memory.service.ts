import Database from 'better-sqlite3';
import { logger } from '../utils/logger';

let db: Database.Database = new Database(process.env.DB_PATH || 'bot_memory.db');

export interface TransactionRecord {
    messageId: string;
    nPedido: string;
    filaIngreso: number;
    filaVenta: number | null;
    fechaRegistro: string;
    referenciaPago: string | null;
}

// Backward-compatible alias
export type Transaccion = TransactionRecord;

const MAX_TRANSACTION_RECORDS = 300;

/**
 * Initializes the SQLite database tables and schema migrations.
 * Creates `historial_transacciones` and `secuencia_pedidos` if they do not exist.
 * 
 * @param customDbPath - Optional database file path or ':memory:' for isolated testing.
 */
export function initDatabase(customDbPath?: string): Database.Database {
    const targetDbPath = customDbPath || process.env.DB_PATH || 'bot_memory.db';
    if (customDbPath || process.env.DB_PATH) {
        db = new Database(targetDbPath);
    }

    db.exec(`
        CREATE TABLE IF NOT EXISTS historial_transacciones (
            messageId      TEXT PRIMARY KEY,
            nPedido        TEXT NOT NULL,
            filaIngreso    INTEGER NOT NULL,
            filaVenta      INTEGER,
            fechaRegistro  TEXT NOT NULL,
            referenciaPago TEXT
        );
    `);

    try {
        db.exec(`ALTER TABLE historial_transacciones ADD COLUMN referenciaPago TEXT`);
    } catch (error: any) {
        if (!error?.message?.includes('duplicate column') && !error?.message?.includes('already exists')) {
            throw error;
        }
    }

    ensureSequenceTable();

    logger.info('DB', `Database initialized (${customDbPath || 'bot_memory.db'})`);
    return db;
}

// Backward-compatible alias
export const inicializarDB = initDatabase;

/**
 * Saves a new or updated transaction record into SQLite.
 * Automatically enforces a FIFO capacity limit of 300 records to prevent memory bloat.
 * 
 * @param messageId - WhatsApp message ID of the bank receipt.
 * @param orderNumber - Sequential order identifier (`LG-XXX`).
 * @param incomeRow - Row index in the `Ingresos transacciones` Google Sheet.
 * @param paymentReference - Bank payment reference number for deduplication.
 */
export function saveTransaction(
    messageId: string,
    orderNumber: string,
    incomeRow: number,
    paymentReference?: string | null
): void {
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO historial_transacciones
            (messageId, nPedido, filaIngreso, filaVenta, fechaRegistro, referenciaPago)
        VALUES (?, ?, ?, NULL, ?, ?)
    `);

    const registrationDate = new Date().toISOString();
    stmt.run(messageId, orderNumber, incomeRow, registrationDate, paymentReference || null);

    const countRow = db.prepare('SELECT COUNT(*) as total FROM historial_transacciones').get() as { total: number };
    if (countRow.total > MAX_TRANSACTION_RECORDS) {
        const excess = countRow.total - MAX_TRANSACTION_RECORDS;
        db.prepare(`
            DELETE FROM historial_transacciones
            WHERE messageId IN (
                SELECT messageId FROM historial_transacciones
                ORDER BY fechaRegistro ASC, rowid ASC
                LIMIT ?
            )
        `).run(excess);
        logger.info('DB', `FIFO: purged ${excess} oldest transaction record(s)`);
    }

    logger.info('DB', `Saved: ${orderNumber} (msg: ${messageId})`);
}

// Backward-compatible alias
export const guardarTransaccion = saveTransaction;

/**
 * Looks up a transaction record by its WhatsApp message ID.
 * 
 * @param messageId - WhatsApp message ID.
 * @returns Found transaction record or null.
 */
export function findTransactionByMessageId(messageId: string): TransactionRecord | null {
    const row = db.prepare(`SELECT * FROM historial_transacciones WHERE messageId = ?`).get(messageId) as TransactionRecord | undefined;
    return row ?? null;
}

// Backward-compatible alias
export const buscarTransaccion = findTransactionByMessageId;

/**
 * Looks up a transaction record by its sequential order ID (`LG-XXX`).
 * 
 * @param orderNumber - Sequential order number string.
 * @returns Found transaction record or null.
 */
export function findTransactionByOrderNumber(orderNumber: string): TransactionRecord | null {
    const row = db.prepare(`SELECT * FROM historial_transacciones WHERE nPedido = ?`).get(orderNumber) as TransactionRecord | undefined;
    return row ?? null;
}

// Backward-compatible alias
export const buscarTransaccionPorNPedido = findTransactionByOrderNumber;

/**
 * Looks up a transaction record by payment reference string to detect duplicate receipts.
 * 
 * @param paymentReference - Extracted payment reference string.
 * @returns Existing transaction record if duplicate, or null if unique.
 */
export function findTransactionByPaymentReference(paymentReference: string): TransactionRecord | null {
    if (!paymentReference || paymentReference === 'N/A') return null;
    const row = db.prepare(`SELECT * FROM historial_transacciones WHERE referenciaPago = ?`).get(paymentReference) as TransactionRecord | undefined;
    return row ?? null;
}

// Backward-compatible alias
export const buscarTransaccionPorReferencia = findTransactionByPaymentReference;

/**
 * Updates the sales row index (`filaVenta`) for a given transaction once the sales row is appended/merged in Google Sheets.
 * 
 * @param messageId - WhatsApp message ID.
 * @param salesRowIndex - 1-based row number in the `Ventas` sheet.
 */
export function updateSalesRowIndex(messageId: string, salesRowIndex: number): void {
    db.prepare(`UPDATE historial_transacciones SET filaVenta = ? WHERE messageId = ?`).run(salesRowIndex, messageId);
    logger.info('DB', `filaVenta=${salesRowIndex} for messageId=${messageId}`);
}

// Backward-compatible alias
export const actualizarFilaVenta = updateSalesRowIndex;

function ensureSequenceTable(): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS secuencia_pedidos (
            id    INTEGER PRIMARY KEY CHECK (id = 1),
            valor INTEGER NOT NULL DEFAULT 0
        );
        INSERT OR IGNORE INTO secuencia_pedidos (id, valor) VALUES (1, 0);
    `);
}

export type SequenceSyncCallback = () => Promise<number | null>;

// Backward-compatible alias
export type SyncCallback = SequenceSyncCallback;

let _syncCallback: SequenceSyncCallback | null = null;
let _syncAttempted = false;

/**
 * Resets the sync attempted flag for isolated testing.
 */
export function _resetSyncAttemptForTesting(): void {
    _syncAttempted = false;
}

/**
 * Registers an asynchronous callback function (e.g. querying Google Sheets) to sync the latest order number on startup.
 * 
 * @param cb - Async callback returning the highest order number found in external storage.
 */
export function registerSequenceSyncCallback(cb: SequenceSyncCallback): void {
    _syncCallback = cb;
}

// Backward-compatible alias
export const registrarSyncCallback = registerSequenceSyncCallback;

/**
 * Atomically increments the order sequence counter and returns the next formatted order identifier (e.g. `LG-001`).
 * Triggers the sequence sync callback on its first invocation if registered.
 * 
 * @returns Next sequential order identifier (e.g. `LG-042`).
 */
export async function generateNextOrderNumber(): Promise<string> {
    ensureSequenceTable();

    if (!_syncAttempted && _syncCallback) {
        _syncAttempted = true;
        try {
            const latest = await _syncCallback();
            if (latest !== null) {
                const currentValue = getSequenceValue();
                if (latest > currentValue) {
                    setSequenceValue(latest);
                    logger.info('DB', `Sequence synced from callback: ${currentValue} → ${latest}`);
                }
            }
        } catch (err) {
            logger.error('DB', 'Error in sequence sync callback:', err);
        }
    }

    const row = db.prepare(`
        UPDATE secuencia_pedidos SET valor = valor + 1 WHERE id = 1
        RETURNING valor
    `).get() as { valor: number };

    return `LG-${String(row.valor).padStart(3, '0')}`;
}

// Backward-compatible alias
export const generarSiguienteNPedido = generateNextOrderNumber;

/**
 * Retrieves the current counter value of the order sequence.
 * 
 * @returns Current numerical sequence counter.
 */
export function getSequenceValue(): number {
    ensureSequenceTable();
    const row = db.prepare(`SELECT valor FROM secuencia_pedidos WHERE id = 1`).get() as { valor: number };
    return row.valor;
}

// Backward-compatible alias
export const obtenerValorSecuencia = getSequenceValue;

/**
 * Sets the order sequence counter to a specific integer value.
 * 
 * @param value - Integer to set the sequence counter to.
 */
export function setSequenceValue(value: number): void {
    ensureSequenceTable();
    db.prepare(`UPDATE secuencia_pedidos SET valor = ? WHERE id = 1`).run(value);
    logger.info('DB', `Sequence set to ${value}`);
}

// Backward-compatible alias
export const establecerValorSecuencia = setSequenceValue;

/**
 * Safely closes the SQLite database connection.
 */
export function closeDatabase(): void {
    try {
        db.close();
        logger.info('DB', 'SQLite database closed cleanly');
    } catch {
        // Already closed or not open
    }
}

// Backward-compatible alias
export const cerrarDB = closeDatabase;
