import { Message, Chat, MessageMedia } from 'whatsapp-web.js';
import { extraerDatosDesdeTextoOCR, extraerDatosCliente, optimizarImagenParaOCR } from '../services/ai.service';
import { escribirFilaEnExcel, escribirFilaVenta, mergeFilaVenta, escribirAbonoEnComprasMercancia, actualizarFilaIngreso } from '../services/sheets.service';
import { guardarTransaccion, actualizarFilaVenta, buscarTransaccion, buscarTransaccionPorReferencia, buscarTransaccionPorNPedido } from '../services/memory.service';
import { extraerTextoConVisionMejorado } from '../services/vision.service';
import { formatearFecha, normalizarTextoOCR, esTextoUtil } from '../utils/helpers';
import { logger } from '../utils/logger';
import type { DatosIngreso } from '../types';

// ── Constantes ────────────────────────────────────────────────

const TIEMPO_TTL_CONTEXTO = parseInt(process.env.TIEMPO_TTL_CONTEXTO || '14400000'); // 4 horas
const TIEMPO_CIERRE_RESPALDO = parseInt(process.env.TIEMPO_CIERRE_RESPALDO || '14400000');

const KEYWORDS_FINANCIEROS = [
    'nequi', 'bancolombia', 'davivienda', 'daviplata',
    'transferencia', 'comprobante', 'pago', 'valor',
    'total', 'cuenta', 'ahorros', 'corriente',
    'recibido', 'recibí', 'consignacion', 'consignación',
    'transaccion', 'transacción',
];

// ── Tipos locales ─────────────────────────────────────────────

interface ItemContexto {
    texto: string;
    timestamp: number;
}

interface TransaccionPendiente {
    nPedido: string;
    messageId: string;
    fecha: string;
}

// ── Estado del chat ──────────────────────────────────────────

const contextoPorChat = new Map<string, ItemContexto[]>();
const transaccionActualPorChat = new Map<string, TransaccionPendiente | null>();
const colasPorChat = new Map<string, Promise<void>>();
const timersRespaldoPorChat = new Map<string, NodeJS.Timeout>();

// ── Helpers de contexto ──────────────────────────────────────

function agregarAlContexto(chatId: string, texto: string): void {
    if (!texto || texto === 'SIN_TEXTO_DETECTADO') return;

    const ahora = Date.now();
    const ttl = TIEMPO_TTL_CONTEXTO;

    if (!contextoPorChat.has(chatId)) {
        contextoPorChat.set(chatId, []);
    }

    const items = contextoPorChat.get(chatId)!;
    const vigentes = items.filter(item => ahora - item.timestamp <= ttl);
    vigentes.push({ texto, timestamp: ahora });
    contextoPorChat.set(chatId, vigentes);
}

function obtenerContexto(chatId: string): string {
    const items = contextoPorChat.get(chatId);
    if (!items || items.length === 0) return '';

    const ahora = Date.now();
    const ttl = TIEMPO_TTL_CONTEXTO;
    const vigentes = items.filter(item => ahora - item.timestamp <= ttl);
    contextoPorChat.set(chatId, vigentes);

    return vigentes.map(item => item.texto).join('\n');
}

// ── Cola por chat (serialización de operaciones) ─────────────

async function encolarOperacion(chatId: string, fn: () => Promise<void>): Promise<void> {
    const anterior = colasPorChat.get(chatId) || Promise.resolve();
    const actual = anterior.then(fn).catch(err => {
        logger.error('COLA', `Error en operación de ${chatId}:`, err);
    });
    colasPorChat.set(chatId, actual);
    await actual;
}

// ── Detección de comprobante ─────────────────────────────────

function textoContieneDatosFinancieros(texto: string): boolean {
    if (!texto || texto === 'SIN_TEXTO_DETECTADO') return false;
    const t = texto.toLowerCase();
    return KEYWORDS_FINANCIEROS.some(kw => t.includes(kw));
}

function hoyStr(): string {
    const d = new Date();
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
}

// ── Cierre de transacción anterior (escribe Ventas) ──────────

