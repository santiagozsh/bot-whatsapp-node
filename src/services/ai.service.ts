import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import sharp from 'sharp';
import { buildAccountingPrompt, buildCustomerPrompt } from '../utils/prompts';
import { parseProductList } from '../utils/luxurygotti.data';
import { executeWithRetry, classifyIncomeType, extractVendor, normalizeVendor, resolvePaymentMethod, classifyOrderDescription } from '../utils/helpers';
import { logger } from '../utils/logger';
import { recordOpenAiTokens, startOpenAiTimer } from './metrics.service';
import type { DatosOCRBrutos, DatosIngreso, DatosCliente } from '../types';

dotenv.config();

let openai = new OpenAI({
    apiKey: process.env.OPENAI_API_KEY || 'test-key',
});

/**
 * Injects a mock OpenAI client for isolated testing.
 */
export function _setOpenAiClientForTesting(client: any): void {
    openai = client;
}

/**
 * Optimizes and normalizes an image payload for OCR processing.
 * Downscales to a maximum width of 1200px, applies grayscale conversion, sharpening, and JPEG compression.
 * 
 * @param base64String - Raw base64-encoded image string.
 * @returns Optimized base64 image string (or original string on compression failure).
 */
export async function optimizeImageForOcr(base64String: string): Promise<string> {
    try {
        logger.debug('SHARP', 'Compressing image for OCR...');
        const originalBuffer = Buffer.from(base64String, 'base64');

        const optimizedBuffer = await sharp(originalBuffer)
            .resize({ width: 1200, withoutEnlargement: true, fit: 'inside' })
            .normalize()
            .sharpen()
            .grayscale()
            .jpeg({ quality: 85 })
            .toBuffer();

        return optimizedBuffer.toString('base64');
    } catch (error) {
        logger.error('SHARP', 'Error compressing image, falling back to original:', error);
        return base64String;
    }
}

// Backward-compatible alias
export const optimizarImagenParaOCR = optimizeImageForOcr;

const MAX_OCR_PROMPT_CHARS = 4000;
const MAX_CONTEXT_PROMPT_CHARS = 2000;

/**
 * Sends receipt OCR text to OpenAI (Prompt A) to extract accounting and payment data.
 * Applies local deterministic rules (0 tokens) for income type classification and vendor extraction.
 * 
 * @param ocrText - Text extracted from the receipt image.
 * @param textContext - Conversational messages accumulated in the chat.
 * @param bankByColor - Visual bank hint from dominant color palette analysis.
 * @returns Structured DatosIngreso object if valid receipt, or undefined if invalid.
 */
