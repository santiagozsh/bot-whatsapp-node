import { initializeWhatsApp, whatsappClient, whatsappDestroy } from './services/whatsapp.service';
import { inicializarDB, cerrarDB, obtenerValorSecuencia, establecerValorSecuencia } from './services/memory.service';
import { obtenerUltimoNPedido } from './services/sheets.service';
import { clasificarPedidosDelDia } from './services/classifier.service';
import { logger } from './utils/logger';

async function iniciarServidor() {
    logger.info('INIT', 'Iniciando el servidor...');
    inicializarDB();

    try {
        const ultimo = await obtenerUltimoNPedido();
        if (ultimo !== null) {
            const valorActual = obtenerValorSecuencia();
            if (ultimo > valorActual) {
                establecerValorSecuencia(ultimo);
                logger.info('DB', `Secuencia sincronizada desde Sheets: ${valorActual} → ${ultimo}`);
            }
        }
    } catch (err) {
        logger.error('INIT', 'Error al sincronizar secuencia desde Sheets:', err);
    }

    initializeWhatsApp();
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
    if (whatsappDestroy) {
        whatsappDestroy().catch(() => {});
    }
    process.exit(1);
});
