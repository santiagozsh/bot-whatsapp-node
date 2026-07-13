import { initializeWhatsApp, whatsappClient } from './services/whatsapp.service';
import { inicializarDB, cerrarDB } from './services/memory.service';
import { logger } from './utils/logger';

logger.info('INIT', 'Iniciando el servidor...');
inicializarDB();
initializeWhatsApp();

setInterval(() => logger.summary(), 3600000); // resumen de tokens cada hora

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
        if (whatsappClient) {
            await whatsappClient.destroy();
            logger.info('SHUTDOWN', 'Cliente WhatsApp cerrado');
        }
        cerrarDB();
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
    cerrarDB();
    if (whatsappClient) {
        whatsappClient.destroy().catch(() => {});
    }
    process.exit(1);
});
