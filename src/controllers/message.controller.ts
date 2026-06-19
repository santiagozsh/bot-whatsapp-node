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
        const media = await msg.downloadMedia();
        if (media && media.mimetype.includes('image')) {
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
        // Si entra un texto, evaluamos dónde ponerlo
        // Si entra un texto, evaluamos dónde ponerlo
        if (cajaActual.imagenes.length > 0) {
            // Ya hay fotos: Se lo pegamos a la ÚLTIMA foto que haya entrado
            const ultimaImagen = cajaActual.imagenes[cajaActual.imagenes.length - 1];
            
            // Verificamos explícitamente que no sea 'undefined' para calmar a TypeScript
            if (ultimaImagen) {
                ultimaImagen.textosEspecificos.push(msg.body);
                console.log(`🔗 [TEXTO] Pegado a la Imagen Nº ${cajaActual.imagenes.length}: "${msg.body.substring(0, 30)}..."`);
            }
        } else {
            // Aún no hay fotos: Va para la sala de espera
            cajaActual.textosPrevios.push(msg.body);
            console.log(`⏳ [TEXTO PREVIO] En sala de espera: "${msg.body.substring(0, 30)}..."`);
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
            
            // Solo le enviamos a la IA los textos que le corresponden a ESTA imagen
            let contextoFinal = "";
            if (img.textosEspecificos.length > 0) {
                contextoFinal = `[--- IMPORTANTE: MENSAJE DIRECTO PARA ESTA IMAGEN ---]\n`;
                contextoFinal += img.textosEspecificos.join('\n');
            } else {
                contextoFinal = "No hay contexto de texto para esta imagen.";
            }

            const datosExtraidos = await extraerDatosConIA(
                img.base64, 
                img.mimeType, 
                contextoFinal
            );

            if (datosExtraidos && datosExtraidos.esComprobanteValido) {
                console.log(`📝 Escribiendo comprobante ${index + 1} en Excel...`);
                await escribirFilaEnExcel(datosExtraidos);
            } else {
                console.log(`🗑️ [DESCARTADO] La imagen ${index + 1} no es un comprobante válido.`);
            }
        }

        console.log('\n🎉 ¡FLUJO TERMINADO!');

    }, TIEMPO_ESPERA);
};
