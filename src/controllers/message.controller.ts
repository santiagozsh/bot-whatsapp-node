import { Message } from 'whatsapp-web.js';
import { extraerDatosDesdeTextoOCR, extraerDatosCliente, optimizarImagenParaOCR } from '../services/ai.service';
import { escribirFilaEnExcel, escribirFilaVenta, mergeFilaVenta, escribirAbonoEnComprasMercancia, actualizarFilaIngreso } from '../services/sheets.service';
import { guardarTransaccion, actualizarFilaVenta, buscarTransaccion, buscarTransaccionPorReferencia, buscarTransaccionPorNPedido } from '../services/memory.service';
import { extraerTextoConVision } from '../services/vision.service';
import { formatearFecha, normalizarTextoOCR } from '../utils/helpers';
import { logger } from '../utils/logger';

const TIEMPO_VENTANA = parseInt(process.env.TIEMPO_VENTANA_ACTIVA || '60000');

const KEYWORDS_FINANCIEROS = [
    'nequi', 'bancolombia', 'davivienda', 'daviplata',
    'transferencia', 'comprobante', 'pago', 'valor',
    'total', 'cuenta', 'ahorros', 'corriente',
    'recibido', 'recibí', 'consignacion', 'consignación',
    'transaccion', 'transacción',
];

interface VentanaActiva {
    nPedido: string;
    messageId: string;
    fechaTransaccion: string;
    textos: string[];
    timer: NodeJS.Timeout;
}

const ventanasActivas = new Map<string, VentanaActiva>();
const bufferTextosPorChat = new Map<string, string[]>();
const chatsEnProceso = new Set<string>();
const textosPendientesPorChat = new Map<string, string[]>();

function getBuffer(chatId: string): string[] {
    if (!bufferTextosPorChat.has(chatId)) {
        bufferTextosPorChat.set(chatId, []);
    }
    return bufferTextosPorChat.get(chatId)!;
}

function getPendientes(chatId: string): string[] {
    if (!textosPendientesPorChat.has(chatId)) {
        textosPendientesPorChat.set(chatId, []);
    }
    return textosPendientesPorChat.get(chatId)!;
}

function textoContieneDatosFinancieros(texto: string): boolean {
    if (!texto || texto === 'SIN_TEXTO_DETECTADO') return false;
    const t = texto.toLowerCase();
    return KEYWORDS_FINANCIEROS.some(kw => t.includes(kw));
}

function hoyStr(): string {
    const d = new Date();
    return `${d.getDate().toString().padStart(2, '0')}/${(d.getMonth() + 1).toString().padStart(2, '0')}/${d.getFullYear()}`;
}

async function cerrarVentanaActiva(chatId: string, chat: any): Promise<void> {
    const ventana = ventanasActivas.get(chatId);
    if (!ventana) return;
    ventanasActivas.delete(chatId);
    clearTimeout(ventana.timer);

    if (ventana.textos.length === 0) return;

    logger.info('VENTANA', `Cerrando ventana de ${ventana.nPedido} (${ventana.textos.length} texto(s))`);

    const datosCliente = await extraerDatosCliente(ventana.textos.join('\n'));
    if (!datosCliente) return;

    const transaccion = buscarTransaccion(ventana.messageId);

    // Update vendedor in Ingresos if present
    if (datosCliente.vendedor && datosCliente.vendedor !== 'N/A' && transaccion) {
        await actualizarFilaIngreso(transaccion.filaIngreso, { vendedor: datosCliente.vendedor });
    }

    const tieneProductos = datosCliente.producto && datosCliente.producto !== 'N/A';
    const tieneCantidades = (datosCliente.cantidadRelojes ?? 0) > 0 || (datosCliente.cantidadOtros ?? 0) > 0;
    const tieneNombre = datosCliente.nombreCliente && datosCliente.nombreCliente !== 'N/A';

    if (!tieneProductos && !tieneCantidades && !tieneNombre) {
        logger.info('VENTANA', 'Sin datos útiles, pasando al buffer');
        getBuffer(chatId).push(...ventana.textos);
        return;
    }

    if (!transaccion) return;

    const fecha = formatearFecha(ventana.fechaTransaccion);

    if (transaccion.filaVenta === null) {
        const filaVenta = await escribirFilaVenta(datosCliente, ventana.nPedido, fecha);
        if (filaVenta > 0) {
            actualizarFilaVenta(ventana.messageId, filaVenta);
        }
    } else {
        await mergeFilaVenta(transaccion.filaVenta, datosCliente);
    }
}

function abrirVentanaActiva(chatId: string, nPedido: string, messageId: string, fechaTransaccion: string, chat: any, textosIniciales: string[] = []): void {
    const timer = setTimeout(async () => {
        await cerrarVentanaActiva(chatId, chat);
    }, TIEMPO_VENTANA);

    ventanasActivas.set(chatId, { nPedido, messageId, fechaTransaccion, textos: [...textosIniciales], timer });
    if (textosIniciales.length > 0) {
        logger.info('VENTANA', `Ventana ${nPedido} abierta con ${textosIniciales.length} texto(s) del buffer`);
    }
}

