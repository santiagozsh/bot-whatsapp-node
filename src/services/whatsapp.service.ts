import { makeWASocket, useMultiFileAuthState, DisconnectReason, downloadContentFromMessage, toBuffer, Browsers } from '@whiskeysockets/baileys';
import type { WAMessage } from '@whiskeysockets/baileys';
import * as qrcode from 'qrcode-terminal';
import * as fs from 'fs';
import * as path from 'path';
import { processIncomingMessage } from '../controllers/message.controller';
import type { IncomingMessage, MediaData } from '../controllers/message.controller';
import pino from 'pino';
import { logger } from '../utils/logger';

export let whatsappClient: Awaited<ReturnType<typeof makeWASocket>> | null = null;
export let whatsappDestroy: (() => Promise<void>) | null = null;

const gruposCache = new Map<string, string>();
const RUTA_CREDS = './auth_info/creds.json';
const RUTA_AUTH = './auth_info';

// ── Estado de reconexión robusta ──────────────────────────────

const RETARDO_BASE_MS = 2000;
const RETARDO_MAX_MS = 32000;
const TIMEOUT_SOCKET_MS = 30000;

let intentoReconexion = 0;
let timerReconexion: NodeJS.Timeout | null = null;
let timeoutSocket: NodeJS.Timeout | null = null;
let desconexionProgramada = false;
let apagadoManual = false;

function retardoBackoff(): number {
    const retardo = Math.min(RETARDO_BASE_MS * 2 ** intentoReconexion, RETARDO_MAX_MS);
    intentoReconexion++;
    return retardo;
}

function limpiarSocket(sock: Awaited<ReturnType<typeof makeWASocket>>): void {
    try {
        sock.ev.removeAllListeners('connection.update');
        sock.ev.removeAllListeners('messages.upsert');
        sock.ev.removeAllListeners('creds.update');
        sock.end(undefined);
    } catch (error) {
        logger.error('RECONEXIÓN', 'Error limpiando socket:', error);
    }
}

function cancelarTimeoutSocket(): void {
    if (timeoutSocket) {
        clearTimeout(timeoutSocket);
        timeoutSocket = null;
    }
}

function programarTimeoutSocket(sock: Awaited<ReturnType<typeof makeWASocket>>): void {
    cancelarTimeoutSocket();
    timeoutSocket = setTimeout(() => {
        timeoutSocket = null;
        logger.warn('RECONEXIÓN', `Socket sin conexión abierta ni QR en ${TIMEOUT_SOCKET_MS / 1000}s — reiniciando`);
        limpiarSocket(sock);
        programarReconexion();
    }, TIMEOUT_SOCKET_MS);
}

function borrarCredenciales(): void {
    try {
        if (fs.existsSync(RUTA_AUTH)) {
            for (const archivo of fs.readdirSync(RUTA_AUTH)) {
                fs.rmSync(path.join(RUTA_AUTH, archivo), { recursive: true, force: true });
            }
            logger.info('RECONEXIÓN', 'Credenciales borradas — el próximo intento pedirá QR');
        }
    } catch (error) {
        logger.error('RECONEXIÓN', 'Error borrando credenciales:', error);
    }
}

function programarReconexion(): void {
    if (desconexionProgramada) return;
    desconexionProgramada = true;

    const retardo = retardoBackoff();
    logger.info('RECONEXIÓN', `Reintentando en ${(retardo / 1000).toFixed(0)}s (intento ${intentoReconexion})...`);

    timerReconexion = setTimeout(() => {
        timerReconexion = null;
        desconexionProgramada = false;
        initializeWhatsApp().catch(error => {
            logger.error('RECONEXIÓN', 'Error al reconectar:', error);
        });
    }, retardo);
}

// ── Verificación de versión de Baileys ─────────────────────────

function extraerNumeroVersion(version: string): number {
    const base = parseInt((version.split('-')[0] ?? '').replace(/\./g, ''), 10) || 0;
    const rc = version.match(/rc(\d+)/);
    return base * 100000 + (rc?.[1] ? parseInt(rc[1], 10) : 0);
}

export async function verificarVersionBaileys(): Promise<void> {
    try {
        const rutaIndex = require.resolve('@whiskeysockets/baileys');
        const rutaPkg = path.resolve(path.dirname(rutaIndex), '..', 'package.json');
        const instalada = (JSON.parse(fs.readFileSync(rutaPkg, 'utf8')) as { version: string }).version;

        const resp = await fetch('https://registry.npmjs.org/@whiskeysockets/baileys/latest');
        if (!resp.ok) return;
        const ultima = (await resp.json() as { version: string }).version;

        if (extraerNumeroVersion(ultima) > extraerNumeroVersion(instalada)) {
            logger.warn('VERSIÓN', `Hay versión nueva de Baileys: ${instalada} → ${ultima}. Actualiza con: npm install @whiskeysockets/baileys@${ultima}`);
        }
    } catch {
        // silencioso: sin red o error del registro no bloquea el arranque
    }
}

