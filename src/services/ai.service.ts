import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import sharp from 'sharp';
import { construirPromptContable, construirPromptCliente } from '../utils/prompts';
import { clasificarProducto } from '../utils/luxurygotti.data';
import { extraerTextoConVision } from './vision.service';
import { ejecutarConRetry, normalizarTextoOCR } from '../utils/helpers';

dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Comprime la imagen para Tesseract OCR (comprobantes de pago).
 */
export async function optimizarImagenParaOCR(base64String: string): Promise<string> {
    try {
        console.log('🗜️ [SHARP] Comprimiendo imagen para OCR...');
        const bufferOriginal = Buffer.from(base64String, 'base64');

        const bufferOptimizado = await sharp(bufferOriginal)
            .resize({ width: 1200, withoutEnlargement: true, fit: 'inside' })
            .normalize()
            .sharpen()
            .grayscale()
            .jpeg({ quality: 85 })
            .toBuffer();

        console.log('✅ [SHARP] Imagen lista para OCR.');
        return bufferOptimizado.toString('base64');
    } catch (error) {
        console.error('❌ [SHARP] Error comprimiendo. Usando imagen original:', error);
        return base64String;
    }
}

/**
 * Preprocesado más agresivo para formularios con texto difícil (letra pequeña, manuscrito, mala luz).
 * Usa threshold para binarizar la imagen, ideal para Tesseract en modo formulario.
 */
export async function optimizarImagenParaFormulario(base64String: string): Promise<string> {
    try {
        console.log('🗜️ [SHARP] Preprocesando formulario con threshold...');
        const bufferOriginal = Buffer.from(base64String, 'base64');

        const bufferOptimizado = await sharp(bufferOriginal)
            .resize({ width: 1200, withoutEnlargement: true, fit: 'inside' })
            .normalize()
            .sharpen()
            .grayscale()
            .threshold(128)
            .jpeg({ quality: 90 })
            .toBuffer();

        console.log('✅ [SHARP] Formulario listo para OCR.');
        return bufferOptimizado.toString('base64');
    } catch (error) {
        console.error('❌ [SHARP] Error en formulario. Usando imagen original:', error);
        return base64String;
    }
}

export const extraerDatosConIA = async (imagenBase64: string, mimeType: string, contextoTexto: string) => {
    try {
        const openaiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';

        // PASO 1: Comprimir imagen (para Tesseract OCR local)
        const imagenOptimizadaBase64 = await optimizarImagenParaOCR(imagenBase64);

        // PASO 2: Extraer TEXTO con Tesseract OCR local (sin gastar tokens de OpenAI)
        const textoOCR = normalizarTextoOCR(await extraerTextoConVision(imagenOptimizadaBase64));

        // PASO 3: Construir prompt con el texto extraído + contexto de WhatsApp
        const prompt = construirPromptContable(contextoTexto, textoOCR);

        console.log('🤖 Enviando texto a OpenAI (sin imagen)...');

        // PASO 4: OpenAI recibe SOLO TEXTO → tokens mínimos garantizados
        // ejecutarConRetry reintenta automáticamente si OpenAI devuelve 429 o 500+
        const resultado = await ejecutarConRetry(() => openai.chat.completions.create({
            model: openaiModel,
            messages: [
                {
                    role: 'user',
                    content: prompt,
                },
            ],
            response_format: { type: 'json_object' },
        }));

        const uso = resultado.usage;
        console.log(`📊 [FINANZAS] Tokens: ${uso?.total_tokens} (Entrada: ${uso?.prompt_tokens} | Salida: ${uso?.completion_tokens})`);

        const respuestaJson = resultado.choices[0]?.message?.content || '{}';
        console.log('\n✅ ¡Extracción exitosa! JSON:');
        console.log(respuestaJson);
        return JSON.parse(respuestaJson);

    } catch (error) {
        console.error('❌ Error al procesar con IA:', error);
    }
};

export const extraerDatosCliente = async (bloqueTexto: string) => {
    try {
        const openaiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';

        const prompt = construirPromptCliente(bloqueTexto);

        console.log('🤖 Enviando datos del cliente a OpenAI...');

        const resultado = await ejecutarConRetry(() => openai.chat.completions.create({
            model: openaiModel,
            messages: [
                {
                    role: 'user',
                    content: prompt,
                },
            ],
            response_format: { type: 'json_object' },
        }));

        const uso = resultado.usage;
        console.log(`📊 [CLIENTE] Tokens: ${uso?.total_tokens} (Entrada: ${uso?.prompt_tokens} | Salida: ${uso?.completion_tokens})`);

        const respuestaJson = resultado.choices[0]?.message?.content || '{}';
        const datosCliente = JSON.parse(respuestaJson);

        const { cantidadRelojes, cantidadOtros } = clasificarProducto(datosCliente.producto || '');
        datosCliente.cantidadRelojes = cantidadRelojes;
        datosCliente.cantidadOtros = cantidadOtros;

        console.log('\n✅ ¡Extracción de cliente exitosa! JSON:');
        console.log(JSON.stringify(datosCliente));
        return datosCliente;

    } catch (error) {
        console.error('❌ Error al procesar datos del cliente con IA:', error);
    }
};


