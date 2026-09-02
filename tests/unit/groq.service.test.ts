import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    extractTextWithGroqVision,
    _setGroqClientForTesting,
    _setGroqPacingForTesting,
} from '../../src/services/groq.service';

describe('groq.service.ts (Groq LPU Multimodal Vision Engine)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        _setGroqPacingForTesting(0);
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
});
