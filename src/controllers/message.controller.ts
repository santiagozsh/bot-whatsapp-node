import { Message } from 'whatsapp-web.js';
import { extraerDatosConIA, extraerDatosCliente, optimizarImagenParaOCR } from '../services/ai.service';
import { escribirFilaEnExcel, escribirFilaVenta, mergeFilaVenta, escribirAbonoEnComprasMercancia, actualizarFilaIngreso } from '../services/sheets.service';
import { guardarTransaccion, actualizarFilaVenta, buscarTransaccion, buscarTransaccionPorNPedido, Transaccion } from '../services/memory.service';
import { extraerTextoConVision } from '../services/vision.service';
import { formatearFecha, normalizarTextoOCR } from '../utils/helpers';
import { enviarMensaje } from '../services/whatsapp.service';
import { obtenerDepartamento } from '../utils/colombia.data';

interface ImagenCaja {
    id: string;
    base64: string;
    mimeType: string;
    textosEspecificos: string[];   // textos asociados por Reply o LIFO
    imagenesCliente: string[];     // imágenes adicionales (datos de cliente por OCR)
}

interface CajaRecoleccion {
    imagenes: ImagenCaja[];
    textosPrevios: string[];       // 🚂 Textos que llegan antes de cualquier imagen
    imagenesPrevias: string[];     // imágenes de cliente que llegan antes del primer comprobante
    cronometro: NodeJS.Timeout;
}

const cajasDeRecoleccion = new Map<string, CajaRecoleccion>();
const TIEMPO_ESPERA = parseInt(process.env.TIEMPO_ESPERA_CAJA || '300');

