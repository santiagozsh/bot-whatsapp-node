import Tesseract from 'tesseract.js';
import sharp from 'sharp';
import { extractTextWithGroqVision } from './groq.service';
import { logger } from '../utils/logger';

export type OcrMode = 'comprobante' | 'formulario';

const MIN_TEXT_LENGTH_THRESHOLD = 10;

let workerInstance: Tesseract.Worker | null = null;
let workerLoadingPromise: Promise<Tesseract.Worker> | null = null;

/**
 * Initializes or retrieves the persistent Tesseract worker singleton.
 */
export async function getTesseractWorker(): Promise<Tesseract.Worker> {
    if (workerInstance) return workerInstance;
    if (workerLoadingPromise) return workerLoadingPromise;

    workerLoadingPromise = (async () => {
        logger.debug('OCR', 'Initializing persistent Tesseract worker (spa+eng)...');
        const worker = await Tesseract.createWorker('spa+eng');
        await worker.setParameters({
            tessedit_pageseg_mode: Tesseract.PSM.AUTO,
        });
        workerInstance = worker;
        return workerInstance;
    })();

    return workerLoadingPromise;
}

/**
 * Gracefully terminates the persistent worker (used in lifecycle hooks/testing).
 */
export async function terminateTesseractWorker(): Promise<void> {
    if (workerInstance) {
        await workerInstance.terminate();
        workerInstance = null;
        workerLoadingPromise = null;
    }
}

/**
 * Injects a mock worker for isolated unit testing.
 */
export function _setTesseractWorkerForTesting(worker: any): void {
    workerInstance = worker;
    workerLoadingPromise = worker ? Promise.resolve(worker) : null;
}

/**
 * Optimizes an image buffer specifically for high-accuracy local OCR:
 * - Upscales/downscales to an optimal width of 1500px using sharp.
 * - Applies grayscale conversion and gamma correction (1.2) for text contrast.
 * - Applies edge-sharpening (sigma 1.5).
 * - Exports as lossless PNG buffer to prevent JPEG compression artifacts around digits.
 */
export async function preprocessImageForOcr(buffer: Buffer, invert: boolean = false): Promise<Buffer> {
    try {
        let pipeline = sharp(buffer)
            .resize({ width: 1500, withoutEnlargement: true, fit: 'inside' })
            .grayscale()
            .gamma(1.2)
            .normalize()
            .sharpen({ sigma: 1.5 });

        if (invert) {
            pipeline = pipeline.negate({ alpha: false });
        }

        return await pipeline.png().toBuffer();
    } catch (error) {
        logger.warn('SHARP', 'Image preprocessing error, falling back to raw buffer:', error);
        return buffer;
    }
}

/**
 * High-Performance Dual-Pass Local OCR Engine (Tertiary Fallback).
 */
export const extractTextWithVision = async (
    imageBase64: string,
    _mimeType?: string
): Promise<string> => {
    try {
        const rawBuffer = Buffer.from(imageBase64, 'base64');
        const worker = await getTesseractWorker();

        // Pass 1: Standard high-contrast PNG
        const pass1Buffer = await preprocessImageForOcr(rawBuffer, false);
        const res1 = await worker.recognize(pass1Buffer);
        const text1 = (res1?.data?.text || '').trim();

        if (text1 && text1.length >= MIN_TEXT_LENGTH_THRESHOLD) {
            return text1;
        }

        // Pass 2: Inverted binarization for dark receipts / dark mode
        const pass2Buffer = await preprocessImageForOcr(rawBuffer, true);
        const res2 = await worker.recognize(pass2Buffer);
        const text2 = (res2?.data?.text || '').trim();

        if (text2 && text2.length >= MIN_TEXT_LENGTH_THRESHOLD) {
            return text2;
        }

        if (text1) return text1;
        if (text2) return text2;

        return 'SIN_TEXTO_DETECTADO';

    } catch (error) {
        logger.error('OCR', 'Error in local OCR pipeline:', error);
        return 'SIN_TEXTO_DETECTADO';
    }
};

/**
 * Resilient AI Vision Cascade:
 * 1. Primary Engine: Groq Cloud Multimodal Vision (Qwen 27B) — 100% Free ($0 COP, zero tokens on OpenAI).
 * 2. Secondary Fallback: Local Tesseract OCR — Offline emergency fallback.
 * 
 * Note: OpenAI NEVER receives images; OpenAI is strictly reserved for text processing (Prompt A & B).
 * 
 * @param imageBase64 - Base64-encoded image string.
 * @param mimeType - Image mime type (default: 'image/jpeg').
 * @returns Recognized text string or empty string.
 */
export const extractTextWithVisionEnhanced = async (
    imageBase64: string,
    mimeType: string = 'image/jpeg'
): Promise<string> => {
    try {
        // Step 1: Groq Cloud LPU Vision (Primary Free Tier Engine)
        const groqText = await extractTextWithGroqVision(imageBase64, mimeType);
        if (groqText && groqText.length >= MIN_TEXT_LENGTH_THRESHOLD) {
            return groqText;
        }

        logger.warn('VISION', 'Groq Vision returned empty text. Falling back to local Tesseract OCR...');

        // Step 2: Local Tesseract OCR (Emergency Offline Fallback)
        const tesseractText = await extractTextWithVision(imageBase64);
        if (tesseractText && tesseractText !== 'SIN_TEXTO_DETECTADO' && tesseractText.length >= MIN_TEXT_LENGTH_THRESHOLD) {
            return tesseractText;
        }

        return '';
    } catch (error) {
        logger.error('VISION', 'Fatal error in Vision cascade:', error);
        return '';
    }
};

// Backward-compatible aliases
export const extraerTextoConVision = extractTextWithVision;
export const extraerTextoConVisionMejorado = extractTextWithVisionEnhanced;
