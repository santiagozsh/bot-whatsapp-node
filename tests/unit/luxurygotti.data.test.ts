import { describe, it, expect } from 'vitest';
import { parseProductList } from '../../src/utils/luxurygotti.data';

describe('luxurygotti.data.ts — parseProductList', () => {
    it('returns empty counters and list for empty input', () => {
        expect(parseProductList('')).toEqual({
            lineasProducto: [],
            cantidadRelojes: 0,
            cantidadOtros: 0,
        });
    });

    describe('Watch detection (MARCAS_RELOJ & KEYWORDS_RELOJ)', () => {
        it('detects standalone watch brands', () => {
            const result = parseProductList('1 CASIO dorado');
            expect(result.cantidadRelojes).toBe(1);
            expect(result.cantidadOtros).toBe(0);
            expect(result.lineasProducto).toEqual(['1 CASIO dorado']);
        });

        it('detects multi-word watch brands (G-FORCE, RICHARD MILLE, SPORT G)', () => {
            const result = parseProductList('RICHARD MILLE negro\nG-FORCE digital');
            expect(result.cantidadRelojes).toBe(2);
            expect(result.cantidadOtros).toBe(0);
            expect(result.lineasProducto).toHaveLength(2);
        });

        it('detects generic watch keywords like RELOJ or CRONOGRAFO', () => {
            const result = parseProductList('1 Reloj cronografo plateado');
            expect(result.cantidadRelojes).toBe(1);
            expect(result.cantidadOtros).toBe(0);
        });
    });

    describe('Accessories and other products detection (KEYWORDS_OTROS)', () => {
        it('classifies glasses, perfumes, boxes, straps, and bracelets as Otros', () => {
            const input = '2 GAFAS negras\n1 PERFUME 100ml\n3 PULSERAS de cuero\n1 ESTUCHE de lujo';
            const result = parseProductList(input);

            expect(result.cantidadRelojes).toBe(0);
            expect(result.cantidadOtros).toBe(7); // 2 + 1 + 3 + 1
            expect(result.lineasProducto).toHaveLength(4);
        });
    });

    describe('Quantity multipliers (leading and trailing)', () => {
        it('parses trailing multipliers (e.g., CASIO x2, ROLEX × 3)', () => {
            const result = parseProductList('CASIO vintage x2\nROLEX submarino × 3');
            expect(result.cantidadRelojes).toBe(5);
            expect(result.cantidadOtros).toBe(0);
        });

        it('parses leading multipliers (e.g., 2x TISSOT, 4 × GAFAS)', () => {
            const result = parseProductList('2x TISSOT clasico\n4 × GAFAS oscuras');
            expect(result.cantidadRelojes).toBe(2);
            expect(result.cantidadOtros).toBe(4);
        });

        it('distinguishes prices from quantities (e.g. 150000 should not be 150000 units)', () => {
            const result = parseProductList('150000 CASIO dorado');
            expect(result.cantidadRelojes).toBe(1);
        });

        it('enforces safety cap on unrealistic quantities (CANTIDAD_MAXIMA = 50)', () => {
            const result = parseProductList('CASIO x 999');
            expect(result.cantidadRelojes).toBe(1);
        });
    });

    describe('Combo packages detection', () => {
        it('parses bundle packages and extracts embedded watch counts if present', () => {
            const result = parseProductList('1 COMBO EMPRENDEDOR 3 RELOJES');
            expect(result.cantidadRelojes).toBe(3);
        });

        it('defaults combo to 1 watch if no explicit watch count is declared', () => {
            const result = parseProductList('KIT DESPEGUE');
            expect(result.cantidadRelojes).toBe(1);
        });
    });

    describe('Mixed comma and newline separated items', () => {
        it('parses items separated by commas and newlines correctly', () => {
            const input = 'CASIO x2, 1 PERFUME, 3 PULSERAS\nINVICTA dorado x1';
            const result = parseProductList(input);

            expect(result.cantidadRelojes).toBe(3); // 2 (CASIO) + 1 (INVICTA)
            expect(result.cantidadOtros).toBe(4);   // 1 (PERFUME) + 3 (PULSERAS)
            expect(result.lineasProducto).toHaveLength(4);
        });

        it('ignores pure numeric strings without product words', () => {
            const input = '165000\nCASIO x1\n$420.000';
            const result = parseProductList(input);

            expect(result.cantidadRelojes).toBe(1);
            expect(result.lineasProducto).toEqual(['CASIO x1']);
        });
    });
});
