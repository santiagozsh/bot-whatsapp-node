import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import sharp from 'sharp';
import { construirPromptContable, construirPromptCliente } from '../utils/prompts';
import { extraerListaProductos } from '../utils/luxurygotti.data';
import { ejecutarConRetry, clasificarTipoIngreso, extraerVendedor } from '../utils/helpers';
import { logger } from '../utils/logger';
import type { DatosIngreso, DatosCliente } from '../types';

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

interface DatosOCRBrutos {
    esComprobanteValido: boolean;
    fecha?: string;
    descripcion?: string;
    precioCompra?: string;
    medioDePago?: string;
    referenciaDePago?: string;
    cuentaDestino?: string;
}

/**
 * Envía texto OCR a OpenAI (Prompt A).
 * Luego clasifica tipo y extrae vendedor en TypeScript (determinístico, 0 tokens).
 */
export const extraerDatosDesdeTextoOCR = async (
    textoOCR: string,
    contextoTexto: string,
    bancoPorColor?: string
): Promise<DatosIngreso | undefined> => {
    try {
        const openaiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';
        const prompt = construirPromptContable(contextoTexto, textoOCR, bancoPorColor);

        if (bancoPorColor) logger.info('AI', `Banco por color: ${bancoPorColor}`);
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

        const crudo: DatosOCRBrutos = JSON.parse(respuestaJson);

        if (!crudo.esComprobanteValido) return undefined;

        const cuenta = crudo.cuentaDestino || '';
        const tipo = clasificarTipoIngreso(cuenta, textoOCR);
        const vendedor = extraerVendedor(contextoTexto);

        const medioDePago = tipo === 'Abono'
            ? 'Nequi bodega'
            : bancoPorColor || crudo.medioDePago || 'No detectado';

        return {
            esComprobanteValido: true,
            fecha:            crudo.fecha            || 'N/A',
            tipo,
            descripcion:      crudo.descripcion      || 'Pedido al por menor',
            precioCompra:     crudo.precioCompra     || '0',
            medioDePago,
            referenciaDePago: crudo.referenciaDePago || 'N/A',
            cuentaDestino:    cuenta                 || 'N/A',
            vendedor,
        };

    } catch (error) {
        logger.error('AI', 'Error al procesar con IA:', error);
    }
};

export const extraerDatosCliente = async (bloqueTexto: string): Promise<DatosCliente | undefined> => {
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
        const crudo = JSON.parse(respuestaJson);

        const datosProducto = extraerListaProductos(bloqueTexto);

        const datosCliente: DatosCliente = {
            nombreCliente:  crudo.nombreCliente || 'N/A',
            email:          crudo.email         || 'N/A',
            telefono:       crudo.telefono      || 'N/A',
            municipio:      crudo.municipio     || 'N/A',
            vendedor:       crudo.vendedor      || 'N/A',
            producto:       datosProducto.lineasProducto.join(', '),
            cantidadRelojes: datosProducto.cantidadRelojes,
            cantidadOtros:   datosProducto.cantidadOtros,
        };

        logger.info('AI', `Cliente: ${datosCliente.nombreCliente} | ${datosCliente.producto}`);
        return datosCliente;

    } catch (error) {
        logger.error('AI', 'Error en datos de cliente:', error);
    }
};
