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

const authorizedGroupsCache = new Map<string, string>();
const AUTH_FOLDER_PATH = process.env.AUTH_FOLDER_PATH || './auth_info';
const CREDS_FILE_PATH = path.join(AUTH_FOLDER_PATH, 'creds.json');

// ── Robust Reconnection State ────────────────────────────────

const BASE_RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 32000;
const SOCKET_HANDSHAKE_TIMEOUT_MS = 30000;

let reconnectAttemptCount = 0;
let reconnectTimer: NodeJS.Timeout | null = null;
let socketHandshakeTimer: NodeJS.Timeout | null = null;
let isReconnectionScheduled = false;
let isManualShutdown = false;

/**
 * Resets the reconnect attempt counter for isolated testing.
 */
export function _resetReconnectAttemptsForTesting(): void {
    reconnectAttemptCount = 0;
}

/**
 * Calculates exponential backoff reconnect delay (2s -> 4s -> 8s -> 16s -> 32s max).
 */
export function calculateReconnectDelay(): number {
    const delay = Math.min(BASE_RECONNECT_DELAY_MS * (2 ** reconnectAttemptCount), MAX_RECONNECT_DELAY_MS);
    reconnectAttemptCount++;
    return delay;
}

// Backward-compatible alias
export const retardoBackoff = calculateReconnectDelay;

/**
 * Safely removes all event listeners and ends the Baileys WebSocket connection.
 */
export function cleanupSocket(sock: Awaited<ReturnType<typeof makeWASocket>>): void {
    try {
        sock.ev.removeAllListeners('connection.update');
        sock.ev.removeAllListeners('messages.upsert');
        sock.ev.removeAllListeners('creds.update');
        sock.end(undefined);
    } catch (error) {
        logger.error('RECONNECT', 'Error cleaning up Baileys socket:', error);
    }
}

// Backward-compatible alias
export const limpiarSocket = cleanupSocket;

function cancelSocketHandshakeTimeout(): void {
    if (socketHandshakeTimer) {
        clearTimeout(socketHandshakeTimer);
        socketHandshakeTimer = null;
    }
}

function scheduleSocketHandshakeTimeout(sock: Awaited<ReturnType<typeof makeWASocket>>): void {
    cancelSocketHandshakeTimeout();
    socketHandshakeTimer = setTimeout(() => {
        socketHandshakeTimer = null;
        logger.warn('RECONNECT', `Socket produced no open connection nor QR code within ${SOCKET_HANDSHAKE_TIMEOUT_MS / 1000}s — resetting socket`);
        cleanupSocket(sock);
        scheduleReconnection();
    }, SOCKET_HANDSHAKE_TIMEOUT_MS);
}

/**
 * Deletes all stored Multi-Device authentication keys in `./auth_info` to force a clean QR re-scan.
 */
export function clearSavedCredentials(): void {
    try {
        if (fs.existsSync(AUTH_FOLDER_PATH)) {
            for (const file of fs.readdirSync(AUTH_FOLDER_PATH)) {
                fs.rmSync(path.join(AUTH_FOLDER_PATH, file), { recursive: true, force: true });
            }
            logger.info('RECONNECT', 'Saved credentials cleared — next connection attempt will generate a fresh QR code');
        }
    } catch (error) {
        logger.error('RECONNECT', 'Error clearing credentials from auth directory:', error);
    }
}

// Backward-compatible alias
export const borrarCredenciales = clearSavedCredentials;

function scheduleReconnection(): void {
    if (isReconnectionScheduled) return;
    isReconnectionScheduled = true;

    const delay = calculateReconnectDelay();
    logger.info('RECONNECT', `Retrying connection in ${(delay / 1000).toFixed(0)}s (attempt ${reconnectAttemptCount})...`);

    reconnectTimer = setTimeout(() => {
        reconnectTimer = null;
        isReconnectionScheduled = false;
        initializeWhatsAppClient().catch(error => {
            logger.error('RECONNECT', 'Error during automatic reconnection attempt:', error);
        });
    }, delay);
}

// ── Baileys Version Checking ─────────────────────────────────

/**
 * Parses semver and release candidate versions into a comparable integer.
 */
export function parseVersionNumber(version: string): number {
    const base = parseInt((version.split('-')[0] ?? '').replace(/\./g, ''), 10) || 0;
    const rc = version.match(/rc(\d+)/);
    return base * 100000 + (rc?.[1] ? parseInt(rc[1], 10) : 0);
}

// Backward-compatible alias
export const extraerNumeroVersion = parseVersionNumber;

/**
 * Checks npm registry for updates to `@whiskeysockets/baileys` to alert about WhatsApp protocol shifts.
 */
export async function checkBaileysVersion(): Promise<void> {
    try {
        const indexFile = require.resolve('@whiskeysockets/baileys');
        const pkgFile = path.resolve(path.dirname(indexFile), '..', 'package.json');
        const installedVersion = (JSON.parse(fs.readFileSync(pkgFile, 'utf8')) as { version: string }).version;

        const response = await fetch('https://registry.npmjs.org/@whiskeysockets/baileys/latest');
        if (!response.ok) return;
        const latestVersion = (await response.json() as { version: string }).version;

        if (parseVersionNumber(latestVersion) > parseVersionNumber(installedVersion)) {
            logger.warn('VERSION', `Newer Baileys version available: ${installedVersion} → ${latestVersion}. Update via: npm install @whiskeysockets/baileys@${latestVersion}`);
        }
    } catch {
        // Non-blocking: network failure or registry timeout is safely ignored at boot
    }
}

// Backward-compatible alias
export const verificarVersionBaileys = checkBaileysVersion;

// ── Disconnection Diagnostics ────────────────────────────────