export const procesarMensajeEntrante = async (msg: Message) => {
    const chat = await msg.getChat();
    const chatId = chat.id._serialized;

    if (!cajasDeRecoleccion.has(chatId)) {
        console.log(`\n📦 [NUEVO FLUJO] Abriendo caja de recolección para: ${chat.name}`);
        cajasDeRecoleccion.set(chatId, {
            imagenes: [],
            textosPrevios: [],    // sala de espera: textos antes de cualquier imagen
            imagenesPrevias: [],  // sala de espera: imágenes antes del primer comprobante
            cronometro: iniciarCronometro(chatId, chat)
        });
    } else {
        const caja = cajasDeRecoleccion.get(chatId)!;
        clearTimeout(caja.cronometro);
        caja.cronometro = iniciarCronometro(chatId, chat);
    }

    const cajaActual = cajasDeRecoleccion.get(chatId)!;

    // 🚂 CLASIFICACIÓN INTELIGENTE (El Vagón de Tren)
    if (msg.hasMedia) {

        // EL PORTERO: Si es un sticker, audio, video, o documento raro, lo pateamos inmediatamente.
        if (msg.type === 'sticker' || msg.type === 'video' || msg.type === 'audio' || msg.type === 'ptt') {
            console.log(`🚮 [DESCARTADO] Mensaje tipo '${msg.type}' ignorado. No gastaremos tokens ni RAM en esto.`);
            return; // Terminamos la ejecución aquí mismo
        }

        const media = await msg.downloadMedia();

        // Verificamos explícitamente que sea una imagen estándar (jpeg, png) y NO un formato webp (usado en stickers)
        if (media && media.mimetype.includes('image') && !media.mimetype.includes('webp')) {

            // ── BLOQUE 9 — REPLY TARDÍO (imagen) ──
            if (msg.hasQuotedMsg) {
                const mensajeCitado = await msg.getQuotedMessage();
                const transaccion = buscarTransaccion(mensajeCitado.id._serialized);
                if (transaccion) {
                    console.log(`🔄 [REPLY TARDÍO] Imagen reply para ${transaccion.nPedido}.`);
                    const textoOCR = await extraerTextoConVision(media.data);
                    const textoCliente = (textoOCR && textoOCR !== 'SIN_TEXTO_DETECTADO') ? textoOCR : '';
                    if (textoCliente) {
                        const esMerge = transaccion.filaVenta !== null;
                        await procesarReplyTardio(textoCliente, transaccion);
                        if (esMerge) {
                            enviarMensaje(chat, `🔄 ${transaccion.nPedido} actualizado`);
                        }
                    } else {
                        console.log('⏭️ [REPLY TARDÍO] No se detectó texto en la imagen.');
                    }
                    return;
                }
            }

            if (cajaActual.imagenes.length === 0) {
                // ── PRIMERA IMAGEN: siempre se trata como comprobante ──
                console.log(`🖼️ [IMAGEN] Añadida a la mochila (Nº 1).`);
                cajaActual.imagenes.push({
                    id: msg.id._serialized,
                    base64: media.data,
                    mimeType: media.mimetype,
                    textosEspecificos: [...cajaActual.textosPrevios],
                    imagenesCliente: []
                });
                cajaActual.textosPrevios = [];
            } else {
                // ── BLOQUE 8 — IMAGEN ADICIONAL: clasificar en vivo ──
                const contextoClasif = cajaActual.textosPrevios.length > 0
                    ? cajaActual.textosPrevios.join('\n')
                    : "No hay contexto de texto para esta imagen.";

                console.log(`🔍 [CLASIFICANDO] Imagen Nº ${cajaActual.imagenes.length + 1}...`);
                const datosExtraidos = await extraerDatosConIA(media.data, media.mimetype, contextoClasif);

                if (datosExtraidos && datosExtraidos.esComprobanteValido) {
                    console.log(`🖼️ [IMAGEN] Clasificada como COMPROBANTE (Nº ${cajaActual.imagenes.length + 1}).`);
                    cajaActual.imagenes.push({
                        id: msg.id._serialized,
                        base64: media.data,
                        mimeType: media.mimetype,
                        textosEspecificos: [...cajaActual.textosPrevios],
                        imagenesCliente: []
                    });
                    cajaActual.textosPrevios = [];
                } else {
                    const ultimaImagen = cajaActual.imagenes[cajaActual.imagenes.length - 1];
                    if (ultimaImagen) {
                        ultimaImagen.imagenesCliente.push(media.data);
                        console.log(`📋 [IMAGEN] Clasificada como DATOS DE CLIENTE — adjuntada al último comprobante.`);
                    }
                }
            }
        }
    } else if (msg.body) {

        // 1. INTENTO A: ¿El usuario usó la función de "Responder" (Reply)?
        if (msg.hasQuotedMsg) {
            const mensajeCitado = await msg.getQuotedMessage();
            const quotedId = mensajeCitado.id._serialized;

            // 1a. Reply a imagen dentro de la caja actual
            const imagenAsociada = cajaActual.imagenes.find(img => img.id === quotedId);
            if (imagenAsociada) {
                imagenAsociada.textosEspecificos.push(msg.body);
                console.log(`🔗 [REPLY] Texto pegado exactamente a la imagen citada.`);
                return;
            }

            // 1b. BLOQUE 9 — Reply tardío (texto)
            const transaccion = buscarTransaccion(quotedId);
            if (transaccion) {
                console.log(`🔄 [REPLY TARDÍO] Texto reply para ${transaccion.nPedido}.`);
                const esMerge = transaccion.filaVenta !== null;
                await procesarReplyTardio(msg.body, transaccion);
                if (esMerge) {
                    enviarMensaje(chat, `🔄 ${transaccion.nPedido} actualizado`);
                }
                return;
            }

            // 1c. Reply de corrección (tipo/vendedor) a mensaje de confirmación
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
                        console.log(`🔄 [CORRECCIÓN] ${campo}: ${valor} para ${t.nPedido}`);
                        await actualizarFilaIngreso(t.filaIngreso, { [campo]: valor });
                        enviarMensaje(chat, `✅ ${t.nPedido}: ${campo} actualizado a "${valor}"`);
                        return;
                    }
                }
            }
        }

        // 2. INTENTO B: Si no usó Reply, usamos el "Vagón de Tren" (LIFO)
        if (cajaActual.imagenes.length > 0) {
            const ultimaImagen = cajaActual.imagenes[cajaActual.imagenes.length - 1];
            if (ultimaImagen) {
                ultimaImagen.textosEspecificos.push(msg.body);
                console.log(`🔗 [VAGÓN] Texto pegado a la última Imagen: "${msg.body.substring(0, 20)}..."`);
            }
        } else {
            // Aún no hay fotos: Va para la sala de espera
            cajaActual.textosPrevios.push(msg.body);
            console.log(`⏳ [SALA ESPERA] Texto guardado: "${msg.body.substring(0, 20)}..."`);
        }


    }
};