async function finalizarTransaccionAnterior(chatId: string, chat: Chat): Promise<void> {
    const transaccion = transaccionActualPorChat.get(chatId);
    if (!transaccion) return;

    const contexto = obtenerContexto(chatId);

    if (!contexto) {
        contextoPorChat.delete(chatId);
        transaccionActualPorChat.set(chatId, null);
        return;
    }

    logger.info('CIERRE', `Finalizando Ventas de ${transaccion.nPedido} (${contexto.split('\n').length} ítem(s) en contexto)`);

    const datosCliente = await extraerDatosCliente(contexto);
    if (!datosCliente) {
        contextoPorChat.delete(chatId);
        transaccionActualPorChat.set(chatId, null);
        return;
    }

    const t = buscarTransaccion(transaccion.messageId);

    if (datosCliente.vendedor && datosCliente.vendedor !== 'N/A' && t) {
        await actualizarFilaIngreso(t.filaIngreso, { vendedor: datosCliente.vendedor });
    }

    const tieneProductos = datosCliente.producto && datosCliente.producto !== 'N/A';
    const tieneCantidades = (datosCliente.cantidadRelojes ?? 0) > 0 || (datosCliente.cantidadOtros ?? 0) > 0;
    const tieneNombre = datosCliente.nombreCliente && datosCliente.nombreCliente !== 'N/A';

    if (!tieneProductos && !tieneCantidades && !tieneNombre) {
        logger.info('CIERRE', 'Sin datos útiles para Ventas');
        contextoPorChat.delete(chatId);
        transaccionActualPorChat.set(chatId, null);
        return;
    }

    if (!t) {
        contextoPorChat.delete(chatId);
        transaccionActualPorChat.set(chatId, null);
        return;
    }

    const fecha = formatearFecha(transaccion.fecha);

    if (t.filaVenta === null) {
        const filaVenta = await escribirFilaVenta(datosCliente, transaccion.nPedido, fecha);
        if (filaVenta > 0) {
            actualizarFilaVenta(transaccion.messageId, filaVenta);
        }
    } else {
        await mergeFilaVenta(t.filaVenta, datosCliente);
    }

    contextoPorChat.delete(chatId);
    transaccionActualPorChat.set(chatId, null);
}

// ── Timer de respaldo ────────────────────────────────────────

function programarCierreRespaldo(chatId: string, chat: Chat): void {
    const existente = timersRespaldoPorChat.get(chatId);
    if (existente) clearTimeout(existente);

    const timer = setTimeout(async () => {
        timersRespaldoPorChat.delete(chatId);
        await encolarOperacion(chatId, async () => {
            if (transaccionActualPorChat.get(chatId)) {
                logger.info('RESPALDO', `Cierre por inactividad (${TIEMPO_CIERRE_RESPALDO / 1000 / 60 / 60}h)`);
                await finalizarTransaccionAnterior(chatId, chat);
            }
        });
    }, TIEMPO_CIERRE_RESPALDO);

    timersRespaldoPorChat.set(chatId, timer);
}

// ── Pipeline de comprobante ──────────────────────────────────

async function preprocesarImagen(media: MessageMedia): Promise<string> {
    const imgOptimizada = await optimizarImagenParaOCR(media.data);
    return normalizarTextoOCR(await extraerTextoConVisionMejorado(imgOptimizada));
}

function procesarImagenNoComprobante(chatId: string, textoOCR: string): void {
    if (textoOCR && textoOCR !== 'SIN_TEXTO_DETECTADO' && esTextoUtil(textoOCR)) {
        agregarAlContexto(chatId, textoOCR);
        logger.info('IMAGEN', `Sin datos financieros → acumulada en contexto (${textoOCR.length} chars)`);
    } else {
        logger.info('IMAGEN', 'Sin datos financieros — descartada (0 tokens)');
    }
}

async function procesarComprobante(
    textoOCR: string,
    msg: Message,
    chat: Chat,
    chatId: string
): Promise<void> {
    logger.info('IMAGEN', 'Datos financieros detectados → OpenAI');

    // 1. Cerrar la transacción anterior
    await finalizarTransaccionAnterior(chatId, chat);

    // 2. Obtener contexto para Prompt A
    const contextoParaPromptA = obtenerContexto(chatId);
    const MAX_CONTEXTO_CHARS = 300;
    const contextoTruncado = contextoParaPromptA.length > MAX_CONTEXTO_CHARS
        ? contextoParaPromptA.substring(0, MAX_CONTEXTO_CHARS) + '...'
        : (contextoParaPromptA || 'No hay contexto de texto para esta imagen.');

    // 3. Extraer datos del comprobante con OpenAI
    const datosExtraidos = await extraerDatosDesdeTextoOCR(textoOCR, contextoTruncado);

    if (!datosExtraidos || !datosExtraidos.esComprobanteValido) {
        logger.info('IMAGEN', 'No es comprobante válido');
        return;
    }

    // 4. Verificar duplicado por referencia
    if (datosExtraidos.referenciaDePago && datosExtraidos.referenciaDePago !== 'N/A') {
        const existente = buscarTransaccionPorReferencia(datosExtraidos.referenciaDePago);
        if (existente) {
            logger.info('IMAGEN', `Referencia duplicada: ${datosExtraidos.referenciaDePago} = ${existente.nPedido}`);
            return;
        }
    }

    // 5. Registrar comprobante
    await registrarComprobante(datosExtraidos, msg, chat, chatId);
}

