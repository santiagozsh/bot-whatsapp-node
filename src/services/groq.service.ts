import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import { executeWithRetry } from '../utils/helpers';
import { logger } from '../utils/logger';

dotenv.config();

let groqClientInstance: OpenAI | null = null;
let lastGroqRequestTimestamp = 0;
let minRequestIntervalMs = 4500;

function getGroqClient(): OpenAI | null {
    if (groqClientInstance !== null) {
        return groqClientInstance;
    }
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
        return null;
    }
    groqClientInstance = new OpenAI({
        baseURL: 'https://api.groq.com/openai/v1',
        apiKey,
    });
    return groqClientInstance;
}

/**
 * Injects a mock Groq client for isolated testing.
 */
export function _setGroqClientForTesting(client: any): void {
    groqClientInstance = client;
}

/**
 * Sets or resets request pacing for unit testing.
 */
export function _setGroqPacingForTesting(intervalMs: number): void {
    minRequestIntervalMs = intervalMs;
    lastGroqRequestTimestamp = 0;
}

async function applyGroqRatePacing(): Promise<void> {
    if (minRequestIntervalMs <= 0) return;

    const now = Date.now();
    const elapsed = now - lastGroqRequestTimestamp;
    if (lastGroqRequestTimestamp > 0 && elapsed < minRequestIntervalMs) {
        const waitMs = minRequestIntervalMs - elapsed;
        logger.info('GROQ', `Pacing request: waiting ${(waitMs / 1000).toFixed(1)}s to stay safely within token quota...`);
        await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
    lastGroqRequestTimestamp = Date.now();
}

const VISION_SYSTEM_PROMPT = `Act as an expert OCR and data transcription engine for Colombian business receipts, remittances, and shipping packages.
Transcribe ALL visible text from this image faithfully, exhaustively, and accurately.

Guidelines:
- Digital Bank Receipts (Nequi, Bancolombia, Davivienda, DaviPlata, Nu, BBVA, etc.):
  Transcribe the bank name, amount/valor, date, reference/approval code, destination account/phone, and sender/receiver names.
- Shipping Packages & Handwritten Labels:
  Transcribe all handwritten names, cédulas, phone numbers, addresses, city/municipality, products, and prices.
- Return ONLY the clean transcribed plain text without markdown fences or extraneous conversational preamble.`;

/**
 * Extracts high-accuracy text from an image payload using Groq Cloud LPU Multimodal Vision (Qwen 27B).
 * Implements smooth rate-pacing (~4.5s per image) to process image bursts cleanly within the 8K TPM free tier.
 * Cost: $0.00 COP (Developer Free Tier on console.groq.com).
 * 
 * @param imageBase64 - Base64-encoded image string.
 * @param mimeType - Mime type of the image (default: 'image/jpeg').
 * @returns Clean transcribed text string, or empty string on failure.
 */
export async function extractTextWithGroqVision(
    imageBase64: string,
    mimeType: string = 'image/jpeg'
): Promise<string> {
    try {
        const client = getGroqClient();
        if (!client) {
            logger.debug('GROQ', 'GROQ_API_KEY not configured, skipping Groq Vision');
            return '';
        }

        await applyGroqRatePacing();

        const modelName = process.env.GROQ_MODEL || 'qwen/qwen3.6-27b';
        logger.info('GROQ', `Extracting text with Groq Vision (${modelName})...`);

        const response = await executeWithRetry(async () => {
            return await client.chat.completions.create({
                model: modelName,
                messages: [
                    {
                        role: 'user',
                        content: [
                            { type: 'text', text: VISION_SYSTEM_PROMPT },
                            {
                                type: 'image_url',
                                image_url: {
                                    url: `data:${mimeType};base64,${imageBase64}`,
                                },
                            },
                        ],
                    },
                ],
                temperature: 0.1,
                max_completion_tokens: 1024,
            });
        }, 4, 4000); // 4 attempts with 4s backoff on 429

        const extractedText = (response.choices[0]?.message?.content || '').trim();
        if (!extractedText) {
            logger.warn('GROQ', 'No text extracted by Groq Vision');
            return '';
        }

        logger.info('GROQ', `Text successfully extracted via Groq Vision (${extractedText.length} chars)`);
        logger.debug('GROQ', extractedText);
        return extractedText;

    } catch (error) {
        logger.error('GROQ', 'Error extracting text with Groq Vision:', error);
        return '';
    }
}
