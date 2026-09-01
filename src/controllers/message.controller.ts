import { extractAccountingDataFromOcr, extractCustomerDataFromText, optimizeImageForOcr } from '../services/ai.service';
import { appendIncomeRow, appendSalesRow, enrichSalesRow, updateIncomeRow } from '../services/sheets.service';
import { saveTransaction, updateSalesRowIndex, findTransactionByMessageId, findTransactionByPaymentReference, findTransactionByOrderNumber } from '../services/memory.service';
import { extractTextWithVisionEnhanced } from '../services/vision.service';
import { formatDate, normalizeOcrText, isUsefulText, detectBankByColor } from '../utils/helpers';
import { logger } from '../utils/logger';
import { recordMessageProcessed } from '../services/metrics.service';
import type { IncomeData, CustomerData } from '../types';

// ── Constants ────────────────────────────────────────────────

const CONTEXT_TTL_MS = parseInt(process.env.TIEMPO_TTL_CONTEXTO || '14400000', 10);
const FALLBACK_CLOSING_TIMEOUT_MS = parseInt(process.env.TIEMPO_CIERRE_RESPALDO || '14400000', 10);

const FINANCIAL_KEYWORDS = [
    'nequi', 'bancolombia', 'davivienda', 'daviplata',
    'transferencia', 'comprobante', 'pago', 'valor',
    'total', 'cuenta', 'ahorros', 'corriente',
    'recibido', 'recibí', 'consignacion', 'consignación',
    'transaccion', 'transacción', 'exitoso', 'enviaste',
    'origen', 'destino', 'titular', 'referencia',
    'movimiento', 'pse', 'bbva', 'nu', 'bancamia',
    'aprobado', 'autorizacion', 'autorización',
];

// ── Types ────────────────────────────────────────────────────

export interface IncomingMessage {
    messageId: string;
    chatId: string;
    chatName: string;
    body: string;
    hasMedia: boolean;
    mediaMimetype?: string;
    hasQuotedMsg: boolean;
    quotedMsgId?: string;
    quotedBody?: string;
    media?: MediaData;
}

// Backward-compatible alias
export type MensajeEntrante = IncomingMessage;

export interface MediaData {
    data: string;
    mimetype: string;
}

export interface ContextItem {
    text: string;
    timestamp: number;
}

export interface PendingTransaction {
    orderNumber: string;
    messageId: string;
    date: string;
}

// ── In-Memory Chat State ─────────────────────────────────────

const contextByChatId = new Map<string, ContextItem[]>();
const activeTransactionByChatId = new Map<string, PendingTransaction | null>();
const queuesByChatId = new Map<string, Promise<void>>();
const fallbackTimersByChatId = new Map<string, NodeJS.Timeout>();

/**
 * Resets in-memory controller state for isolated testing.
 */
export function _clearControllerStateForTesting(): void {
    contextByChatId.clear();
    activeTransactionByChatId.clear();
    queuesByChatId.clear();
    for (const timer of fallbackTimersByChatId.values()) {
        clearTimeout(timer);
    }
    fallbackTimersByChatId.clear();
}

/**
 * Retrieves the raw accumulated chat context string for a chat ID (used in testing).
 */
export function _getChatContextForTesting(chatId: string): string {
    return getChatContext(chatId);
}

/**
 * Retrieves the currently active pending transaction for a chat ID (used in testing).
 */
export function _getActiveTransactionForTesting(chatId: string): { nPedido: string; messageId: string } | null {
    const tx = activeTransactionByChatId.get(chatId);
    if (!tx) return null;
    return { nPedido: tx.orderNumber, messageId: tx.messageId };
}

// ── Context Management Helpers ───────────────────────────────

function appendToChatContext(chatId: string, text: string): void {
    if (!text || text === 'SIN_TEXTO_DETECTADO') return;

    const now = Date.now();
    const ttl = CONTEXT_TTL_MS;

    if (!contextByChatId.has(chatId)) {
        contextByChatId.set(chatId, []);
    }

    const items = contextByChatId.get(chatId)!;
    const activeItems = items.filter(item => now - item.timestamp <= ttl);
    activeItems.push({ text, timestamp: now });
    contextByChatId.set(chatId, activeItems);
}

function getChatContext(chatId: string): string {
    const items = contextByChatId.get(chatId);
    if (!items || items.length === 0) return '';

    const now = Date.now();
    const ttl = CONTEXT_TTL_MS;
    const activeItems = items.filter(item => now - item.timestamp <= ttl);
    contextByChatId.set(chatId, activeItems);

    return activeItems.map(item => item.text).join('\n');
}

