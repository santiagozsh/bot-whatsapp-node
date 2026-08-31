import { makeWASocket, useMultiFileAuthState, DisconnectReason, downloadContentFromMessage, toBuffer, Browsers } from '@whiskeysockets/baileys';
import type { WAMessage, CacheStore } from '@whiskeysockets/baileys';
import * as qrcode from 'qrcode-terminal';
import * as fs from 'fs';
import * as path from 'path';
import { processIncomingMessage } from '../controllers/message.controller';
import type { IncomingMessage, MediaData } from '../controllers/message.controller';
import { logger, createSilentBaileysLogger } from '../utils/logger';
import { setWhatsAppConnectionMetric } from './metrics.service';

export let whatsappClient: Awaited<ReturnType<typeof makeWASocket>> | null = null;
export let whatsappDestroy: (() => Promise<void>) | null = null;

const authorizedGroupsCache = new Map<string, string>();
const AUTH_FOLDER_PATH = process.env.AUTH_FOLDER_PATH || './auth_info';
const CREDS_FILE_PATH = path.join(AUTH_FOLDER_PATH, 'creds.json');

// ── In-Memory Cache Store for Retries ─────────────────────────

/**
 * Creates an in-memory CacheStore instance conforming to Baileys CacheStore interface.
 */
export function createInMemoryCacheStore(): CacheStore {
    const store = new Map<string, any>();
    return {
        get<T>(key: string): T | undefined {
            return store.get(key) as T | undefined;
        },
        set<T>(key: string, value: T): void {
            store.set(key, value);
        },
        del(key: string): void {
            store.delete(key);
        },
        flushAll(): void {
            store.clear();
        },
    };
}

// ── Robust Reconnection State ────────────────────────────────

const BASE_RECONNECT_DELAY_MS = 2000;
const MAX_RECONNECT_DELAY_MS = 32000;
const FAST_TRACK_RECONNECT_DELAY_MS = 1000;
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
 * Calculates reconnect delay with fast-track recovery for transient disconnects
 * (code 428 connectionClosed, 515 restartRequired) and exponential backoff for others.
 */
