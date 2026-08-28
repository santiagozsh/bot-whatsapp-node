import Tesseract from 'tesseract.js';
import { logger } from '../utils/logger';

interface TrOCRPipeline {
    (input: string | Buffer): Promise<{ generated_text: string }>;
}

export type OcrMode = 'comprobante' | 'formulario';

/**
 * Extracts raw text from an image payload using local Tesseract OCR (spa+eng).
 *
 * @param imageBase64 - Base64-encoded image string.
 * @param mode - 'comprobante' (default) | 'formulario' (PSM SINGLE_BLOCK).
 * @returns Extracted raw text or 'SIN_TEXTO_DETECTADO'.
 */
export const extractTextWithVision = async (
    imageBase64: string,
    mode: OcrMode = 'comprobante'
): Promise<string> => {
    try {
        logger.debug('OCR', `Extracting text (${mode})...`);

        const buffer = Buffer.from(imageBase64, 'base64');

        let result: Tesseract.RecognizeResult;

        if (mode === 'formulario') {
            const worker = await Tesseract.createWorker('spa+eng', Tesseract.OEM.LSTM_ONLY);
            await worker.setParameters({
                tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
            });
            result = await worker.recognize(buffer);
            await worker.terminate();
        } else {
            result = await Tesseract.recognize(
                buffer,
                'spa+eng',
                { logger: () => {} }
            );
        }

        const extractedText = result.data.text.trim();

        if (!extractedText) {
            logger.warn('OCR', 'No text detected in image.');
            return 'SIN_TEXTO_DETECTADO';
        }

        logger.debug('OCR', `Text extracted (${extractedText.length} characters).`);
        logger.debug('OCR', extractedText);
        return extractedText;

    } catch (error) {
        logger.error('OCR', 'Error in Tesseract OCR:', error);
        throw error;
    }
};

// Backward-compatible alias
export const extraerTextoConVision = extractTextWithVision;

let trocrPipeline: TrOCRPipeline | null = null;
let trocrLoadingPromise: Promise<TrOCRPipeline | null> | null = null;

async function loadTrOCR(): Promise<TrOCRPipeline | null> {
    try {
        logger.debug('TrOCR', 'Loading model microsoft/trocr-base-handwritten...');

        const { pipeline } = await import('@xenova/transformers');
        trocrPipeline = await pipeline('image-to-text', 'Xenova/trocr-base-handwritten') as unknown as TrOCRPipeline;

        logger.debug('TrOCR', 'TrOCR model loaded successfully');
        return trocrPipeline;
    } catch (error) {
        logger.error('TrOCR', 'Error loading TrOCR model:', error);
        return null;
    }
}

async function getTrOCR(): Promise<TrOCRPipeline | null> {
    if (trocrPipeline) return trocrPipeline;
    if (trocrLoadingPromise) return trocrLoadingPromise;

    trocrLoadingPromise = loadTrOCR();
    return trocrLoadingPromise;
}

const MIN_TEXT_LENGTH_THRESHOLD = 10;

/**
 * Cascading OCR pipeline:
 * 1. Tesseract OCR first (fast, ideal for digital receipts and screenshots).
 * 2. If Tesseract text is empty or too short (< 10 chars) -> TrOCR fallback (specialized for handwritten notes).
 * 3. If TrOCR also fails -> returns empty string (discarded, 0 tokens spent).
 *
 * @param imageBase64 - Optimized base64 image string.
 * @returns Recognized text string or empty string.
 */
export const extractTextWithVisionEnhanced = async (
    imageBase64: string
): Promise<string> => {
    try {
        const tesseractText = await extractTextWithVision(imageBase64);

        const isValidText = tesseractText
            && tesseractText !== 'SIN_TEXTO_DETECTADO'
            && tesseractText.length >= MIN_TEXT_LENGTH_THRESHOLD;

        if (isValidText) {
            return tesseractText;
        }

        logger.debug('TrOCR', `Tesseract produced short/empty text (${tesseractText.length} chars). Attempting TrOCR...`);

        const pipeline = await getTrOCR();
        if (!pipeline) {
            logger.warn('TrOCR', 'TrOCR model unavailable, discarding image');
            return '';
        }

        const buffer = Buffer.from(imageBase64, 'base64');
        const result = await pipeline(buffer);
        const trocrText = (result?.generated_text || '').trim();

        if (trocrText && trocrText.length >= MIN_TEXT_LENGTH_THRESHOLD) {
            logger.debug('TrOCR', `Text extracted with TrOCR (${trocrText.length} chars).`);
            return trocrText;
        }

        logger.warn('TrOCR', 'No text detected via TrOCR either.');
        return '';

    } catch (error) {
        logger.error('OCR', 'Error in enhanced OCR cascade:', error);
        return '';
    }
};

// Backward-compatible alias
export const extraerTextoConVisionMejorado = extractTextWithVisionEnhanced;