// ── Per-Chat Concurrency Queue ───────────────────────────────

async function enqueueChatOperation(chatId: string, fn: () => Promise<void>): Promise<void> {
    const previousOperation = queuesByChatId.get(chatId) || Promise.resolve();
    const currentOperation = previousOperation.then(fn).catch(err => {
        logger.error('QUEUE', `Error in serialized queue operation for ${chatId}:`, err);
    });
    queuesByChatId.set(chatId, currentOperation);
    await currentOperation;
}

// ── Receipt Detection & Helpers ──────────────────────────────

function containsFinancialKeywords(text: string): boolean {
    if (!text || text === 'SIN_TEXTO_DETECTADO') return false;
    const lowerText = text.toLowerCase();
    return FINANCIAL_KEYWORDS.some(keyword => lowerText.includes(keyword));
}

function getTodayFormattedString(): string {
    const d = new Date();
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
}

// ── Transaction Lifecycle: Closing & Persisting Sales ────────

function hasUsefulSalesData(data: CustomerData): boolean {
    const hasProducts = Boolean(data.producto && data.producto !== 'N/A');
    const hasQuantities = (data.cantidadRelojes ?? 0) > 0 || (data.cantidadOtros ?? 0) > 0;
    const hasCustomerName = Boolean(data.nombreCliente && data.nombreCliente !== 'N/A');
    return hasProducts || hasQuantities || hasCustomerName;
}

async function persistOrEnrichSale(
    customerData: CustomerData,
    orderNumber: string,
    messageId: string,
    dateString: string,
    existingSalesRow: number | null
): Promise<void> {
    const formattedDate = formatDate(dateString);

    if (existingSalesRow === null) {
        const newSalesRow = await appendSalesRow(customerData, orderNumber, formattedDate);
        if (newSalesRow > 0) {
            updateSalesRowIndex(messageId, newSalesRow);
        }
    } else {
        await enrichSalesRow(existingSalesRow, customerData);
    }
}

/**
 * Closes the previously active open transaction by reading accumulated chat context,
 * invoking Prompt B to extract customer/shipping data, and writing the row to `Ventas`.
 */
async function closePreviousTransaction(chatId: string): Promise<void> {
    const transaction = activeTransactionByChatId.get(chatId);
    if (!transaction) return;

    const contextText = getChatContext(chatId);

    if (!contextText) {
        contextByChatId.delete(chatId);
        activeTransactionByChatId.set(chatId, null);
        return;
    }

    logger.info('CLOSE', `Closing Sales for ${transaction.orderNumber} (${contextText.split('\n').length} items in context)`);

    const customerData = await extractCustomerDataFromText(contextText);
    if (!customerData) {
        contextByChatId.delete(chatId);
        activeTransactionByChatId.set(chatId, null);
        return;
    }

    const txRecord = findTransactionByMessageId(transaction.messageId);
    if (customerData.vendedor && customerData.vendedor !== 'N/A' && txRecord) {
        await updateIncomeRow(txRecord.filaIngreso, { vendedor: customerData.vendedor });
    }

    if (!hasUsefulSalesData(customerData)) {
        logger.info('CLOSE', 'No useful sales data found in context to persist');
        contextByChatId.delete(chatId);
        activeTransactionByChatId.set(chatId, null);
        return;
    }

    if (!txRecord) {
        contextByChatId.delete(chatId);
        activeTransactionByChatId.set(chatId, null);
        return;
    }

    await persistOrEnrichSale(customerData, transaction.orderNumber, transaction.messageId, transaction.date, txRecord.filaVenta);

    contextByChatId.delete(chatId);
    activeTransactionByChatId.set(chatId, null);
}

// ── Inactivity Fallback Timer ────────────────────────────────

function scheduleFallbackClosingTimer(chatId: string): void {
    const existingTimer = fallbackTimersByChatId.get(chatId);
    if (existingTimer) clearTimeout(existingTimer);

    const timer = setTimeout(async () => {
        fallbackTimersByChatId.delete(chatId);
        await enqueueChatOperation(chatId, async () => {
            if (activeTransactionByChatId.get(chatId)) {
                logger.info('FALLBACK', `Closing active transaction due to inactivity (${FALLBACK_CLOSING_TIMEOUT_MS / 1000 / 60 / 60}h timeout)`);
                await closePreviousTransaction(chatId);
            }
        });
    }, FALLBACK_CLOSING_TIMEOUT_MS);

    fallbackTimersByChatId.set(chatId, timer);
}