const iniciarCronometro = (chatId: string, chat: any) => {
    return setTimeout(async () => {
        console.log(`\n⏱️ [TIEMPO AGOTADO] Silencio en ${chat.name}. Analizando recolección...`);

        const cajaCerrada = cajasDeRecoleccion.get(chatId);
        cajasDeRecoleccion.delete(chatId);

        if (!cajaCerrada || cajaCerrada.imagenes.length === 0) return;

        console.log(`⚙️ ¡Se encontraron ${cajaCerrada.imagenes.length} imagen(es)! Procesando...`);

        let ultimoComprobanteIdx = -1;
        let ultimoNPedido = '';

        for (const [index, img] of cajaCerrada.imagenes.entries()) {
            console.log(`\n🤖 --- Enviando imagen ${index + 1} de ${cajaCerrada.imagenes.length} a OpenAI ---`);

            // Armamos el contexto de texto
            let contextoFinal = "";
            if (img.textosEspecificos.length > 0) {
                contextoFinal = `[--- IMPORTANTE: MENSAJE DIRECTO PARA ESTA IMAGEN ---]\n`;
                contextoFinal += img.textosEspecificos.join('\n');
            } else {
                contextoFinal = "No hay contexto de texto para esta imagen.";
            }

            // Llamada a la IA
            const datosExtraidos = await extraerDatosConIA(
                img.base64,
                img.mimeType,
                contextoFinal
            );

            // Escritura en Excel + guardar en SQLite
            if (datosExtraidos && datosExtraidos.esComprobanteValido) {
                console.log(`📝 Escribiendo comprobante ${index + 1} en Excel...`);
                const resultado = await escribirFilaEnExcel(datosExtraidos);
                if (resultado) {
                    ultimoComprobanteIdx = index;
                    ultimoNPedido = resultado.nPedido;
                    guardarTransaccion(img.id, resultado.nPedido, resultado.filaIngreso);
                    enviarMensaje(chat, `✅ ${resultado.nPedido} | $${datosExtraidos.precioCompra} ${datosExtraidos.medioDePago} | ${datosExtraidos.vendedor || 'JHON'}`);
                    if (datosExtraidos.tipo === 'Abono') {
                        await escribirAbonoEnComprasMercancia(datosExtraidos.fecha, datosExtraidos.precioCompra);
                    }
                }
            } else {
                console.log(`🗑️ [DESCARTADO] La imagen ${index + 1} no es un comprobante válido.`);
                enviarMensaje(chat, `⚠️ Imagen no reconocida como comprobante`);
            }

        }

        // ────────────────────────────────────────────────────────────
        // BLOQUE 7 — Cierre de caja: escritura dual (Ventas)
        // ────────────────────────────────────────────────────────────
        if (ultimoComprobanteIdx >= 0) {
            const imgCliente = cajaCerrada.imagenes[ultimoComprobanteIdx]!;
            const textos: string[] = [];
            let datosCliente = null;

            // 1. Textos específicos del último comprobante
            if (imgCliente.textosEspecificos.length > 0) {
                textos.push(...imgCliente.textosEspecificos);
            }

            // 2. Textos previos al primer comprobante
            if (cajaCerrada.textosPrevios.length > 0) {
                textos.push(...cajaCerrada.textosPrevios);
            }

            // 3. Contexto de texto acumulado (para acompañar a las imágenes de cliente)
            const contextoTexto = textos.join('\n').trim();

            // 4. Procesar imágenes de cliente con OCR local + texto
            const primeraImgCliente = imgCliente.imagenesCliente[0];
            if (primeraImgCliente) {
                console.log('📋 [CLIENTE] Extrayendo texto con OCR...');
                const imgOCR = await optimizarImagenParaOCR(primeraImgCliente);
                let textoOCR = normalizarTextoOCR(await extraerTextoConVision(imgOCR, 'comprobante'));

                const tieneDatosUtiles = (texto: string) =>
                    texto && texto !== 'SIN_TEXTO_DETECTADO' &&
                    /[A-Za-zÁÉÍÓÚáéíóúÑñ]{4,}/.test(texto) &&
                    /[\s\S]{50,}|@|\b\d{10}\b|nombre|email|telefono|direccion|municipio|producto/i.test(texto);

                if (!tieneDatosUtiles(textoOCR)) {
                    console.log('📋 [CLIENTE] Reintentando OCR con modo formulario...');
                    textoOCR = normalizarTextoOCR(await extraerTextoConVision(imgOCR, 'formulario'));
                }

                const textoCompleto = [contextoTexto, textoOCR].filter(Boolean).join('\n');
                datosCliente = await extraerDatosCliente(textoCompleto);
            }

            // 5. Fallback: si no hay imagen de cliente o falló, usar solo texto
            if (!datosCliente && contextoTexto) {
                console.log('📋 [CLIENTE] Sin imagen de cliente, extrayendo desde texto...');
                datosCliente = await extraerDatosCliente(contextoTexto);
            }

            if (datosCliente) {
                const hoy = new Date();
                const fechaStr = `${hoy.getDate().toString().padStart(2, '0')}/${(hoy.getMonth() + 1).toString().padStart(2, '0')}/${hoy.getFullYear()}`;
                const fecha = formatearFecha(fechaStr);

                console.log(`📝 [VENTAS] Escribiendo fila para ${ultimoNPedido}...`);
                const filaVenta = await escribirFilaVenta(datosCliente, ultimoNPedido, fecha);
                if (filaVenta > 0) {
                    actualizarFilaVenta(imgCliente.id, filaVenta);
                    const depto = obtenerDepartamento(datosCliente.municipio || '');
                    enviarMensaje(chat, `👤 ${ultimoNPedido} | ${datosCliente.nombreCliente || 'N/A'} | ${datosCliente.municipio || 'N/A'}, ${depto}`);
                }
            } else {
                console.log('⏭️ [CLIENTE] No se pudieron extraer datos de cliente.');
            }
        }

        console.log('\n🎉 ¡FLUJO MÚLTIPLE TERMINADO CON ÉXITO!');

    }, TIEMPO_ESPERA);
};

