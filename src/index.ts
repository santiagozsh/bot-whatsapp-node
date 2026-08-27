import { initializeWhatsApp, whatsappClient, whatsappDestroy, verificarVersionBaileys } from './services/whatsapp.service';
import { initDatabase, closeDatabase, getSequenceValue, setSequenceValue } from './services/memory.service';
import { getLatestOrderNumberFromSheets } from './services/sheets.service';
import { clasificarPedidosDelDia } from './services/classifier.service';
import { logger } from './utils/logger';

async function iniciarServidor() {
    logger.info('INIT', 'Iniciando el servidor...');
    initDatabase();

    try {
        const ultimo = await getLatestOrderNumberFromSheets();
        if (ultimo !== null) {
            const valorActual = getSequenceValue();
            if (ultimo > valorActual) {
                setSequenceValue(ultimo);
                logger.info('DB', `Secuencia sincronizada desde Sheets: ${valorActual} → ${ultimo}`);
            }
        }
    } catch (err) {
        logger.error('INIT', 'Error al sincronizar secuencia desde Sheets:', err);
    }

    initializeWhatsApp();
    verificarVersionBaileys();
}

iniciarServidor();

setInterval(() => logger.summary(), 3600000);

const msHastaMedianoche = (() => {
    const ahora = new Date();
    const medianoche = new Date(ahora);
    medianoche.setDate(ahora.getDate() + 1);
    medianoche.setHours(0, 0, 0, 0);
    return medianoche.getTime() - ahora.getTime();
})();

setTimeout(() => {
    clasificarPedidosDelDia();
    setInterval(clasificarPedidosDelDia, 24 * 60 * 60 * 1000);
}, msHastaMedianoche);

let isShuttingDown = false;

const gracefulShutdown = async (signal: string) => {
    if (isShuttingDown) return;
    isShuttingDown = true;
    logger.info('SHUTDOWN', `Recibido ${signal} — cerrando...`);

    const timeout = setTimeout(() => {
        logger.warn('SHUTDOWN', 'Timeout forzado — saliendo');
        process.exit(1);
    }, 5000);

    try {
        if (whatsappDestroy) {
            await whatsappDestroy();
            logger.info('SHUTDOWN', 'Cliente WhatsApp cerrado');
        }
        closeDatabase();
    } catch (err) {
        logger.error('SHUTDOWN', 'Error durante cierre:', err);
    }

    clearTimeout(timeout);
    logger.info('SHUTDOWN', 'Cierre completado');
    process.exit(0);
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
    logger.error('PROCESS', 'Unhandled rejection:', reason);
});
process.on('uncaughtException', (error) => {
    logger.error('PROCESS', 'Uncaught exception — cerrando:', error);
    closeDatabase();
    if (whatsappDestroy) {
        whatsappDestroy().catch(() => {});
    }
    process.exit(1);
});