// ── Image Processing Pipeline ────────────────────────────────

async function preprocessImage(media: MediaData): Promise<string> {
    const mimeType = media.mimetype || 'image/jpeg';
    return normalizeOcrText(await extractTextWithVisionEnhanced(media.data, mimeType));
}

function handleNonReceiptImage(chatId: string, ocrText: string): void {
    if (ocrText && ocrText !== 'SIN_TEXTO_DETECTADO' && isUsefulText(ocrText)) {
        appendToChatContext(chatId, ocrText);
        logger.info('IMAGE', `Non-financial image OCR text accumulated in context (${ocrText.length} chars)`);
    } else {
        logger.info('IMAGE', 'Non-financial image with no useful text — discarded (0 tokens)');
    }
}

async function recordIncomeReceipt(
    incomeData: IncomeData,
    ctx: IncomingMessage
): Promise<void> {
    const result = await appendIncomeRow(incomeData);
    if (!result) {
        logger.error('IMAGE', 'Error appending income row to Google Sheets');
        return;
    }

    const { nPedido, filaIngreso } = result;

    saveTransaction(ctx.messageId, nPedido, filaIngreso, incomeData.referenciaDePago || null);

    activeTransactionByChatId.set(ctx.chatId, { orderNumber: nPedido, messageId: ctx.messageId, date: incomeData.fecha });

    scheduleFallbackClosingTimer(ctx.chatId);

    recordMessageProcessed('receipt', 'processed');
    logger.info('IMAGE', `✅ ${nPedido} registered (row ${filaIngreso})`);
}

async function handleReceipt(
    ocrText: string,
    ctx: IncomingMessage,
    bankByColor?: string
): Promise<void> {
    logger.info('IMAGE', 'Financial receipt detected -> invoking OpenAI Prompt A');

    await closePreviousTransaction(ctx.chatId);

    const contextForPromptA = getChatContext(ctx.chatId);
    const MAX_CONTEXT_CHARS = 300;
    const truncatedContext = contextForPromptA.length > MAX_CONTEXT_CHARS
        ? contextForPromptA.substring(0, MAX_CONTEXT_CHARS) + '...'
        : (contextForPromptA || 'No hay contexto de texto para esta imagen.');

    const extractedData = await extractAccountingDataFromOcr(ocrText, truncatedContext, bankByColor);

    if (!extractedData || !extractedData.esComprobanteValido) {
        recordMessageProcessed('receipt', 'ignored');
        logger.info('IMAGE', 'Image rejected as invalid financial receipt');
        return;
    }

    const rawRef = (extractedData.referenciaDePago || '').trim().toLowerCase();
    const hasValidReference = rawRef
        && rawRef !== 'n/a'
        && rawRef !== 'no identificado'
        && rawRef !== 'no detectado';

    if (hasValidReference) {
        const existingTx = findTransactionByPaymentReference(extractedData.referenciaDePago);
        if (existingTx) {
            recordMessageProcessed('receipt', 'duplicate');
            logger.info('IMAGE', `Duplicate payment reference rejected: ${extractedData.referenciaDePago} = ${existingTx.nPedido}`);
            return;
        }
    }

    await recordIncomeReceipt(extractedData, ctx);
}

async function processImageMessage(media: MediaData, ctx: IncomingMessage): Promise<void> {
    logger.info('IMAGE', 'Processing incoming image payload...');

    const ocrText = await preprocessImage(media);
    const bankByColor = await detectBankByColor(media.data);
    const isFinancial = containsFinancialKeywords(ocrText) || Boolean(bankByColor && bankByColor !== 'No detectado');

    if (!isFinancial) {
        handleNonReceiptImage(ctx.chatId, ocrText);
        return;
    }

    await handleReceipt(ocrText, ctx, bankByColor);
}

// ── Plain Text Processing ────────────────────────────────────

async function processPlainTextMessage(ctx: IncomingMessage): Promise<void> {
    appendToChatContext(ctx.chatId, ctx.body);
    recordMessageProcessed('text', 'processed');
    logger.info('TEXT', `-> accumulated in context: "${ctx.body.substring(0, 50)}..."`);
}

// ── Quoted / Reply Text Processing ───────────────────────────

