import OpenAI from 'openai';
import * as dotenv from 'dotenv';
import { executeWithRetry } from '../utils/helpers';
import { logger } from '../utils/logger';

dotenv.config();

let groqClientInstance: OpenAI | null = null;
let lastGroqRequestTimestamp = 0;
let minRequestIntervalMs = 4500;

export const DEFAULT_VISION_MODEL = 'qwen/qwen3.8-27b';
export const FALLBACK_VISION_MODELS = [
    'qwen/qwen3.8-27b',
    'qwen/qwen3.6-27b',
];

interface CachedModelInfo {
    model: string;
    cachedAt: number;
}

let activeVisionModelCache: CachedModelInfo | null = null;
const MODEL_CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

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

/**
 * Resets the in-memory vision model cache for testing.
 */
export function _resetVisionModelCacheForTesting(): void {
    activeVisionModelCache = null;
}

/**
 * Discovers active multimodal vision models from the Groq API.
 * Identifies active models advertising 'image' in their input modalities.
 * 
 * @param client - OpenAI-compatible Groq client.
 * @param excludeModels - List of model identifiers to ignore (e.g. failing or deprecated models).
 * @returns Best matching active vision model ID, or null if none discovered.
 */
export async function discoverActiveVisionModel(
    client: OpenAI,
    excludeModels: string[] = []
): Promise<string | null> {
    try {
        if (!client.models || typeof client.models.list !== 'function') {
            return null;
        }

        const response = await client.models.list();
        const models = (response as any).data || [];

        const visionCandidates = models
            .filter((m: any) => {
                const isActive = m.active !== false;
                const hasImageModality = Array.isArray(m.input_modalities) && m.input_modalities.includes('image');
                const isExcluded = excludeModels.includes(m.id);
                return isActive && hasImageModality && !isExcluded;
            })
            .sort((a: any, b: any) => (b.created || 0) - (a.created || 0));

        if (visionCandidates.length > 0) {
            const selected = visionCandidates[0].id;
            logger.info('GROQ', `Discovered active vision model from Groq API: ${selected}`);
            return selected;
        }
    } catch (error) {
        logger.warn('GROQ', 'Failed to dynamically query active models from Groq API:', error);
    }
    return null;
}

/**
 * Resolves the vision model to use, prioritizing runtime discovery and caching.
 * Falls back to curated models or environment overrides when necessary.
 */
export async function getOrResolveVisionModel(
    client: OpenAI,
    forceRefresh: boolean = false,
    excludeModels: string[] = []
): Promise<string> {
    // 1. Explicit env override if set and not excluded
    const envModel = process.env.GROQ_MODEL?.trim();
    if (envModel && !excludeModels.includes(envModel)) {
        return envModel;
    }

    // 2. Return cached model if valid and not excluded
    const now = Date.now();
    if (
        !forceRefresh &&
        activeVisionModelCache &&
        now - activeVisionModelCache.cachedAt < MODEL_CACHE_TTL_MS &&
        !excludeModels.includes(activeVisionModelCache.model)
    ) {
        return activeVisionModelCache.model;
    }

    // 3. Dynamic discovery from Groq API
    const discovered = await discoverActiveVisionModel(client, excludeModels);
    if (discovered) {
        activeVisionModelCache = { model: discovered, cachedAt: now };
        return discovered;
    }

    // 4. Resilient static fallback
    const fallback = FALLBACK_VISION_MODELS.find((m) => !excludeModels.includes(m)) || DEFAULT_VISION_MODEL;
    activeVisionModelCache = { model: fallback, cachedAt: now };
    logger.info('GROQ', `Using fallback vision model: ${fallback}`);
    return fallback;
}

/**
 * Evaluates whether an error indicates model unavailability (404, not found, or decommissioned).
 */
export function isModelUnavailableError(error: any): boolean {
    const status = error?.status || error?.response?.status;
    const code = error?.code || error?.error?.code;
    const message = (error?.message || error?.error?.message || '').toLowerCase();

    return (
        status === 404 ||
        code === 'model_not_found' ||
        code === 'model_decommissioned' ||
        message.includes('does not exist') ||
        message.includes('do not have access to it') ||
        message.includes('decommissioned')
    );
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

        const excludedModels: string[] = [];
        let modelName = await getOrResolveVisionModel(client, false, excludedModels);
        const maxModelAttempts = 3;

        for (let attempt = 0; attempt < maxModelAttempts; attempt++) {
            logger.info('GROQ', `Extracting text with Groq Vision (${modelName})...`);

            try {
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
            } catch (err: any) {
                if (isModelUnavailableError(err) && attempt < maxModelAttempts - 1) {
                    logger.warn(
                        'GROQ',
                        `Model '${modelName}' is unavailable or decommissioned (${err?.status || err?.code}). Initiating automatic model rotation...`
                    );
                    excludedModels.push(modelName);
                    modelName = await getOrResolveVisionModel(client, true, excludedModels);
                    logger.info('GROQ', `Rotated to model '${modelName}'. Retrying image transcription...`);
                    continue;
                }
                throw err;
            }
        }

        return '';

    } catch (error) {
        logger.error('GROQ', 'Error extracting text with Groq Vision:', error);
        return '';
    }
}
