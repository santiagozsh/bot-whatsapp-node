import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    extractTextWithVision,
    extractTextWithVisionEnhanced,
    extraerTextoConVision,
    extraerTextoConVisionMejorado,
} from '../../src/services/vision.service';
import * as groqService from '../../src/services/groq.service';

describe('vision.service.ts (Multimodal AI Vision Service)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
    });

    describe('extractTextWithVisionEnhanced', () => {
        it('extracts and returns text using Groq Vision successfully', async () => {
            vi.spyOn(groqService, 'extractTextWithGroqVision').mockResolvedValue(
                'Nequi $670.000 Ref: M07838801 Para: Jhon Aguirre'
            );

            const result = await extractTextWithVisionEnhanced('dummy_base64', 'image/jpeg');

            expect(result).toBe('Nequi $670.000 Ref: M07838801 Para: Jhon Aguirre');
            expect(groqService.extractTextWithGroqVision).toHaveBeenCalledWith('dummy_base64', 'image/jpeg');
        });

        it('returns empty string when Groq Vision yields empty or short text', async () => {
            vi.spyOn(groqService, 'extractTextWithGroqVision').mockResolvedValue('abc');

            const result = await extractTextWithVisionEnhanced('dummy_base64');
            expect(result).toBe('');
        });

        it('handles exceptions gracefully and returns empty string', async () => {
            vi.spyOn(groqService, 'extractTextWithGroqVision').mockRejectedValue(new Error('Network failure'));

            const result = await extractTextWithVisionEnhanced('dummy_base64');
            expect(result).toBe('');
        });

        it('maintains backward-compatible aliases for legacy callers', async () => {
            vi.spyOn(groqService, 'extractTextWithGroqVision').mockResolvedValue(
                'Comprobante Bancolombia $320.000'
            );

            expect(await extractTextWithVision('dummy_base64')).toBe('Comprobante Bancolombia $320.000');
            expect(await extraerTextoConVision('dummy_base64')).toBe('Comprobante Bancolombia $320.000');
            expect(await extraerTextoConVisionMejorado('dummy_base64')).toBe('Comprobante Bancolombia $320.000');
        });
    });
});
