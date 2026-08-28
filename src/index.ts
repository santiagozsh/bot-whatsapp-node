import { initializeWhatsAppClient, whatsappClient, whatsappDestroy, checkBaileysVersion } from './services/whatsapp.service';
import { initDatabase, closeDatabase, getSequenceValue, setSequenceValue } from './services/memory.service';
import { getLatestOrderNumberFromSheets } from './services/sheets.service';
import { classifyDailyOrders } from './services/classifier.service';
import { startMetricsServer, stopMetricsServer } from './services/metrics.service';
import { logger } from './utils/logger';

/**
 * Main application bootstrap sequence:
 * 1. Starts HTTP metrics & healthcheck server on port 9090.
 * 2. Initializes local SQLite database (`bot_memory.db`).
 * 3. Synchronizes order sequence counter with Google Sheets to prevent sequence regression.
 * 4. Connects to WhatsApp WebSocket gateway via Baileys v7.
 * 5. Checks npm registry for Baileys version updates.
 */
async function startServer(): Promise<void> {
    logger.info('INIT', 'Starting server...');
    await startMetricsServer();
    initDatabase();

    try {
        const latestFromSheets = await getLatestOrderNumberFromSheets();
        if (latestFromSheets !== null) {
            const currentSequence = getSequenceValue();
            if (latestFromSheets > currentSequence) {
                setSequenceValue(latestFromSheets);
                logger.info('DB', `Order sequence synchronized from Sheets: ${currentSequence} → ${latestFromSheets}`);
            }
        }
    } catch (err) {
        logger.error('INIT', 'Error synchronizing order sequence from Google Sheets:', err);
    }

    initializeWhatsAppClient();
    checkBaileysVersion();
}

startServer();

// Calculate milliseconds until midnight for daily wholesale classifier cron
const msUntilMidnight = (() => {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setDate(now.getDate() + 1);
    midnight.setHours(0, 0, 0, 0);
    return midnight.getTime() - now.getTime();
})();

setTimeout(() => {
    classifyDailyOrders();
    setInterval(classifyDailyOrders, 24 * 60 * 60 * 1000);
}, msUntilMidnight);

let isShuttingDown = false;

/**
 * Gracefully shuts down WhatsApp WebSocket connections and flushes SQLite writes before process exit.
 */
const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info('SHUTDOWN', `Received ${signal} — shutting down gracefully...`);

    const forcedTimeout = setTimeout(() => {
        logger.warn('SHUTDOWN', 'Forced exit timeout reached — terminating process');
        process.exit(1);
    }, 5000);

    try {
        if (whatsappDestroy) {
            await whatsappDestroy();
            logger.info('SHUTDOWN', 'WhatsApp client disconnected cleanly');
        }
        await stopMetricsServer();
        closeDatabase();
    } catch (err) {
        logger.error('SHUTDOWN', 'Error during graceful shutdown:', err);
    }

    clearTimeout(forcedTimeout);
    logger.info('SHUTDOWN', 'Shutdown complete');
    process.exit(0);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
    logger.error('PROCESS', 'Unhandled promise rejection:', reason);
});
process.on('uncaughtException', (error) => {
    logger.error('PROCESS', 'Uncaught exception — exiting:', error);
    closeDatabase();
    stopMetricsServer().catch(() => {});
    if (whatsappDestroy) {
        whatsappDestroy().catch(() => {});
    }
    process.exit(1);
});
