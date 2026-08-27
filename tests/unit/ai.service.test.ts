import { describe, it, expect, beforeEach, vi } from 'vitest';
import sharp from 'sharp';
import {
    optimizeImageForOcr,
    extractAccountingDataFromOcr,
    extractCustomerDataFromText,
    _setOpenAiClientForTesting,
} from '../../src/services/ai.service';

describe('ai.service.ts (AI & Vision Processing)', () => {
    let mockOpenAi: any;

    beforeEach(() => {
        mockOpenAi = {
            chat: {
                completions: {
                    create: vi.fn(),
                },
            },
        };
        _setOpenAiClientForTesting(mockOpenAi);
    });

    describe('optimizeImageForOcr', () => {
        it('compresses and normalizes base64 images to grayscale JPEG under 1200px', async () => {
            // Generate a 500x500 test PNG
            const testBuffer = await sharp({
                create: {
                    width: 500,
                    height: 500,
                    channels: 3,
                    background: { r: 255, g: 0, b: 0 }
                }
            }).png().toBuffer();

            const base64Input = testBuffer.toString('base64');
            const optimizedBase64 = await optimizeImageForOcr(base64Input);

            expect(optimizedBase64).toBeDefined();
            expect(typeof optimizedBase64).toBe('string');

            const optimizedMeta = await sharp(Buffer.from(optimizedBase64, 'base64')).metadata();
            expect(optimizedMeta.format).toBe('jpeg');
            expect(optimizedMeta.width).toBeLessThanOrEqual(1200);
        });

        it('returns original string on invalid image buffers without throwing', async () => {
            const invalidBase64 = 'invalid_not_an_image';
            const result = await optimizeImageForOcr(invalidBase64);
            expect(result).toBe(invalidBase64);
        });
    });

    describe('extractAccountingDataFromOcr', () => {
        it('returns structured accounting data when receipt is valid', async () => {
            mockOpenAi.chat.completions.create.mockResolvedValue({
                choices: [
                    {
                        message: {
                            content: JSON.stringify({
                                esComprobanteValido: true,
                                fecha: '05/08/2026',
                                descripcion: 'Pedido al por menor',
                                precioCompra: '165000',
                                medioDePago: 'Nequi',
                                referenciaDePago: 'M883912',
                                cuentaDestino: '3143527475',
                            }),
                        },
                    },
                ],
                usage: { prompt_tokens: 150, completion_tokens: 40 },
            });

            const result = await extractAccountingDataFromOcr(
                'Nequi comprobante $165.000',
                'venta Karol reloj casio',
                'Nequi'
            );

            expect(result).toBeDefined();
            expect(result?.esComprobanteValido).toBe(true);
            expect(result?.fecha).toBe('05/08/2026');
            expect(result?.precioCompra).toBe('165000');
            expect(result?.tipo).toBe('Ingreso');
            expect(result?.vendedor).toBe('Karol');
            expect(result?.medioDePago).toBe('Nequi');
        });

        it('returns undefined when receipt is invalid or unreadable', async () => {
            mockOpenAi.chat.completions.create.mockResolvedValue({
                choices: [
                    {
                        message: {
                            content: JSON.stringify({
                                esComprobanteValido: false,
                            }),
                        },
                    },
                ],
                usage: { prompt_tokens: 100, completion_tokens: 10 },
            });

            const result = await extractAccountingDataFromOcr('Foto de una caja', '');
            expect(result).toBeUndefined();
        });
    });

    describe('extractCustomerDataFromText', () => {
        it('extracts customer shipping data and combines with parsed product counts', async () => {
            mockOpenAi.chat.completions.create.mockResolvedValue({
                choices: [
                    {
                        message: {
                            content: JSON.stringify({
                                nombreCliente: 'Yenci Perez',
                                email: 'N/A',
                                telefono: '3106131751',
                                municipio: 'Armenia',
                                vendedor: 'Karol',
                            }),
                        },
                    },
                ],
                usage: { prompt_tokens: 120, completion_tokens: 30 },
            });

            const result = await extractCustomerDataFromText(
                'Yenci Perez 3106131751 Armenia, CASIO dorado x2, 1 PERFUME'
            );

            expect(result).toBeDefined();
            expect(result?.nombreCliente).toBe('Yenci Perez');
            expect(result?.municipio).toBe('Armenia');
            expect(result?.telefono).toBe('3106131751');
            expect(result?.vendedor).toBe('Karol');
            expect(result?.cantidadRelojes).toBe(2);
            expect(result?.cantidadOtros).toBe(1);
        });
    });
});
