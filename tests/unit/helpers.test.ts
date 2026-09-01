import { describe, it, expect, vi } from 'vitest';
import sharp from 'sharp';
import {
    formatDate,
    formatAccountNumber,
    executeWithRetry,
    normalizeText,
    normalizeOcrText,
    classifyIncomeType,
    resolvePaymentMethod,
    extractVendor,
    isUsefulText,
    detectBankByColor,
} from '../../src/utils/helpers';

describe('helpers.ts', () => {
    describe('formatDate', () => {
        it('formats DD/MM/YYYY into D-Mes-YYYY format without leading zero on day', () => {
            expect(formatDate('01/01/2026')).toBe('1-Ene-2026');
            expect(formatDate('15/05/2026')).toBe('15-May-2026');
            expect(formatDate('31/12/2025')).toBe('31-Dic-2025');
        });

        it('returns original input if date format does not match DD/MM/YYYY', () => {
            expect(formatDate('2026-01-01')).toBe('2026-01-01');
            expect(formatDate('invalid-date')).toBe('invalid-date');
        });
    });

    describe('formatAccountNumber', () => {
        it('formats a 10-digit number into 3-3-4 spaced segments', () => {
            expect(formatAccountNumber('3143527475')).toBe('314 352 7475');
            expect(formatAccountNumber('300 123 4567')).toBe('300 123 4567');
        });

        it('returns original string if cleaned length is not 10 digits', () => {
            expect(formatAccountNumber('123456789')).toBe('123456789');
            expect(formatAccountNumber('12345678901')).toBe('12345678901');
        });
    });

    describe('executeWithRetry', () => {
        it('resolves on first attempt if successful', async () => {
            const fn = vi.fn().mockResolvedValue('success');
            const result = await executeWithRetry(fn, 3, 10);
            expect(result).toBe('success');
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it('retries on HTTP 429 rate limits and succeeds', async () => {
            const fn = vi.fn()
                .mockRejectedValueOnce({ status: 429 })
                .mockResolvedValueOnce('recovered');

            const result = await executeWithRetry(fn, 3, 10);
            expect(result).toBe('recovered');
            expect(fn).toHaveBeenCalledTimes(2);
        });

        it('retries on HTTP 500+ server errors and succeeds', async () => {
            const fn = vi.fn()
                .mockRejectedValueOnce({ response: { status: 503 } })
                .mockResolvedValueOnce('recovered');

            const result = await executeWithRetry(fn, 3, 10);
            expect(result).toBe('recovered');
            expect(fn).toHaveBeenCalledTimes(2);
        });

        it('fails immediately without retry on client error (e.g. 400)', async () => {
            const fn = vi.fn().mockRejectedValue({ status: 400, message: 'Bad Request' });

            await expect(executeWithRetry(fn, 3, 10)).rejects.toMatchObject({ status: 400 });
            expect(fn).toHaveBeenCalledTimes(1);
        });

        it('throws after exhausting maximum retry attempts', async () => {
            const fn = vi.fn().mockRejectedValue({ status: 500, message: 'Server Error' });

            await expect(executeWithRetry(fn, 3, 10)).rejects.toMatchObject({ status: 500 });
            expect(fn).toHaveBeenCalledTimes(3);
        });
    });

    describe('normalizeText', () => {
        it('converts text to uppercase and strips diacritics / accents', () => {
            expect(normalizeText('Bogotá')).toBe('BOGOTA');
            expect(normalizeText('Medellín')).toBe('MEDELLIN');
            expect(normalizeText('Quindío')).toBe('QUINDIO');
            expect(normalizeText('  pereira  ')).toBe('PEREIRA');
        });
    });

    describe('normalizeOcrText', () => {
        it('cleans control chars, line breaks, curly quotes, and bullet symbols', () => {
            const raw = '• Comprobante N° 123\r\nValor: $100.000\n\n\n\n“Nequi” – Pago recibido';
            const normalized = normalizeOcrText(raw);

            expect(normalized).toContain('- Comprobante N° 123');
            expect(normalized).toContain('"Nequi" - Pago recibido');
            expect(normalized).not.toContain('\r');
            expect(normalized).not.toContain('\n\n\n');
        });

        it('handles empty input gracefully', () => {
            expect(normalizeOcrText('')).toBe('');
        });
    });

    describe('classifyIncomeType', () => {
        it('classifies as Ingreso when destination account matches CUENTAS_INGRESO', () => {
            expect(classifyIncomeType('314 352 7475', 'Transferencia exitosa')).toBe('Ingreso');
            expect(classifyIncomeType('322 444 2154', 'Transferencia exitosa')).toBe('Ingreso');
            expect(classifyIncomeType('321 711 5717', 'Transferencia exitosa')).toBe('Ingreso');
            expect(classifyIncomeType('20675640140', 'Transferencia exitosa')).toBe('Ingreso');
            expect(classifyIncomeType('91210979391', 'Transferencia exitosa')).toBe('Ingreso');
            expect(classifyIncomeType('51103777724', 'Transferencia exitosa')).toBe('Ingreso');
            expect(classifyIncomeType('310 830 3127', 'Transferencia exitosa')).toBe('Ingreso');
        });

        it('classifies as Abono when destination account matches CUENTAS_ABONO', () => {
            expect(classifyIncomeType('310 613 1751', 'Transferencia exitosa')).toBe('Abono');
            expect(classifyIncomeType('301 381 8248', 'Transferencia exitosa')).toBe('Abono');
            expect(classifyIncomeType('317 538 5982', 'Transferencia exitosa')).toBe('Abono');
            expect(classifyIncomeType('037-590539-96', 'Transferencia exitosa')).toBe('Abono');
        });

        it('classifies as Abono if receipt text mentions a known advance account holder', () => {
            expect(classifyIncomeType('0000000000', 'Transferencia enviada a Yenci Perez')).toBe('Abono');
            expect(classifyIncomeType('0000000000', 'Abono realizado a Ramirez')).toBe('Abono');
        });

        it('defaults to Ingreso when no special criteria match', () => {
            expect(classifyIncomeType('9999999999', 'Transferencia recibida')).toBe('Ingreso');
        });
    });

    describe('resolvePaymentMethod', () => {
        it('resolves to Nequi bodega when destination account is in BODEGA_ACCOUNTS', () => {
            expect(resolvePaymentMethod('Nequi', '310 613 1751')).toBe('Nequi bodega');
            expect(resolvePaymentMethod('Bancolombia', '301 381 8248')).toBe('Nequi bodega');
            expect(resolvePaymentMethod('No identificado', '317 538 5982')).toBe('Nequi bodega');
        });

        it('resolves visual bank color when available and not a bodega account', () => {
            expect(resolvePaymentMethod('No identificado', '322 444 2154', 'Bancolombia')).toBe('Bancolombia');
            expect(resolvePaymentMethod('Nequi', '322 444 2154', 'Davivienda')).toBe('Davivienda');
        });

        it('normalizes Colombian bank entities accurately', () => {
            expect(resolvePaymentMethod('Nu', '322 444 2154')).toBe('NU');
            expect(resolvePaymentMethod('NuBank', '322 444 2154')).toBe('NU');
            expect(resolvePaymentMethod('Nu C.F.', '322 444 2154')).toBe('NU');
            expect(resolvePaymentMethod('bbva', '322 444 2154')).toBe('BBVA');
            expect(resolvePaymentMethod('bancolombia', '322 444 2154')).toBe('Bancolombia');
            expect(resolvePaymentMethod('daviplata', '322 444 2154')).toBe('Daviplata');
            expect(resolvePaymentMethod('davivienda', '322 444 2154')).toBe('Davivienda');
            expect(resolvePaymentMethod('nequi', '322 444 2154')).toBe('Nequi');
            expect(resolvePaymentMethod('wenstern union', '322 444 2154')).toBe('Western Union');
            expect(resolvePaymentMethod('efectivo', '322 444 2154')).toBe('Efectivo');
        });

        it('handles unknown or empty inputs gracefully', () => {
            expect(resolvePaymentMethod('', '9999999999')).toBe('No identificado');
            expect(resolvePaymentMethod('N/A', '9999999999')).toBe('No identificado');
            expect(resolvePaymentMethod(undefined, '9999999999')).toBe('No identificado');
        });
    });

    describe('extractVendor', () => {
        it('extracts vendor name following "venta" keyword', () => {
            expect(extractVendor('venta Karol reloj casio')).toBe('Karol');
            expect(extractVendor('vendido por Evelin')).toBe('Evelin');
            expect(extractVendor('venta: Alejandra')).toBe('Alejandra');
        });

        it('ignores stop words and defaults to JHON', () => {
            expect(extractVendor('venta en Bogota')).toBe('JHON');
            expect(extractVendor('pago por transferencia')).toBe('JHON');
            expect(extractVendor('')).toBe('JHON');
        });
    });

    describe('isUsefulText', () => {
        it('returns false for empty or sentinel tokens', () => {
            expect(isUsefulText('')).toBe(false);
            expect(isUsefulText('SIN_TEXTO_DETECTADO')).toBe(false);
            expect(isUsefulText('abc')).toBe(false);
        });

        it('returns false for OCR noise dominated by 1-2 character fragments', () => {
            expect(isUsefulText('. a x 1 . . b c d e f')).toBe(false);
        });

        it('returns true for legitimate conversational or product text', () => {
            expect(isUsefulText('Karol vende 2 relojes casio retro dorado')).toBe(true);
            expect(isUsefulText('Yenci Perez 3106131751 Armenia')).toBe(true);
        });
    });

    describe('detectBankByColor', () => {
        it('detects Bancolombia when yellow and black are prominent', async () => {
            // Create a 100x100 image: 50% yellow (R:255, G:200, B:0), 50% black (R:10, G:10, B:10)
            const yellowBuffer = Buffer.alloc(100 * 50 * 3);
            for (let i = 0; i < yellowBuffer.length; i += 3) {
                yellowBuffer[i] = 255;
                yellowBuffer[i + 1] = 200;
                yellowBuffer[i + 2] = 0;
            }
            const blackBuffer = Buffer.alloc(100 * 50 * 3);
            for (let i = 0; i < blackBuffer.length; i += 3) {
                blackBuffer[i] = 10;
                blackBuffer[i + 1] = 10;
                blackBuffer[i + 2] = 10;
            }

            const img = await sharp(Buffer.concat([yellowBuffer, blackBuffer]), {
                raw: { width: 100, height: 100, channels: 3 }
            }).png().toBuffer();

            const result = await detectBankByColor(img.toString('base64'));
            expect(result).toBe('Bancolombia');
        });

        it('detects Nequi when magenta/purple is prominent', async () => {
            // Nequi pink: R:200, G:30, B:180
            const pinkBuffer = Buffer.alloc(100 * 100 * 3);
            for (let i = 0; i < pinkBuffer.length; i += 3) {
                pinkBuffer[i] = 200;
                pinkBuffer[i + 1] = 30;
                pinkBuffer[i + 2] = 180;
            }

            const img = await sharp(pinkBuffer, {
                raw: { width: 100, height: 100, channels: 3 }
            }).png().toBuffer();

            const result = await detectBankByColor(img.toString('base64'));
            expect(result).toBe('Nequi');
        });

        it('returns undefined for unrecognized neutral images', async () => {
            const blueBuffer = Buffer.alloc(100 * 100 * 3);
            for (let i = 0; i < blueBuffer.length; i += 3) {
                blueBuffer[i] = 0;
                blueBuffer[i + 1] = 0;
                blueBuffer[i + 2] = 255;
            }

            const img = await sharp(blueBuffer, {
                raw: { width: 100, height: 100, channels: 3 }
            }).png().toBuffer();

            const result = await detectBankByColor(img.toString('base64'));
            expect(result).toBeUndefined();
        });
    });
});
