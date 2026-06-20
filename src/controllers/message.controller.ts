import { Message } from 'whatsapp-web.js';
import { extraerDatosConIA } from '../services/ai.service';
import { escribirFilaEnExcel } from '../services/sheets.service';

interface ImagenCaja {
    id: string;
    base64: string;
    mimeType: string;
    textosEspecificos: string[];
}

interface CajaRecoleccion {
    imagenes: ImagenCaja[];
    textosPrevios: string[]; // 🚂 Textos que llegan antes de cualquier imagen
    cronometro: NodeJS.Timeout;
}

const cajasDeRecoleccion = new Map<string, CajaRecoleccion>();
const TIEMPO_ESPERA = 15000; 

export const procesarMensajeEntrante = async (msg: Message) => {
    const chat = await msg.getChat();
    const chatId = chat.id._serialized;

    if (!cajasDeRecoleccion.has(chatId)) {
        console.log(`\n📦 [NUEVO FLUJO] Abriendo caja de recolección para: ${chat.name}`);
        cajasDeRecoleccion.set(chatId, {
            imagenes: [],
            textosPrevios: [], // Iniciamos la sala de espera vacía
            cronometro: iniciarCronometro(chatId, chat.name)
        });
    } else {
        const caja = cajasDeRecoleccion.get(chatId)!;
        clearTimeout(caja.cronometro);
        caja.cronometro = iniciarCronometro(chatId, chat.name);
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
            console.log(`🖼️ [IMAGEN] Añadida a la mochila (Nº ${cajaActual.imagenes.length + 1}).`);
            
            // Creamos la imagen heredando cualquier texto que estuviera en la sala de espera
            cajaActual.imagenes.push({
                id: msg.id._serialized,
                base64: media.data,
                mimeType: media.mimetype,
                textosEspecificos: [...cajaActual.textosPrevios] 
            });

            // Vaciamos la sala de espera porque los textos ya se le asignaron a esta imagen
            cajaActual.textosPrevios = []; 
        }
    } else if (msg.body) {

        // 1. INTENTO A: ¿El usuario usó la función de "Responder" (Reply)?
        if (msg.hasQuotedMsg) {
            const mensajeCitado = await msg.getQuotedMessage();
            const imagenAsociada = cajaActual.imagenes.find(img => img.id === mensajeCitado.id._serialized);
            
            if (imagenAsociada) {
                imagenAsociada.textosEspecificos.push(msg.body);
                console.log(`🔗 [REPLY] Texto pegado exactamente a la imagen citada.`);
                return; // Terminamos aquí
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

const iniciarCronometro = (chatId: string, chatName: string) => {
    return setTimeout(async () => {
        console.log(`\n⏱️ [TIEMPO AGOTADO] Silencio en ${chatName}. Analizando recolección...`);
        
        const cajaCerrada = cajasDeRecoleccion.get(chatId);
        cajasDeRecoleccion.delete(chatId);

        if (!cajaCerrada || cajaCerrada.imagenes.length === 0) return;

        console.log(`⚙️ ¡Se encontraron ${cajaCerrada.imagenes.length} imagen(es)! Procesando...`);

        for (const [index, img] of cajaCerrada.imagenes.entries()) {
            console.log(`\n🤖 --- Enviando imagen ${index + 1} de ${cajaCerrada.imagenes.length} a Gemini ---`);
            
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

            // Escritura en Excel
            if (datosExtraidos && datosExtraidos.esComprobanteValido) {
                console.log(`📝 Escribiendo comprobante ${index + 1} en Excel...`);
                await escribirFilaEnExcel(datosExtraidos);
            } else {
                console.log(`🗑️ [DESCARTADO] La imagen ${index + 1} no es un comprobante válido.`);
            }

            // 🛡️ ESCUDO ANTI-BANEOS (Rate Limiting)
            // Evaluamos si NO es la última imagen de la mochila. 
            // Si faltan imágenes por procesar, dormimos el código 4 segundos.
            if (index < cajaCerrada.imagenes.length - 1) {
                console.log('⏳ [ESCUDO ACTIVADO] Esperando 4 segundos para no saturar la API de Google...');
                await new Promise(resolve => setTimeout(resolve, 4000));
            }
        }

        console.log('\n🎉 ¡FLUJO MÚLTIPLE TERMINADO CON ÉXITO!');

    }, TIEMPO_ESPERA);
};