async function processQuotedTextMessage(ctx: IncomingMessage): Promise<void> {
    const quotedId = ctx.quotedMsgId;
    if (!quotedId) {
        logger.warn('REPLY', 'Missing quotedMsgId -> appending to context');
        appendToChatContext(ctx.chatId, ctx.body);
        return;
    }

    const activeTransaction = activeTransactionByChatId.get(ctx.chatId);
    if (activeTransaction && activeTransaction.messageId === quotedId) {
        appendToChatContext(ctx.chatId, ctx.body);
        recordMessageProcessed('reply', 'processed');
        logger.info('REPLY', `Associated with active open transaction ${activeTransaction.orderNumber}`);

        const customerData = await extractCustomerDataFromText(ctx.body);
        if (!customerData) return;

        const txRecord = findTransactionByMessageId(activeTransaction.messageId);
        if (txRecord && customerData.vendedor && customerData.vendedor !== 'N/A') {
            await updateIncomeRow(txRecord.filaIngreso, { vendedor: customerData.vendedor });
        }

        if (!hasUsefulSalesData(customerData)) return;
        if (!txRecord) return;

        await persistOrEnrichSale(customerData, activeTransaction.orderNumber, activeTransaction.messageId, activeTransaction.date, txRecord.filaVenta);
        return;
    }

    // Direct field corrections: "tipo: Abono" or "vendedor: Karol"
    const fieldCorrectionPattern = /^(?<field>tipo|vendedor):\s*(?<value>.+)$/i;
    const correctionMatch = ctx.body.match(fieldCorrectionPattern);
    const fieldGroup = correctionMatch?.groups?.field;
    const valueGroup = correctionMatch?.groups?.value;

    if (fieldGroup && valueGroup) {
        const fieldName = fieldGroup.toLowerCase() as 'tipo' | 'vendedor';
        const fieldValue = valueGroup.trim();
        const quotedText = ctx.quotedBody || '';
        const orderIdMatch = quotedText.match(/LG-\d+/);

        if (orderIdMatch && orderIdMatch[0]) {
            const txByOrder = findTransactionByOrderNumber(orderIdMatch[0]);
            if (txByOrder) {
                await updateIncomeRow(txByOrder.filaIngreso, { [fieldName]: fieldValue });
                return;
            }
        }

        const txByMsgId = findTransactionByMessageId(quotedId);
        if (txByMsgId) {
            await updateIncomeRow(txByMsgId.filaIngreso, { [fieldName]: fieldValue });
            return;
        }
    }

    // Late reply to an already-closed transaction
    const closedTransaction = findTransactionByMessageId(quotedId);
    if (closedTransaction) {
        logger.info('REPLY', `Late reply for closed transaction ${closedTransaction.nPedido}`);
        const customerData = await extractCustomerDataFromText(ctx.body);
        if (!customerData) return;

        if (customerData.vendedor && customerData.vendedor !== 'N/A') {
            await updateIncomeRow(closedTransaction.filaIngreso, { vendedor: customerData.vendedor });
        }

        if (!hasUsefulSalesData(customerData)) return;

        await persistOrEnrichSale(customerData, closedTransaction.nPedido, closedTransaction.messageId, getTodayFormattedString(), closedTransaction.filaVenta);
        return;
    }

    logger.info('REPLY', 'No known transaction found for quoted message -> accumulating in context');
    appendToChatContext(ctx.chatId, ctx.body);
}

// ── Main Entry Point ─────────────────────────────────────────

/**
 * Main event dispatcher for incoming WhatsApp messages.
 * Enqueues operations per chat to prevent concurrency race conditions.
 * 
 * @param ctx - Incoming message payload.
 */
export const processIncomingMessage = async (ctx: IncomingMessage) => {
    await enqueueChatOperation(ctx.chatId, async () => {
        if (ctx.hasMedia) {
            if (!ctx.media || !ctx.media.mimetype.includes('image') || ctx.media.mimetype.includes('webp')) {
                return;
            }

            if (ctx.hasQuotedMsg && ctx.quotedMsgId) {
                const existingTx = findTransactionByMessageId(ctx.quotedMsgId);
                if (existingTx) {
                    logger.info('REPLY', `Image reply discarded for ${existingTx.nPedido}`);
                    return;
                }
            }

            await processImageMessage(ctx.media, ctx);
            return;
        }

        if (ctx.body) {
            if (ctx.hasQuotedMsg) {
                await processQuotedTextMessage(ctx);
            } else {
                await processPlainTextMessage(ctx);
            }
        }
    });
};

// Backward-compatible alias
export const procesarMensajeEntrante = processIncomingMessage;
