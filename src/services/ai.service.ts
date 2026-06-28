import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import sharp from 'sharp';
import { construirPromptContable, construirPromptCliente } from '../utils/prompts';
import { clasificarProducto } from '../utils/luxurygotti.data';
import { ejecutarConRetry } from '../utils/helpers';
import { logger } from '../utils/logger';

dotenv.config();

const openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY,
});

export async function optimizarImagenParaOCR(base64String: string): Promise<string> {
    try {
        logger.info('SHARP', 'Comprimiendo imagen...');
        const bufferOriginal = Buffer.from(base64String, 'base64');

        const bufferOptimizado = await sharp(bufferOriginal)
            .resize({ width: 1200, withoutEnlargement: true, fit: 'inside' })
            .normalize()
            .sharpen()
            .grayscale()
            .jpeg({ quality: 85 })
            .toBuffer();

        return bufferOptimizado.toString('base64');
    } catch (error) {
        logger.error('SHARP', 'Error comprimiendo, usando original:', error);
        return base64String;
    }
}

/**
 * Envía texto OCR pre-extraído a OpenAI para extraer datos financieros.
 * Sin compresión ni OCR — solo el prompt + texto.
 */
export const extraerDatosDesdeTextoOCR = async (
    textoOCR: string,
    contextoTexto: string
) => {
    try {
        const openaiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';
        const prompt = construirPromptContable(contextoTexto, textoOCR);

        logger.info('AI', 'Enviando texto a OpenAI (Prompt A — contable)...');

        const resultado = await ejecutarConRetry(() => openai.chat.completions.create({
            model: openaiModel,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
        }));

        const uso = resultado.usage;
        logger.tokenUsage(uso?.prompt_tokens || 0, uso?.completion_tokens || 0);

        const respuestaJson = resultado.choices[0]?.message?.content || '{}';
        logger.info('AI', `Respuesta: ${respuestaJson.substring(0, 200)}...`);
        return JSON.parse(respuestaJson);

    } catch (error) {
        logger.error('AI', 'Error al procesar con IA:', error);
    }
};

export const extraerDatosCliente = async (bloqueTexto: string) => {
    try {
        const openaiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';

        const prompt = construirPromptCliente(bloqueTexto);

        logger.info('AI', 'Enviando a OpenAI (Prompt B — cliente)...');

        const resultado = await ejecutarConRetry(() => openai.chat.completions.create({
            model: openaiModel,
            messages: [{ role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
        }));

        const uso = resultado.usage;
        logger.tokenUsage(uso?.prompt_tokens || 0, uso?.completion_tokens || 0);

        const respuestaJson = resultado.choices[0]?.message?.content || '{}';
        const datosCliente = JSON.parse(respuestaJson);

        const { cantidadRelojes, cantidadOtros } = clasificarProducto(datosCliente.producto || '');
        datosCliente.cantidadRelojes = cantidadRelojes;
        datosCliente.cantidadOtros = cantidadOtros;

        logger.info('AI', `Cliente: ${datosCliente.nombreCliente || 'N/A'} | ${datosCliente.producto || 'N/A'}`);
        return datosCliente;

    } catch (error) {
        logger.error('AI', 'Error en datos de cliente:', error);
    }
};