export const extractAccountingDataFromOcr = async (
    ocrText: string,
    textContext: string,
    bankByColor?: string
): Promise<DatosIngreso | undefined> => {
    try {
        const openaiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';

        let truncatedOcr = ocrText;
        if (ocrText.length > MAX_OCR_PROMPT_CHARS) {
            logger.warn('AI', `OCR truncated: ${ocrText.length} → ${MAX_OCR_PROMPT_CHARS} characters`);
            truncatedOcr = ocrText.substring(0, MAX_OCR_PROMPT_CHARS);
        }

        let truncatedContext = textContext;
        if (textContext.length > MAX_CONTEXT_PROMPT_CHARS) {
            logger.warn('AI', `Context truncated: ${textContext.length} → ${MAX_CONTEXT_PROMPT_CHARS} characters`);
            truncatedContext = textContext.substring(0, MAX_CONTEXT_PROMPT_CHARS);
        }

        logger.debug('AI', `OCR for Prompt A (${truncatedOcr.length} chars): ${truncatedOcr}`);
        logger.debug('AI', `Context for Prompt A (${truncatedContext.length} chars): ${truncatedContext}`);

        const prompt = buildAccountingPrompt(truncatedContext, truncatedOcr, bankByColor);

        if (bankByColor) logger.info('AI', `Visual bank hint: ${bankByColor}`);
        logger.info('AI', 'Sending accounting prompt to OpenAI (Prompt A)...');

        const stopTimerA = startOpenAiTimer('PromptA');
        let result;
        try {
            result = await executeWithRetry(() => openai.chat.completions.create({
                model: openaiModel,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: 'json_object' },
            }));
        } finally {
            stopTimerA();
        }

        const usage = result.usage;
        logger.tokenUsage(usage?.prompt_tokens || 0, usage?.completion_tokens || 0);
        recordOpenAiTokens(usage?.prompt_tokens || 0, usage?.completion_tokens || 0);

        const responseJson = result.choices[0]?.message?.content || '{}';
        logger.info('AI', `Response: ${responseJson.substring(0, 200)}...`);

        const raw: DatosOCRBrutos = JSON.parse(responseJson);

        if (!raw.esComprobanteValido) return undefined;

        const destinationAccount = raw.cuentaDestino || '';
        const incomeType = classifyIncomeType(destinationAccount, ocrText);
        const vendor = extractVendor(textContext);
        const paymentMethod = resolvePaymentMethod(raw.medioDePago, destinationAccount, bankByColor);

        const initialDescription = raw.descripcion === 'PAGOS CONTRAENTREGA'
            ? 'PAGOS CONTRAENTREGA'
            : classifyOrderDescription(raw.precioCompra || '0');

        return {
            esComprobanteValido: true,
            fecha:            raw.fecha            || 'N/A',
            tipo:             incomeType,
            descripcion:      initialDescription,
            precioCompra:     raw.precioCompra     || '0',
            medioDePago:      paymentMethod,
            referenciaDePago: raw.referenciaDePago || 'N/A',
            cuentaDestino:    destinationAccount   || 'N/A',
            vendedor:         vendor,
        };

    } catch (error) {
        logger.error('AI', 'Error processing accounting data with AI:', error);
    }
};

// Backward-compatible alias
export const extraerDatosDesdeTextoOCR = extractAccountingDataFromOcr;

/**
 * Sends chat context to OpenAI (Prompt B) to extract customer name, phone, email, municipality, and vendor.
 * Combines LLM extraction with deterministic local product/quantity parsing.
 * 
 * @param textBlock - Accumulated WhatsApp message context.
 * @returns Structured DatosCliente object or undefined on error.
 */
export const extractCustomerDataFromText = async (textBlock: string): Promise<DatosCliente | undefined> => {
    try {
        const openaiModel = process.env.OPENAI_MODEL || 'gpt-4o-mini';

        const prompt = buildCustomerPrompt(textBlock);

        logger.info('AI', 'Sending customer prompt to OpenAI (Prompt B)...');

        const stopTimerB = startOpenAiTimer('PromptB');
        let result;
        try {
            result = await executeWithRetry(() => openai.chat.completions.create({
                model: openaiModel,
                messages: [{ role: 'user', content: prompt }],
                response_format: { type: 'json_object' },
            }));
        } finally {
            stopTimerB();
        }

        const usage = result.usage;
        logger.tokenUsage(usage?.prompt_tokens || 0, usage?.completion_tokens || 0);
        recordOpenAiTokens(usage?.prompt_tokens || 0, usage?.completion_tokens || 0);

        const responseJson = result.choices[0]?.message?.content || '{}';
        const raw = JSON.parse(responseJson);

        const productData = parseProductList(textBlock);

        const vendorCandidate = raw.vendedor?.trim();
        const normalizedVendor = (vendorCandidate && vendorCandidate !== 'N/A' && vendorCandidate !== 'no identificado')
            ? normalizeVendor(vendorCandidate)
            : 'N/A';

        const customerData: DatosCliente = {
            nombreCliente:  raw.nombreCliente || 'N/A',
            email:          raw.email         || 'N/A',
            telefono:       raw.telefono      || 'N/A',
            municipio:      raw.municipio     || 'N/A',
            vendedor:       normalizedVendor,
            producto:       productData.lineasProducto.join(', '),
            cantidadRelojes: productData.cantidadRelojes,
            cantidadOtros:   productData.cantidadOtros,
        };

        logger.info('AI', `Customer: ${customerData.nombreCliente} | ${customerData.producto}`);
        return customerData;

    } catch (error) {
        logger.error('AI', 'Error processing customer data with AI:', error);
    }
};

// Backward-compatible alias
export const extraerDatosCliente = extractCustomerDataFromText;
