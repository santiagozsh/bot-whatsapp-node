import { initializeWhatsApp } from './services/whatsapp.service';
import { inicializarDB } from './services/memory.service';
import { logger } from './utils/logger';

logger.info('INIT', 'Iniciando el servidor...');
inicializarDB();
initializeWhatsApp();

setInterval(() => logger.summary(), 3600000); // resumen de tokens cada hora
