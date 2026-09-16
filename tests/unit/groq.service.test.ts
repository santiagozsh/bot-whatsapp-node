import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    extractTextWithGroqVision,
    discoverActiveVisionModel,
    getOrResolveVisionModel,
    isModelUnavailableError,
    _setGroqClientForTesting,
    _setGroqPacingForTesting,
    _resetVisionModelCacheForTesting,
    DEFAULT_VISION_MODEL,
} from '../../src/services/groq.service';

describe('groq.service.ts (Groq LPU Multimodal Vision Engine)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        _setGroqPacingForTesting(0);
        _resetVisionModelCacheForTesting();
        delete process.env.GROQ_MODEL;
    });

    it('returns empty string if GROQ_API_KEY is not configured', async () => {
        const originalKey = process.env.GROQ_API_KEY;
        delete process.env.GROQ_API_KEY;

        try {
            _setGroqClientForTesting(null);
            const result = await extractTextWithGroqVision('base64_image');
            expect(result).toBe('');
        } finally {
            if (originalKey) process.env.GROQ_API_KEY = originalKey;
        }
    });

    it('extracts text from receipt or label successfully via Groq Chat Completions', async () => {
        const mockCreate = vi.fn().mockResolvedValue({
            choices: [
                {
                    message: {
                        content: 'Nequi $670.000 Para: Jhon Aguirre Ref: M07838801',
                    },
                },
            ],
        });

        const mockClient = {
            chat: {
                completions: {
                    create: mockCreate,
                },
            },
        };

        _setGroqClientForTesting(mockClient);

        const result = await extractTextWithGroqVision('dummy_base64_image', 'image/jpeg');

        expect(result).toBe('Nequi $670.000 Para: Jhon Aguirre Ref: M07838801');
        expect(mockCreate).toHaveBeenCalledTimes(1);
        expect(mockCreate.mock.calls[0][0].max_completion_tokens).toBe(512);
    });

    it('handles API errors gracefully and returns empty string without throwing', async () => {
        const mockCreate = vi.fn().mockRejectedValue(new Error('Rate limit exceeded'));

        const mockClient = {
            chat: {
                completions: {
                    create: mockCreate,
                },
            },
        };

        _setGroqClientForTesting(mockClient);

        const result = await extractTextWithGroqVision('dummy_base64_image');
        expect(result).toBe('');
    });

    describe('Dynamic Discovery & In-Memory Caching', () => {
        it('discovers active models advertising image modality', async () => {
            const mockClient: any = {
                models: {
                    list: vi.fn().mockResolvedValue({
                        data: [
                            { id: 'text-only-model', active: true, input_modalities: ['text'], created: 100 },
                            { id: 'older-vision-model', active: true, input_modalities: ['text', 'image'], created: 200 },
                            { id: 'newest-vision-model', active: true, input_modalities: ['text', 'image'], created: 300 },
                            { id: 'inactive-vision-model', active: false, input_modalities: ['image'], created: 400 },
                        ],
                    }),
                },
            };

            const discovered = await discoverActiveVisionModel(mockClient);
            expect(discovered).toBe('newest-vision-model');
        });

        it('excludes models that are in the excludeModels list', async () => {
            const mockClient: any = {
                models: {
                    list: vi.fn().mockResolvedValue({
                        data: [
                            { id: 'model-a', active: true, input_modalities: ['text', 'image'], created: 300 },
                            { id: 'model-b', active: true, input_modalities: ['text', 'image'], created: 200 },
                        ],
                    }),
                },
            };

            const discovered = await discoverActiveVisionModel(mockClient, ['model-a']);
            expect(discovered).toBe('model-b');
        });

        it('caches resolved model across calls without re-querying the API', async () => {
            const mockList = vi.fn().mockResolvedValue({
                data: [
                    { id: 'discovered-model', active: true, input_modalities: ['image'], created: 100 },
                ],
            });
            const mockClient: any = { models: { list: mockList } };

            const first = await getOrResolveVisionModel(mockClient);
            expect(first).toBe('discovered-model');
            expect(mockList).toHaveBeenCalledTimes(1);

            const second = await getOrResolveVisionModel(mockClient);
            expect(second).toBe('discovered-model');
            expect(mockList).toHaveBeenCalledTimes(1);
        });

        it('respects GROQ_MODEL environment variable unless excluded', async () => {
            process.env.GROQ_MODEL = 'custom/vision-override';
            const mockClient: any = { models: { list: vi.fn() } };

            const model = await getOrResolveVisionModel(mockClient);
            expect(model).toBe('custom/vision-override');

            // If custom/vision-override is excluded, falls back to discovery
            mockClient.models.list.mockResolvedValue({
                data: [{ id: 'fallback-discovered', active: true, input_modalities: ['image'] }],
            });
            const rotated = await getOrResolveVisionModel(mockClient, true, ['custom/vision-override']);
            expect(rotated).toBe('fallback-discovered');
        });

        it('falls back to default static model when model list API fails', async () => {
            const mockClient: any = {
                models: {
                    list: vi.fn().mockRejectedValue(new Error('Network error')),
                },
            };

            const model = await getOrResolveVisionModel(mockClient);
            expect(model).toBe(DEFAULT_VISION_MODEL);
        });
    });

    describe('Self-Healing 404 / Decommissioned Model Auto-Rotation', () => {
        it('identifies model unavailable errors correctly', () => {
            expect(isModelUnavailableError({ status: 404 })).toBe(true);
            expect(isModelUnavailableError({ code: 'model_not_found' })).toBe(true);
            expect(isModelUnavailableError({ code: 'model_decommissioned' })).toBe(true);
            expect(isModelUnavailableError({ message: 'The model does not exist or you do not have access to it.' })).toBe(true);
            expect(isModelUnavailableError({ status: 500, message: 'Internal Server Error' })).toBe(false);
            expect(isModelUnavailableError({ status: 429, message: 'Rate limit' })).toBe(false);
        });

        it('automatically rotates and retries when the primary model returns 404', async () => {
            const error404: any = new Error('The model `qwen/qwen3.6-27b` does not exist or you do not have access to it.');
            error404.status = 404;
            error404.code = 'model_not_found';

            const mockCreate = vi.fn()
                .mockRejectedValueOnce(error404)
                .mockResolvedValueOnce({
                    choices: [
                        {
                            message: {
                                content: 'Bancolombia $350.000 Ref: 981244',
                            },
                        },
                    ],
                });

            const mockList = vi.fn().mockResolvedValue({
                data: [
                    { id: 'qwen/qwen3.6-27b', active: false, input_modalities: ['image'], created: 100 },
                    { id: 'qwen/qwen3.8-27b', active: true, input_modalities: ['image'], created: 200 },
                ],
            });

            const mockClient = {
                chat: {
                    completions: {
                        create: mockCreate,
                    },
                },
                models: {
                    list: mockList,
                },
            };

            _setGroqClientForTesting(mockClient);

            const result = await extractTextWithGroqVision('image_base64_payload');

            expect(result).toBe('Bancolombia $350.000 Ref: 981244');
            expect(mockCreate).toHaveBeenCalledTimes(2);
            // First call used the initial model
            expect(mockCreate.mock.calls[0][0].model).toBe('qwen/qwen3.8-27b');
            // Check that it tried again and succeeded
            expect(result).toContain('Bancolombia');
        });

        it('recovers when an explicit env model fails with 404 by rotating to a discovered model', async () => {
            process.env.GROQ_MODEL = 'qwen/qwen3.6-27b';

            const error404: any = new Error('404 model not found');
            error404.status = 404;

            const mockCreate = vi.fn()
                .mockRejectedValueOnce(error404)
                .mockResolvedValueOnce({
                    choices: [{ message: { content: 'Guía Servientrega 123456789' } }],
                });

            const mockClient = {
                chat: {
                    completions: {
                        create: mockCreate,
                    },
                },
                models: {
                    list: vi.fn().mockResolvedValue({
                        data: [{ id: 'qwen/qwen3.8-27b', active: true, input_modalities: ['image'], created: 500 }],
                    }),
                },
            };

            _setGroqClientForTesting(mockClient);

            const result = await extractTextWithGroqVision('dummy_image');

            expect(result).toBe('Guía Servientrega 123456789');
            expect(mockCreate).toHaveBeenCalledTimes(2);
            expect(mockCreate.mock.calls[0][0].model).toBe('qwen/qwen3.6-27b');
            expect(mockCreate.mock.calls[1][0].model).toBe('qwen/qwen3.8-27b');
        });
    });
});
