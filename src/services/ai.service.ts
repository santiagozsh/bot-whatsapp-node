import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import sharp from 'sharp';
import { construirPromptContable, construirPromptCliente } from '../utils/prompts';
import { extraerTextoConVision } from './vision.service';
import { ejecutarConRetry } from '../utils/helpers';

dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

/**
 * Comprime la imagen antes de enviarla a Tesseract OCR (local).
 * Beneficios: menos píxeles = OCR más rápido, menor uso de RAM,
 * y normaliza el formato a JPEG para mejor compatibilidad con Tesseract.
 */
async function optimizarImagenParaOCR(base64String: string): Promise<string> {
    try {
        console.log('🗜️ [SHARP] Comprimiendo imagen para OCR...');
        const bufferOriginal = Buffer.from(base64String, 'base64');

        // 1200px de ancho es suficiente para que Vision lea texto pequeño.
        // No recortamos (fit: 'inside') para no perder partes del comprobante.
        const bufferOptimizado = await sharp(bufferOriginal)
            .resize({ width: 1200, withoutEnlargement: true, fit: 'inside' })
            .jpeg({ quality: 85 })
            .toBuffer();

        console.log('✅ [SHARP] Imagen lista para OCR.');
        return bufferOptimizado.toString('base64');
    } catch (error) {
        console.error('❌ [SHARP] Error comprimiendo. Usando imagen original:', error);
        return base64String;
    }
}

export const extraerDatosConIA = async (imagenBase64: string, mimeType: string, contextoTexto: string) => {
    try {
        const openaiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';

        // PASO 1: Comprimir imagen (para Tesseract OCR local)
        const imagenOptimizadaBase64 = await optimizarImagenParaOCR(imagenBase64);

        // PASO 2: Extraer TEXTO con Tesseract OCR local (sin gastar tokens de OpenAI)
        const textoOCR = await extraerTextoConVision(imagenOptimizadaBase64);

        // 🔍 DEBUG: Muestra el texto que Vision extrajo
        // console.log('━━━━━━ [VISION OCR - TEXTO EXTRAÍDO] ━━━━━━');
        // console.log(textoOCR);
        // console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

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
        console.log('\n✅ ¡Extracción de cliente exitosa! JSON:');
        console.log(respuestaJson);
        return JSON.parse(respuestaJson);

    } catch (error) {
        console.error('❌ Error al procesar datos del cliente con IA:', error);
    }
};
