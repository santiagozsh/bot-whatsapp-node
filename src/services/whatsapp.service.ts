import { Client, LocalAuth } from 'whatsapp-web.js';
import * as qrcode from 'qrcode-terminal';
import { procesarMensajeEntrante } from '../controllers/message.controller';

export const initializeWhatsApp = () => {
    // 1. Configuramos el cliente con persistencia de sesión
    const client = new Client({
        authStrategy: new LocalAuth() 
    });

    // 2. Evento: Cuando WhatsApp pide escanear el código
    client.on('qr', (qr) => {
        console.log('Escanea este código QR con tu WhatsApp:');
        qrcode.generate(qr, { small: true }); // "small: true" lo hace visible en terminales más pequeñas
    });

    // 3. Evento: Cuando el inicio de sesión es exitoso
    client.on('ready', () => {
        console.log('✅ ¡El bot está conectado y escuchando la red!');
    });

    /// 4. Evento: Cuando se crea cualquier mensaje (entrante o saliente)
    client.on('message_create', async (msg) => {
        try {
            const chat = await msg.getChat();

            // 1. Lista Blanca (Whitelist) de grupos autorizados
            const gruposAutorizados = [
                'Contabilidad Empresa Luxury Gotti', // El de producción
                'Contabilidad'                        // El de tu Sandbox
            ];

            // 2. El Filtro: ¿Es un grupo Y su nombre está en la lista blanca?
            const isTargetGroup = chat.isGroup && gruposAutorizados.includes(chat.name);

            // 3. Ejecución
            if (isTargetGroup) {
                console.log(`\n[Filtro OK] Mensaje detectado en: ${chat.name}`);
                await procesarMensajeEntrante(msg);
            }
            
        } catch (error) {
            console.error('Hubo un error al procesar el mensaje:', error);
        }
    });

    // 5. Encendemos el motor
    client.initialize();
};
