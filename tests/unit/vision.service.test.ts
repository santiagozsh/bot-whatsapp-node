import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    extractTextWithVision,
    extractTextWithVisionEnhanced,
    _setTesseractWorkerForTesting,
} from '../../src/services/vision.service';
import * as groqService from '../../src/services/groq.service';

describe('vision.service.ts (AI Vision Cascade: Groq -> Tesseract)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    afterEach(async () => {
        _setTesseractWorkerForTesting(null);
    });

    describe('extractTextWithVisionEnhanced', () => {
        it('uses Groq Vision as primary and returns its output without falling back to Tesseract', async () => {
            vi.spyOn(groqService, 'extractTextWithGroqVision').mockResolvedValue(
                'Nequi $670.000 Ref: M07838801'
            );

            const result = await extractTextWithVisionEnhanced('dummy_base64');

            expect(result).toBe('Nequi $670.000 Ref: M07838801');
        });

        it('falls back to local Tesseract when Groq Vision returns empty string', async () => {
            vi.spyOn(groqService, 'extractTextWithGroqVision').mockResolvedValue('');

            const mockWorker = {
                recognize: vi.fn().mockResolvedValue({
                    data: { text: 'Tesseract Fallback: Bancolombia $320.000' },
                }),
            };
            _setTesseractWorkerForTesting(mockWorker);

            const dummyBase64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAAAAAA6fptVAAAACklEQVR4nGNiAAAABgADNjd8qAAAAABJRU5ErkJggg==';
            const result = await extractTextWithVisionEnhanced(dummyBase64);

            expect(result).toBe('Tesseract Fallback: Bancolombia $320.000');
        });
    });
});
