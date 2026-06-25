import Database from 'better-sqlite3';

// ────────────────────────────────────────────────────────────────
// Conexión a la base de datos (archivo en la raíz del proyecto)
// ────────────────────────────────────────────────────────────────
const db = new Database('bot_memory.db');

// Tipo que representa un registro completo de la tabla
export interface Transaccion {
    messageId: string;
    nPedido: string;
    filaIngreso: number;
    filaVenta: number | null;
    fechaRegistro: string;
}

// ────────────────────────────────────────────────────────────────
// Límite FIFO: máximo de registros almacenados en la tabla
// (~8-9 días a 35 transacciones por día)
// ────────────────────────────────────────────────────────────────
const LIMITE_REGISTROS = 300;

// ────────────────────────────────────────────────────────────────
// inicializarDB
// Crea la tabla si no existe. Se llama una sola vez al arrancar.
// ────────────────────────────────────────────────────────────────
export function inicializarDB(): void {
    db.exec(`
        CREATE TABLE IF NOT EXISTS historial_transacciones (
            messageId    TEXT PRIMARY KEY,
            nPedido      TEXT NOT NULL,
            filaIngreso  INTEGER NOT NULL,
            filaVenta    INTEGER,
            fechaRegistro TEXT NOT NULL
        );
    `);
    console.log('[DB] Base de datos inicializada correctamente (bot_memory.db).');
}

// ────────────────────────────────────────────────────────────────
// guardarTransaccion
// Inserta un nuevo registro y aplica limpieza FIFO si es necesario.
// ────────────────────────────────────────────────────────────────
export function guardarTransaccion(
    messageId: string,
    nPedido: string,
    filaIngreso: number
): void {
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO historial_transacciones
            (messageId, nPedido, filaIngreso, filaVenta, fechaRegistro)
        VALUES (?, ?, ?, NULL, ?)
    `);

    const fechaRegistro = new Date().toISOString();
    stmt.run(messageId, nPedido, filaIngreso, fechaRegistro);

    // Limpieza FIFO: borrar los más antiguos si se supera el límite
    const countRow = db.prepare('SELECT COUNT(*) as total FROM historial_transacciones').get() as { total: number };
    if (countRow.total > LIMITE_REGISTROS) {
        const exceso = countRow.total - LIMITE_REGISTROS;
        db.prepare(`
            DELETE FROM historial_transacciones
            WHERE messageId IN (
                SELECT messageId FROM historial_transacciones
                ORDER BY fechaRegistro ASC
                LIMIT ?
            )
        `).run(exceso);
        console.log(`[DB] FIFO: se eliminaron ${exceso} registro(s) antiguos.`);
    }

    console.log(`[DB] Transacción guardada — messageId: ${messageId} | nPedido: ${nPedido} | filaIngreso: ${filaIngreso}`);
}

// ────────────────────────────────────────────────────────────────
// buscarTransaccion
// Devuelve el registro asociado a un messageId, o null si no existe.
// ────────────────────────────────────────────────────────────────
export function buscarTransaccion(messageId: string): Transaccion | null {
    const row = db.prepare(`
        SELECT * FROM historial_transacciones WHERE messageId = ?
    `).get(messageId) as Transaccion | undefined;

    return row ?? null;
}

// ────────────────────────────────────────────────────────────────
// actualizarFilaVenta
// Actualiza el campo filaVenta de un registro existente.
// Se llama después de escribir en la hoja "Ventas".
// ────────────────────────────────────────────────────────────────
export function actualizarFilaVenta(messageId: string, filaVenta: number): void {
    db.prepare(`
        UPDATE historial_transacciones
        SET filaVenta = ?
        WHERE messageId = ?
    `).run(filaVenta, messageId);

    console.log(`[DB] filaVenta actualizada — messageId: ${messageId} | filaVenta: ${filaVenta}`);
}