function extractErrorStatusCode(error: unknown): number | null {
    if (!error || typeof error !== 'object') return null;
    const output = (error as Record<string, unknown>).output;
    if (!output || typeof output !== 'object') return null;
    const statusCode = (output as Record<string, unknown>).statusCode;
    return typeof statusCode === 'number' ? statusCode : null;
}

/**
 * Returns human-readable diagnostic descriptions for WhatsApp WebSocket disconnect codes.
 */
export function describeDisconnectReason(error: unknown): string {
    const statusCode = extractErrorStatusCode(error);
    if (statusCode === null) return 'sin error (cierre normal)';

    const enumName = DisconnectReason[statusCode] as string | undefined;
    const base = enumName ? `${statusCode} (${enumName})` : `${statusCode} (desconocido)`;
    const message = (error as Error | undefined)?.message || '(sin mensaje)';

    const interpretations: Record<number, string> = {
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
    const interpretation = interpretations[statusCode] || '';

    return `código ${base} | mensaje: "${message}" | ${interpretation}`;
}

// Backward-compatible alias
export const describirRazonDesconexion = describeDisconnectReason;

function isLoggedOut(error: unknown): boolean {
    if (!error || typeof error !== 'object') return false;
    const err = error as Record<string, unknown>;
    const output = err.output;
    if (!output || typeof output !== 'object') return false;
    return (output as Record<string, unknown>).statusCode === DisconnectReason.loggedOut;
}

async function loadAuthorizedGroups(sock: Awaited<ReturnType<typeof makeWASocket>>): Promise<void> {
    try {
        const targetGroupNames = (process.env.GRUPO_AUTORIZADO || 'Contabilidad')
            .split(',')
            .map(g => g.trim())
            .filter(Boolean);

        const groups = await sock.groupFetchAllParticipating();
        for (const [jid, metadata] of Object.entries(groups)) {
            if (targetGroupNames.includes(metadata.subject)) {
                authorizedGroupsCache.set(jid, metadata.subject);
            }
        }

        logger.info('CACHE', `Authorized groups cached: ${authorizedGroupsCache.size}`);
    } catch (error) {
        logger.error('CACHE', 'Error fetching authorized groups:', error);
    }
}

/**
 * Extracts raw textual body content from various Baileys message structures.
 */
export function extractMessageBody(msg: WAMessage): string {
    const m = msg.message;
    if (!m) return '';
    if (m.conversation) return m.conversation;
    if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
    return '';
}

// Backward-compatible alias
export const extraerCuerpo = extractMessageBody;

/**
 * Initializes the Baileys WebSocket client connection with Multi-Device file auth state.
 */
export const initializeWhatsAppClient = async (): Promise<void> => {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER_PATH);

    const sock = makeWASocket({
        auth: state,
        browser: Browsers.windows('Chrome'),
        logger: pino({ level: process.env.LOG_BAILEYS === 'info' ? 'info' : 'warn' }),
    });

    const previousSocket = whatsappClient;
    whatsappClient = sock;
    whatsappDestroy = async () => {
        isManualShutdown = true;
        cancelSocketHandshakeTimeout();
        sock.end(undefined);
    };

    if (previousSocket && previousSocket !== sock) {
        cleanupSocket(previousSocket);
    }

    scheduleSocketHandshakeTimeout(sock);

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async ({ connection, lastDisconnect, qr }) => {
        if (qr) {
            cancelSocketHandshakeTimeout();
            logger.info('QR', 'Scan QR code with your WhatsApp client:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'connecting') {
            logger.info('WHATSAPP', 'Connecting to WhatsApp WebSocket gateway...');
        }

        if (connection === 'open') {
            cancelSocketHandshakeTimeout();
            reconnectAttemptCount = 0;
            logger.info('WHATSAPP', '✅ Connected and listening for group messages');
            await loadAuthorizedGroups(sock);
        }

        if (connection === 'close') {
            const error = lastDisconnect?.error;
            const sessionRevoked = isLoggedOut(error);
            logger.info('WHATSAPP', `Connection closed. Reconnect: ${!sessionRevoked}`);
            logger.error('WHATSAPP', `DIAGNOSTIC: ${describeDisconnectReason(error)}`);
            if (error instanceof Error && error.stack) {
                logger.error('WHATSAPP', `DIAGNOSTIC stack: ${error.stack}`);
            }
            logger.info('WHATSAPP', `DIAGNOSTIC credentials on disk: ${fs.existsSync(CREDS_FILE_PATH) ? 'YES (session active)' : 'NO (will require QR pairing)'}`);

            cancelSocketHandshakeTimeout();
            cleanupSocket(sock);

            if (isManualShutdown) return;

            if (sessionRevoked) {
                logger.warn('RECONNECT', 'Session revoked — clearing saved credentials to generate new QR pairing');
                clearSavedCredentials();
                reconnectAttemptCount = 0;
            }

            scheduleReconnection();
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg || !msg.key) return;
        if (m.type !== 'notify') return;

        const remoteJid = msg.key.remoteJid;
        if (!remoteJid) return;
        if (!remoteJid.endsWith('@g.us')) return;

        const chatName = authorizedGroupsCache.get(remoteJid);
        if (!chatName) return;

        try {
            logger.info('WHATSAPP', `Message received in authorized group: ${chatName}`);

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
                    logger.error('DOWNLOAD', 'Error downloading image payload:', err);
                }
            }

            const ctx: IncomingMessage = {
                messageId,
                chatId: remoteJid,
                chatName,
                body: extractMessageBody(msg),
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
            logger.error('WHATSAPP', 'Error processing incoming WhatsApp message:', error);
        }
    });
};

// Backward-compatible alias
export const initializeWhatsApp = initializeWhatsAppClient;
