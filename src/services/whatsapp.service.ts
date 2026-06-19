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

    // 4. Evento: Cuando entra un nuevo mensaje a cualquier chat
    client.on('message', async (msg) => {
        // Por ahora, solo queremos imprimir en consola para verificar que llega
        console.log(`[Mensaje Nuevo] De: ${msg.getContact} | Texto: ${msg.body}`);
    });

    // 5. Encendemos el motor
    client.initialize();
};