export function calculateReconnectDelay(statusCode?: number | null): number {
    if (statusCode === DisconnectReason.connectionClosed || statusCode === DisconnectReason.restartRequired) {
        return FAST_TRACK_RECONNECT_DELAY_MS;
    }

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

function scheduleReconnection(statusCode?: number | null): void {
    if (isReconnectionScheduled) return;
    isReconnectionScheduled = true;

    const delay = calculateReconnectDelay(statusCode);
    logger.info('RECONNECT', `Retrying connection in ${(delay / 1000).toFixed(1)}s (attempt ${reconnectAttemptCount})...`);

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
        const targetGroupNames = (process.env.AUTHORIZED_GROUPS || process.env.GRUPO_AUTORIZADO || 'Contabilidad')
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
 * Resolves the authorized group name for a JID, checking the cache first and falling back
 * to an on-demand sock.groupMetadata() query to prevent dropped messages during reconnect race conditions.
 */
export async function resolveAuthorizedGroupName(
    sock: Awaited<ReturnType<typeof makeWASocket>>,
    remoteJid: string
): Promise<string | null> {
    if (!remoteJid || !remoteJid.endsWith('@g.us')) return null;

    const cached = authorizedGroupsCache.get(remoteJid);
    if (cached) return cached;

    const targetGroupNames = (process.env.AUTHORIZED_GROUPS || process.env.GRUPO_AUTORIZADO || 'Contabilidad')
        .split(',')
        .map(g => g.trim())
        .filter(Boolean);

    try {
        const metadata = await sock.groupMetadata(remoteJid);
        if (metadata?.subject && targetGroupNames.includes(metadata.subject)) {
            authorizedGroupsCache.set(remoteJid, metadata.subject);
            logger.info('CACHE', `Dynamically resolved authorized group: ${metadata.subject} (${remoteJid})`);
            return metadata.subject;
        }
    } catch (error) {
        logger.debug('CACHE', `Could not resolve group metadata for ${remoteJid}:`, error);
    }

    return null;
}

function unwrapMessageContent(msg: WAMessage): any {
    const raw = msg.message;
    if (!raw) return null;
    return (
        raw.ephemeralMessage?.message ||
        raw.viewOnceMessage?.message ||
        raw.viewOnceMessageV2?.message ||
        raw.documentWithCaptionMessage?.message ||
        raw
    );
}

/**
 * Extracts raw textual body content from various Baileys message structures (including ephemeral/view-once wrappers).
 */
export function extractMessageBody(msg: WAMessage): string {
    const m = unwrapMessageContent(msg);
    if (!m) return '';
    if (m.conversation) return m.conversation;
    if (m.extendedTextMessage?.text) return m.extendedTextMessage.text;
    return '';
}

// Backward-compatible alias
export const extraerCuerpo = extractMessageBody;

/**
 * Processes a single incoming WAMessage after resolving group authorization and downloading media.
 */
export async function handleIncomingWhatsAppMessage(
    sock: Awaited<ReturnType<typeof makeWASocket>>,
    msg: WAMessage
): Promise<void> {
    if (!msg || !msg.key) return;

    const remoteJid = msg.key.remoteJid;
    if (!remoteJid || !remoteJid.endsWith('@g.us')) return;

    const chatName = await resolveAuthorizedGroupName(sock, remoteJid);
    if (!chatName) return;

    try {
        logger.info('WHATSAPP', `Message received in authorized group: ${chatName}`);

        const messageId = msg.key.id;
        if (!messageId) return;

        const content = unwrapMessageContent(msg);
        const imageMessage = content?.imageMessage;
        const mimetype = imageMessage?.mimetype;
        const ci = content?.extendedTextMessage?.contextInfo || imageMessage?.contextInfo;

        let media: MediaData | undefined;

        if (mimetype && !mimetype.includes('webp') && imageMessage) {
            try {
                const stream = await downloadContentFromMessage(imageMessage, 'image');
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
                imageMessage ||
                content?.videoMessage ||
                content?.audioMessage ||
                content?.stickerMessage
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
}

/**
 * Handles batch messages.upsert events, iterating sequentially through ALL messages in the burst
 * to prevent dropped transactions during post-reconnect catchup.
 */
export async function handleMessagesUpsert(
    sock: Awaited<ReturnType<typeof makeWASocket>>,
    m: { messages: WAMessage[]; type: string }
): Promise<void> {
    if (!m.messages || m.messages.length === 0) return;

    for (const msg of m.messages) {
        await handleIncomingWhatsAppMessage(sock, msg);
    }
}

/**
 * Initializes the Baileys WebSocket client connection with Multi-Device file auth state
 * and hardened connection/keep-alive options.
 */
export const initializeWhatsAppClient = async (): Promise<void> => {
    if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
    }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_FOLDER_PATH);
    const msgRetryCounterCache = createInMemoryCacheStore();

    const sock = makeWASocket({
        auth: state,
        browser: Browsers.windows('Chrome'),
        logger: createSilentBaileysLogger(),
        keepAliveIntervalMs: 15_000,
        syncFullHistory: false,
        markOnlineOnConnect: true,
        defaultQueryTimeoutMs: 60_000,
        connectTimeoutMs: 30_000,
        retryRequestDelayMs: 250,
        maxMsgRetryCount: 5,
        msgRetryCounterCache,
        getMessage: async (_key) => undefined,
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
            setWhatsAppConnectionMetric(-1);
            logger.info('QR', 'Scan QR code with your WhatsApp client:');
            qrcode.generate(qr, { small: true });
        }

        if (connection === 'connecting') {
            setWhatsAppConnectionMetric(0);
            logger.info('WHATSAPP', 'Connecting to WhatsApp WebSocket gateway...');
        }

        if (connection === 'open') {
            cancelSocketHandshakeTimeout();
            setWhatsAppConnectionMetric(1);
            reconnectAttemptCount = 0;
            logger.info('WHATSAPP', '✅ Connected and listening for group messages');
            await loadAuthorizedGroups(sock);
        }

        if (connection === 'close') {
            const error = lastDisconnect?.error;
            const statusCode = extractErrorStatusCode(error);
            const sessionRevoked = isLoggedOut(error);

            cancelSocketHandshakeTimeout();
            cleanupSocket(sock);

            if (isManualShutdown) {
                setWhatsAppConnectionMetric(0);
                return;
            }

            if (sessionRevoked) {
                setWhatsAppConnectionMetric(-1);
                logger.warn('WHATSAPP', 'Session revoked — clearing saved credentials to generate new QR pairing');
                clearSavedCredentials();
                reconnectAttemptCount = 0;
            } else if (statusCode === DisconnectReason.restartRequired) {
                setWhatsAppConnectionMetric(0);
                logger.debug('WHATSAPP', 'Restart required by protocol handshake (reconnecting)');
            } else {
                setWhatsAppConnectionMetric(0);
                logger.warn('WHATSAPP', `Connection closed: ${describeDisconnectReason(error)}`);
            }

            logger.debug('WHATSAPP', 'Disconnect details:', error);

            scheduleReconnection(statusCode);
        }
    });

    sock.ev.on('messages.upsert', async (m) => {
        await handleMessagesUpsert(sock, m);
    });
};

// Backward-compatible alias
export const initializeWhatsApp = initializeWhatsAppClient;
