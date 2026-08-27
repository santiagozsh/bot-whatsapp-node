import { describe, it, expect } from 'vitest';
import { buildAccountingPrompt, buildCustomerPrompt } from '../../src/utils/prompts';

describe('prompts.ts — LLM Prompt Builders', () => {
    describe('buildAccountingPrompt', () => {
        it('builds accounting prompt with OCR text and conversation context', () => {
            const prompt = buildAccountingPrompt('venta Karol', 'Comprobante Nequi $165.000 M123456');

            expect(prompt).toContain('Accounting Analyst');
            expect(prompt).toContain('Comprobante Nequi $165.000 M123456');
            expect(prompt).toContain('venta Karol');
            expect(prompt).toContain('JSON: {"esComprobanteValido":true');
        });

        it('includes visual bank hint when color detection passes bank name', () => {
            const prompt = buildAccountingPrompt('', 'Comprobante', 'Bancolombia');

            expect(prompt).toContain('VISUALLY DETECTED BANK: Bancolombia');
        });

        it('omits bank hint when no visual bank is detected', () => {
            const prompt = buildAccountingPrompt('', 'Comprobante');

            expect(prompt).not.toContain('VISUALLY DETECTED BANK');
        });
    });

    describe('buildCustomerPrompt', () => {
        it('builds customer extraction prompt with text block and JSON target schema', () => {
            const prompt = buildCustomerPrompt('Yenci Perez 3106131751 Armenia venta Karol');

            expect(prompt).toContain('Sales Assistant');
            expect(prompt).toContain('Yenci Perez 3106131751 Armenia venta Karol');
            expect(prompt).toContain('JSON: {"nombreCliente":');
        });
    });
});