async function registrarComprobante(
    datosExtraidos: DatosIngreso,
    msg: Message,
    chat: Chat,
    chatId: string
): Promise<void> {
    const resultado = await escribirFilaEnExcel(datosExtraidos);
    if (!resultado) {
        logger.error('IMAGEN', 'Error escribiendo en Google Sheets');
        return;
    }

    const { nPedido, filaIngreso } = resultado;

    guardarTransaccion(msg.id._serialized, nPedido, filaIngreso, datosExtraidos.referenciaDePago || null);

    transaccionActualPorChat.set(chatId, { nPedido, messageId: msg.id._serialized, fecha: datosExtraidos.fecha });

    if (datosExtraidos.tipo === 'Abono') {
        await escribirAbonoEnComprasMercancia(datosExtraidos.fecha, datosExtraidos.precioCompra);
    }

    programarCierreRespaldo(chatId, chat);

    logger.info('IMAGEN', `✅ ${nPedido} registrado (fila ${filaIngreso})`);
}

async function procesarImagen(media: MessageMedia, msg: Message, chat: Chat, chatId: string): Promise<void> {
    logger.info('IMAGEN', 'Procesando imagen...');

    const textoOCR = await preprocesarImagen(media);

    if (!textoContieneDatosFinancieros(textoOCR)) {
        procesarImagenNoComprobante(chatId, textoOCR);
        return;
    }

    await procesarComprobante(textoOCR, msg, chat, chatId);
}

// ── Procesamiento de texto (sin reply) ───────────────────────

async function procesarTextoSinReply(msg: Message, chatId: string): Promise<void> {
    agregarAlContexto(chatId, msg.body);
    logger.info('TEXTO', `→ contexto: "${msg.body.substring(0, 50)}..."`);
}

// ── Procesamiento de texto (con reply) ───────────────────────

async function procesarTextoConReply(msg: Message, chat: Chat, chatId: string): Promise<void> {
    const mensajeCitado = await msg.getQuotedMessage();
    const quotedId = mensajeCitado.id._serialized;

    const patronCorreccion = /^(tipo|vendedor):\s*(.+)$/i;
    const matchCorreccion = msg.body.match(patronCorreccion);
    if (matchCorreccion && matchCorreccion[1] && matchCorreccion[2]) {
        const campo = matchCorreccion[1].toLowerCase() as 'tipo' | 'vendedor';
        const valor = matchCorreccion[2].trim();
        const textoCitado = mensajeCitado.body || '';
        const matchNPedido = textoCitado.match(/LG-\d+/);
        if (matchNPedido && matchNPedido[0]) {
            const t = buscarTransaccionPorNPedido(matchNPedido[0]);
            if (t) {
                await actualizarFilaIngreso(t.filaIngreso, { [campo]: valor });
                return;
            }
        }
    }

    const transaccion = buscarTransaccion(quotedId);
    if (transaccion) {
        logger.info('REPLY', `Reply tardío para ${transaccion.nPedido}`);
        const datosCliente = await extraerDatosCliente(msg.body);
        if (!datosCliente) return;

        if (datosCliente.vendedor && datosCliente.vendedor !== 'N/A') {
            await actualizarFilaIngreso(transaccion.filaIngreso, { vendedor: datosCliente.vendedor });
        }

        const tieneProductos = datosCliente.producto && datosCliente.producto !== 'N/A';
        const tieneCantidades = (datosCliente.cantidadRelojes ?? 0) > 0 || (datosCliente.cantidadOtros ?? 0) > 0;
        const tieneNombre = datosCliente.nombreCliente && datosCliente.nombreCliente !== 'N/A';

        if (!tieneProductos && !tieneCantidades && !tieneNombre) return;

        if (transaccion.filaVenta === null) {
            const fecha = formatearFecha(hoyStr());
            const filaVenta = await escribirFilaVenta(datosCliente, transaccion.nPedido, fecha);
            if (filaVenta > 0) {
                actualizarFilaVenta(transaccion.messageId, filaVenta);
            }
        } else {
            await mergeFilaVenta(transaccion.filaVenta, datosCliente);
        }
        return;
    }

    logger.info('REPLY', 'Sin transacción conocida → contexto');
    agregarAlContexto(chatId, msg.body);
}

// ── Entrada principal ────────────────────────────────────────

export const procesarMensajeEntrante = async (msg: Message) => {
    const chat = await msg.getChat();
    const chatId = chat.id._serialized;

    await encolarOperacion(chatId, async () => {
        if (msg.hasMedia) {
            if (msg.type === 'sticker' || msg.type === 'video' || msg.type === 'audio' || msg.type === 'ptt') {
                return;
            }

            const media = await msg.downloadMedia();
            if (!media || !media.mimetype.includes('image') || media.mimetype.includes('webp')) {
                return;
            }

            if (msg.hasQuotedMsg) {
                const mensajeCitado = await msg.getQuotedMessage();
                const transaccion = buscarTransaccion(mensajeCitado.id._serialized);
                if (transaccion) {
                    logger.info('REPLY', `Imagen reply descartada para ${transaccion.nPedido}`);
                    return;
                }
            }

            await procesarImagen(media, msg, chat, chatId);

        } else if (msg.body) {
            if (msg.hasQuotedMsg) {
                await procesarTextoConReply(msg, chat, chatId);
            } else {
                await procesarTextoSinReply(msg, chatId);
            }
        }
    });
};
