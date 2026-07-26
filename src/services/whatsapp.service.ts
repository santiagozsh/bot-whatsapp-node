import { makeWASocket, useMultiFileAuthState, DisconnectReason, downloadContentFromMessage, toBuffer } from '@whiskeysockets/baileys';
import type { WAMessage } from '@whiskeysockets/baileys';
import * as qrcode from 'qrcode-terminal';
import { procesarMensajeEntrante } from '../controllers/message.controller';
import type { MensajeEntrante, MediaData } from '../controllers/message.controller';
import pino from 'pino';
import { logger } from '../utils/logger';

export let whatsappClient: Awaited<ReturnType<typeof makeWASocket>> | null = null;
export let whatsappDestroy: (() => Promise<void>) | null = null;

const gruposCache = new Map<string, string>();
let reconnectando = false;

function isLoggedOut(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const err = error as Record<string, unknown>;
    const output = err.output;
    if (!output || typeof output !== 'object') return false;
    return (output as Record<string, unknown>).statusCode === DisconnectReason.loggedOut;
}

async function cargarGruposAutorizados(sock: Awaited<ReturnType<typeof makeWASocket>>): Promise<void> {
    try {
        const nombresBuscados = (process.env.GRUPO_AUTORIZADO || 'Contabilidad')
            .split(',')
            .map(g => g.trim())
            .filter(Boolean);

        const groups = await sock.groupFetchAllParticipating();
        for (const [jid, metadata] of Object.entries(groups)) {
            if (nombresBuscados.includes(metadata.subject)) {
                gruposCache.set(jid, metadata.subject);
            }
        }

        logger.info('CACHE', `Grupos autorizados: ${gruposCache.size}`);
    } catch (error) {
        logger.error('CACHE', 'Error al cargar grupos:', error);
    }
}

function extraerCuerpo(msg: WAMessage): string {
    const m = msg.message;
    if (!m) return '';
    if (m.conversation) return m.conversation;
    if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
    return '';
}

export const initializeWhatsApp = async (): Promise<void> => {
    const { state, saveCreds } = await useMultiFileAuthState('./auth_info');

    const sock = makeWASocket({
        auth: state,
        logger: pino({ level: 'warn' }),
    });

    whatsappClient = sock;
    whatsappDestroy = async () => { sock.end(undefined); };

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            logger.info('QR', 'Escanea el código QR con tu WhatsApp:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'open') {
            reconnectando = false;
            logger.info('WHATSAPP', '✅ Conectado y escuchando mensajes');
            await cargarGruposAutorizados(sock);
        }

        if (connection === 'close') {
            const shouldReconnect = !isLoggedOut(lastDisconnect?.error);
            logger.info('WHATSAPP', `Conexión cerrada. Reconnect: ${shouldReconnect}`);
            if (shouldReconnect && !reconnectando) {
                reconnectando = true;
                initializeWhatsApp();
            }
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg || !msg.key) return;
        if (m.type !== 'notify') return;

        const remoteJid = msg.key.remoteJid;
        if (!remoteJid) return;
        if (!remoteJid.endsWith('@g.us')) return;

        const chatName = gruposCache.get(remoteJid);
        if (!chatName) return;

        try {
            logger.info('WHATSAPP', `Mensaje en ${chatName}`);

            const messageId = msg.key.id;
            if (!messageId) return;

            const mimetype = msg.message?.imageMessage?.mimetype;
            const ci = msg.message?.extendedTextMessage?.contextInfo;

            let media: MediaData | undefined;

            if (mimetype && !mimetype.includes('webp')) {
                try {
                    const stream = await downloadContentFromMessage(msg.message!.imageMessage!, 'image');
                    const buffer = await toBuffer(stream);
                    media = { data: buffer.toString('base64'), mimetype };
                } catch (err) {
                    logger.error('DOWNLOAD', 'Error descargando imagen:', err);
                }
            }

            const ctx: MensajeEntrante = {
                messageId,
                chatId: remoteJid,
                chatName,
                body: extraerCuerpo(msg),
                hasMedia: !!(
                    msg.message?.imageMessage ||
                    msg.message?.videoMessage ||
                    msg.message?.audioMessage ||
                    msg.message?.stickerMessage
                ),
                hasQuotedMsg: !!ci?.stanzaId,
                ...(mimetype ? { mediaMimetype: mimetype } : {}),
                ...(ci?.stanzaId ? { quotedMsgId: ci.stanzaId } : {}),
                ...(ci?.quotedMessage?.conversation ? { quotedBody: ci.quotedMessage.conversation } : {}),
                ...(ci?.quotedMessage?.extendedTextMessage?.text ? { quotedBody: ci.quotedMessage.extendedTextMessage.text } : {}),
                ...(media ? { media } : {}),
            };

            await procesarMensajeEntrante(ctx);
        } catch (error) {
            logger.error('WHATSAPP', 'Error al procesar mensaje:', error);
        }
    });
};
