import { extractTextWithGroqVision } from './groq.service';
import { logger } from '../utils/logger';

export type OcrMode = 'comprobante' | 'formulario';

const MIN_TEXT_LENGTH_THRESHOLD = 10;

/**
 * Multimodal AI Vision Perception Service:
 * Uses Groq Cloud LPU Multimodal Vision (Qwen 27B) as the unified perception engine.
 * Capable of reading digital banking receipts, handwritten package shipping notes, and physical invoices.
 * Cost: $0.00 COP (Developer Free Tier).
 *
 * @param imageBase64 - Base64-encoded image string.
 * @param mimeType - Image mime type (default: 'image/jpeg').
 * @returns Clean extracted text string, or empty string on failure.
 */
export const extractTextWithVisionEnhanced = async (
    imageBase64: string,
    mimeType: string = 'image/jpeg'
): Promise<string> => {
    try {
        const groqText = await extractTextWithGroqVision(imageBase64, mimeType);
        if (groqText && groqText.length >= MIN_TEXT_LENGTH_THRESHOLD) {
            return groqText;
        }

        logger.warn('VISION', 'No text extracted from image payload');
        return '';
    } catch (error) {
        logger.error('VISION', 'Fatal error in Vision perception service:', error);
        return '';
    }
};

/**
 * Backward-compatible aliases for legacy callers.
 */
export const extractTextWithVision = extractTextWithVisionEnhanced;
export const extraerTextoConVision = extractTextWithVisionEnhanced;
export const extraerTextoConVisionMejorado = extractTextWithVisionEnhanced;
