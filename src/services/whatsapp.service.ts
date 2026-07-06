import { Client, LocalAuth } from 'whatsapp-web.js';
import * as qrcode from 'qrcode-terminal';
import { procesarMensajeEntrante } from '../controllers/message.controller';
import { logger } from '../utils/logger';

export let whatsappClient: Client | null = null;

export const initializeWhatsApp = (): Client => {
    const client = new Client({
        authStrategy: new LocalAuth(), 
        puppeteer: {
            headless: true,
            args: [
                '--no-sandbox',
                '--disable-setuid-sandbox',
                '--disable-dev-shm-usage',
                '--disable-accelerated-2d-canvas',
                '--no-first-run',
                '--no-zygote',
                '--disable-gpu'
            ]
        }
    });

    client.on('qr', (qr) => {
        logger.info('QR', 'Escanea el código QR con tu WhatsApp:');
        qrcode.generate(qr, { small: true });
    });

    client.on('ready', () => {
        logger.info('WHATSAPP', '✅ Conectado y escuchando mensajes');
    });

    client.on('message_create', async (msg) => {
        try {
            const chat = await msg.getChat();

            const gruposAutorizados = (process.env.GRUPO_AUTORIZADO || 'Contabilidad')
                .split(',')
                .map(g => g.trim())
                .filter(Boolean);

            const isTargetGroup = chat.isGroup && gruposAutorizados.includes(chat.name);

            if (isTargetGroup) {
                logger.info('WHATSAPP', `Mensaje en ${chat.name}`);
                await procesarMensajeEntrante(msg);
            }
            
        } catch (error) {
            logger.error('WHATSAPP', 'Error al procesar mensaje:', error);
        }
    });

    client.initialize();
    whatsappClient = client;
    return client;
};