// ── Diagnóstico de desconexión ─────────────────────────────────

function extraerStatusDelError(error: unknown): number | null {
    if (!error || typeof error !== 'object') return null;
    const output = (error as Record<string, unknown>).output;
    if (!output || typeof output !== 'object') return null;
    const statusCode = (output as Record<string, unknown>).statusCode;
    return typeof statusCode === 'number' ? statusCode : null;
}

function describirRazonDesconexion(error: unknown): string {
    const statusCode = extraerStatusDelError(error);
    if (statusCode === null) return 'sin error (cierre normal)';

    const nombreEnum = DisconnectReason[statusCode] as string | undefined;
    const base = nombreEnum ? `${statusCode} (${nombreEnum})` : `${statusCode} (desconocido)`;
    const mensaje = (error as Error | undefined)?.message || '(sin mensaje)';

    const interpretaciones: Record<number, string> = {
        [DisconnectReason.loggedOut]: 'SESIÓN REVOCADA: el teléfono mató/desplazó la sesión',
        [DisconnectReason.connectionReplaced]: 'SESIÓN DESPLAZADA: límite de 4 dispositivos o socket duplicado',
        [DisconnectReason.connectionClosed]: 'CONEXIÓN CERRADA por WhatsApp',
        [DisconnectReason.connectionLost]: 'CONEXIÓN PERDIDA (sin respuesta del servidor)',
        [DisconnectReason.badSession]: 'SESIÓN CORRUPTA (credenciales inválidas)',
        [DisconnectReason.forbidden]: 'PROHIBIDO (403): rechazo del servidor',
        [DisconnectReason.unavailableService]: 'SERVICIO NO DISPONIBLE (503)',
        [DisconnectReason.restartRequired]: 'REINICIO REQUERIDO por el protocolo',
        [DisconnectReason.multideviceMismatch]: 'CONFLICTO DE MULTIDISPOSITIVO',
        405: 'REGISTRO RECHAZADO (rate limit/throttle de WhatsApp)',
    };
    const interpretacion = interpretaciones[statusCode] || '';

    return `código ${base} | mensaje: "${mensaje}" | ${interpretacion}`;
}

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
    if (timerReconexion) {
        clearTimeout(timerReconexion);
        timerReconexion = null;
    }

    const { state, saveCreds } = await useMultiFileAuthState(RUTA_AUTH);

    const sock = makeWASocket({
        auth: state,
        browser: Browsers.windows('Chrome'),
        logger: pino({ level: process.env.LOG_BAILEYS === 'info' ? 'info' : 'warn' }),
    });

    const socketAnterior = whatsappClient;
    whatsappClient = sock;
    whatsappDestroy = async () => {
        apagadoManual = true;
        cancelarTimeoutSocket();
        sock.end(undefined);
    };

    if (socketAnterior && socketAnterior !== sock) {
        limpiarSocket(socketAnterior);
    }

    programarTimeoutSocket(sock);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            cancelarTimeoutSocket();
            logger.info('QR', 'Escanea el código QR con tu WhatsApp:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'connecting') {
            logger.info('WHATSAPP', 'Conectando al servidor de WhatsApp...');
        }

        if (connection === 'open') {
            cancelarTimeoutSocket();
            intentoReconexion = 0;
            logger.info('WHATSAPP', '✅ Conectado y escuchando mensajes');
            await cargarGruposAutorizados(sock);
        }

        if (connection === 'close') {
            const error = lastDisconnect?.error;
            const sesionRevocada = isLoggedOut(error);
            logger.info('WHATSAPP', `Conexión cerrada. Reconnect: ${!sesionRevocada}`);
            logger.error('WHATSAPP', `DIAGNÓSTICO: ${describirRazonDesconexion(error)}`);
            if (error instanceof Error && error.stack) {
                logger.error('WHATSAPP', `DIAGNÓSTICO stack: ${error.stack}`);
            }
            logger.info('WHATSAPP', `DIAGNÓSTICO credenciales en disco: ${fs.existsSync(RUTA_CREDS) ? 'SÍ existen (sesión guardada)' : 'NO existen (pedirá QR/registro)'}`);

            cancelarTimeoutSocket();
            limpiarSocket(sock);

            if (apagadoManual) return;

            if (sesionRevocada) {
                logger.warn('RECONEXIÓN', 'Sesión revocada — borrando credenciales para pedir QR nuevo');
                borrarCredenciales();
                intentoReconexion = 0;
            }

            programarReconexion();
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

            const ctx: IncomingMessage = {
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

            await processIncomingMessage(ctx);
        } catch (error) {
            logger.error('WHATSAPP', 'Error al procesar mensaje:', error);
        }
    });
};