// ────────────────────────────────────────────────────────────
// BLOQUE 9 — Reply tardío
// Procesa datos de cliente para una transacción ya cerrada,
// escribiendo o mergeando en la hoja Ventas según corresponda.
// ────────────────────────────────────────────────────────────
const procesarReplyTardio = async (textoCliente: string, transaccion: Transaccion) => {
    try {
        const datosCliente = await extraerDatosCliente(textoCliente);
        if (!datosCliente) return;

        const hoy = new Date();
        const fechaStr = `${hoy.getDate().toString().padStart(2, '0')}/${(hoy.getMonth() + 1).toString().padStart(2, '0')}/${hoy.getFullYear()}`;
        const fecha = formatearFecha(fechaStr);

        if (transaccion.filaVenta === null) {
            console.log(`📝 [VENTAS] Creando fila para ${transaccion.nPedido}...`);
            const filaVenta = await escribirFilaVenta(datosCliente, transaccion.nPedido, fecha);
            if (filaVenta > 0) {
                actualizarFilaVenta(transaccion.messageId, filaVenta);
                console.log(`✅ [REPLY TARDÍO] Fila ${filaVenta} creada en Ventas para ${transaccion.nPedido}.`);
            }
        } else {
            console.log(`🔄 [VENTAS] Mergeando fila ${transaccion.filaVenta} para ${transaccion.nPedido}...`);
            await mergeFilaVenta(transaccion.filaVenta, datosCliente);
            console.log(`✅ [REPLY TARDÍO] Fila ${transaccion.filaVenta} mergeada para ${transaccion.nPedido}.`);
        }
    } catch (error) {
        console.error('❌ [REPLY TARDÍO] Error:', error);
    }
};
