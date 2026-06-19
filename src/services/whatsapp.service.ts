import { Client, LocalAuth } from 'whatsapp-web.js';
import * as qrcode from 'qrcode-terminal';

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
            // Obtenemos la información completa del chat de donde viene el mensaje
            const chat = await msg.getChat();

            console.log('--- NUEVO MENSAJE DETECTADO ---');
            console.log('De (msg.from):', msg.from);
            console.log('Para (msg.to):', msg.to);
            console.log('Nombre del chat (chat.name):', chat.name);
            console.log('Es grupo (chat.isGroup):', chat.isGroup);
            console.log('-------------------------------');

            // Regla 1: ¿Es el grupo exacto de contabilidad?
            const isTargetGroup = chat.isGroup && chat.name === 'Contabilidad| Empresa Luxury Gotti';
            
            // Regla 2: ¿Es un mensaje enviado a mí mismo (mi bloc de notas)?
            const isMyOwnChat = msg.from === msg.to || msg.to.includes('@lid');

            // El Filtro: Solo pasa si cumple la Regla 1 o la Regla 2
            if (isTargetGroup || isMyOwnChat) {
                console.log(`[Filtro OK] Chat: ${chat.name} | Texto: ${msg.body}`);
            }
            
        } catch (error) {
            console.error('Hubo un error al procesar el mensaje:', error);
        }
    });

    // 5. Encendemos el motor
    client.initialize();
};