function extenderVentana(chatId: string, chat: any): void {
    const v = ventanasActivas.get(chatId);
    if (!v) return;
    clearTimeout(v.timer);
    v.timer = setTimeout(async () => {
        await cerrarVentanaActiva(chatId, chat);
    }, TIEMPO_VENTANA);
}

async function procesarImagen(media: any, msg: Message, chat: any, chatId: string): Promise<void> {
    logger.info('IMAGEN', 'Procesando imagen...');

    const imgOptimizada = await optimizarImagenParaOCR(media.data);
    const textoOCR = normalizarTextoOCR(await extraerTextoConVision(imgOptimizada));

    if (!textoContieneDatosFinancieros(textoOCR)) {
        logger.info('IMAGEN', 'Sin datos financieros — descartada (0 tokens)');
        return;
    }

    logger.info('IMAGEN', 'Datos financieros detectados → OpenAI');
    chatsEnProceso.add(chatId);

    const MAX_CONTEXTO_CHARS = 300;
    const buffer = getBuffer(chatId);
    const bufferSnapshot = [...buffer];
    const rawContexto = buffer.length > 0 ? buffer.join('\n') : '';
    const contextoTexto = rawContexto.length > MAX_CONTEXTO_CHARS
        ? rawContexto.substring(0, MAX_CONTEXTO_CHARS) + '...'
        : (rawContexto || 'No hay contexto de texto para esta imagen.');

    await cerrarVentanaActiva(chatId, chat);

    const datosExtraidos = await extraerDatosDesdeTextoOCR(textoOCR, contextoTexto);

    if (!datosExtraidos || !datosExtraidos.esComprobanteValido) {
        chatsEnProceso.delete(chatId);
        logger.info('IMAGEN', 'No es comprobante válido');
        return;
    }

    if (datosExtraidos.referenciaDePago && datosExtraidos.referenciaDePago !== 'N/A') {
        const existente = buscarTransaccionPorReferencia(datosExtraidos.referenciaDePago);
        if (existente) {
            chatsEnProceso.delete(chatId);
            logger.info('IMAGEN', `Referencia duplicada: ${datosExtraidos.referenciaDePago} = ${existente.nPedido}`);
            return;
        }
    }

    buffer.length = 0;

    const resultado = await escribirFilaEnExcel(datosExtraidos);
    if (!resultado) {
        chatsEnProceso.delete(chatId);
        logger.error('IMAGEN', 'Error escribiendo en Google Sheets');
        return;
    }

    const { nPedido, filaIngreso } = resultado;

    guardarTransaccion(msg.id._serialized, nPedido, filaIngreso, datosExtraidos.referenciaDePago || null);

    abrirVentanaActiva(chatId, nPedido, msg.id._serialized, datosExtraidos.fecha, chat, bufferSnapshot);
    chatsEnProceso.delete(chatId);

    const pendientes = textosPendientesPorChat.get(chatId);
    if (pendientes && pendientes.length > 0) {
        const ventana = ventanasActivas.get(chatId);
        if (ventana) {
            ventana.textos.push(...pendientes);
            logger.info('VENTANA', `+${pendientes.length} texto(s) pendientes agregados a ${nPedido}`);
        }
        textosPendientesPorChat.delete(chatId);
    }

    if (datosExtraidos.tipo === 'Abono') {
        await escribirAbonoEnComprasMercancia(datosExtraidos.fecha, datosExtraidos.precioCompra);
    }

    logger.info('IMAGEN', `✅ ${nPedido} registrado (fila ${filaIngreso})`);
}

async function procesarTextoConReply(msg: Message, chat: any, chatId: string): Promise<void> {
    const mensajeCitado = await msg.getQuotedMessage();
    const quotedId = mensajeCitado.id._serialized;

    const ventana = ventanasActivas.get(chatId);
    if (ventana && ventana.messageId === quotedId) {
        ventana.textos.push(msg.body);
        logger.info('REPLY', `Asociado a ventana activa ${ventana.nPedido}`);
        extenderVentana(chatId, chat);
        return;
    }

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

    logger.info('REPLY', 'Sin transacción conocida → buffer');
    getBuffer(chatId).push(msg.body);
}

async function procesarTextoSinReply(msg: Message, chat: any, chatId: string): Promise<void> {
    const ventana = ventanasActivas.get(chatId);

    if (ventana) {
        ventana.textos.push(msg.body);
        logger.info('TEXTO', `→ ventana ${ventana.nPedido}: "${msg.body.substring(0, 50)}..."`);
        extenderVentana(chatId, chat);
    } else if (chatsEnProceso.has(chatId)) {
        getPendientes(chatId).push(msg.body);
        logger.info('TEXTO', `→ pendiente (procesando imagen): "${msg.body.substring(0, 50)}..."`);
    } else {
        getBuffer(chatId).push(msg.body);
        logger.info('TEXTO', `→ buffer: "${msg.body.substring(0, 50)}..."`);
    }
}

export const procesarMensajeEntrante = async (msg: Message) => {
    const chat = await msg.getChat();
    const chatId = chat.id._serialized;

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
            await procesarTextoSinReply(msg, chat, chatId);
        }
    }
};
