import Database from 'better-sqlite3';
import { logger } from '../utils/logger';

const db = new Database('bot_memory.db');

export interface Transaccion {
    messageId: string;
    nPedido: string;
    filaIngreso: number;
    filaVenta: number | null;
    fechaRegistro: string;
    referenciaPago: string | null;
}

const LIMITE_REGISTROS = 300;

export function inicializarDB(): void {
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
    } catch {
        // ya existe
    }

    logger.info('DB', 'Base de datos inicializada (bot_memory.db)');
}

export function guardarTransaccion(
    messageId: string,
    nPedido: string,
    filaIngreso: number,
    referenciaPago?: string | null
): void {
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO historial_transacciones
            (messageId, nPedido, filaIngreso, filaVenta, fechaRegistro, referenciaPago)
        VALUES (?, ?, ?, NULL, ?, ?)
    `);

    const fechaRegistro = new Date().toISOString();
    stmt.run(messageId, nPedido, filaIngreso, fechaRegistro, referenciaPago || null);

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
        logger.info('DB', `FIFO: eliminados ${exceso} registro(s) antiguos`);
    }

    logger.info('DB', `Guardada: ${nPedido} (msg: ${messageId})`);
}

export function buscarTransaccion(messageId: string): Transaccion | null {
    const row = db.prepare(`SELECT * FROM historial_transacciones WHERE messageId = ?`).get(messageId) as Transaccion | undefined;
    return row ?? null;
}

export function buscarTransaccionPorNPedido(nPedido: string): Transaccion | null {
    const row = db.prepare(`SELECT * FROM historial_transacciones WHERE nPedido = ?`).get(nPedido) as Transaccion | undefined;
    return row ?? null;
}

export function buscarTransaccionPorReferencia(referencia: string): Transaccion | null {
    if (!referencia || referencia === 'N/A') return null;
    const row = db.prepare(`SELECT * FROM historial_transacciones WHERE referenciaPago = ?`).get(referencia) as Transaccion | undefined;
    return row ?? null;
}

export function actualizarFilaVenta(messageId: string, filaVenta: number): void {
    db.prepare(`UPDATE historial_transacciones SET filaVenta = ? WHERE messageId = ?`).run(filaVenta, messageId);
    logger.info('DB', `filaVenta=${filaVenta} para messageId=${messageId}`);
}

export function generarSiguienteNPedido(): string {
    db.exec(`
        CREATE TABLE IF NOT EXISTS secuencia_pedidos (
            id    INTEGER PRIMARY KEY CHECK (id = 1),
            valor INTEGER NOT NULL DEFAULT 0
        );
        INSERT OR IGNORE INTO secuencia_pedidos (id, valor) VALUES (1, 0);
    `);

    const row = db.prepare(`
        UPDATE secuencia_pedidos SET valor = valor + 1 WHERE id = 1
        RETURNING valor
    `).get() as { valor: number };

    return `LG-${String(row.valor).padStart(2, '0')}`;
}

export function cerrarDB(): void {
    db.close();
    logger.info('DB', 'SQLite cerrada correctamente');
}
