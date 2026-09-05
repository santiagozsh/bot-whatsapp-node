import { describe, it, expect } from 'vitest';
import { normalizeVendor, extractVendor } from '../../src/utils/helpers';
import { KNOWN_VENDORS, DEFAULT_VENDOR } from '../../src/utils/config.data';

describe('Vendor Normalization (Issue #13)', () => {
    describe('Canonical Vendors Configuration', () => {
        it('defines exactly the 4 authorized canonical vendors in uppercase', () => {
            expect(KNOWN_VENDORS).toEqual(['JHON', 'EVELIN', 'KAROL', 'DAVID']);
            expect(DEFAULT_VENDOR).toBe('JHON');
        });
    });

    describe('normalizeVendor', () => {
        it('normalizes exact canonical vendors regardless of initial casing', () => {
            expect(normalizeVendor('jhon')).toBe('JHON');
            expect(normalizeVendor('JHON')).toBe('JHON');
            expect(normalizeVendor('Jhon')).toBe('JHON');

            expect(normalizeVendor('evelin')).toBe('EVELIN');
            expect(normalizeVendor('EVELIN')).toBe('EVELIN');
            expect(normalizeVendor('Evelin')).toBe('EVELIN');

            expect(normalizeVendor('karol')).toBe('KAROL');
            expect(normalizeVendor('KAROL')).toBe('KAROL');
            expect(normalizeVendor('Karol')).toBe('KAROL');

            expect(normalizeVendor('david')).toBe('DAVID');
            expect(normalizeVendor('DAVID')).toBe('DAVID');
            expect(normalizeVendor('David')).toBe('DAVID');
        });

        it('maps EVELIN diminutives, variations, and praises to EVELIN', () => {
            expect(normalizeVendor('eve')).toBe('EVELIN');
            expect(normalizeVendor('evelyn')).toBe('EVELIN');
            expect(normalizeVendor('evy')).toBe('EVELIN');
            expect(normalizeVendor('evi')).toBe('EVELIN');
            expect(normalizeVendor('evelina')).toBe('EVELIN');
            expect(normalizeVendor('evelincita')).toBe('EVELIN');
            expect(normalizeVendor('evelinsita')).toBe('EVELIN');
            expect(normalizeVendor('evelin la mejor')).toBe('EVELIN');
            expect(normalizeVendor('eve la mejor')).toBe('EVELIN');
        });

        it('maps JHON diminutives and variations to JHON', () => {
            expect(normalizeVendor('jhoncito')).toBe('JHON');
            expect(normalizeVendor('jhonsito')).toBe('JHON');
            expect(normalizeVendor('jon')).toBe('JHON');
            expect(normalizeVendor('john')).toBe('JHON');
            expect(normalizeVendor('joncito')).toBe('JHON');
            expect(normalizeVendor('jhonny')).toBe('JHON');
            expect(normalizeVendor('jhony')).toBe('JHON');
        });

        it('maps KAROL diminutives and variations to KAROL', () => {
            expect(normalizeVendor('karolsita')).toBe('KAROL');
            expect(normalizeVendor('karolcita')).toBe('KAROL');
            expect(normalizeVendor('carol')).toBe('KAROL');
            expect(normalizeVendor('carito')).toBe('KAROL');
            expect(normalizeVendor('carolcita')).toBe('KAROL');
            expect(normalizeVendor('carolsita')).toBe('KAROL');
        });

        it('maps DAVID diminutives and variations to DAVID', () => {
            expect(normalizeVendor('davidcito')).toBe('DAVID');
            expect(normalizeVendor('davidsito')).toBe('DAVID');
            expect(normalizeVendor('davo')).toBe('DAVID');
            expect(normalizeVendor('deivid')).toBe('DAVID');
        });

        it('cleans operational prefixes like "venta-", "asesor", "vendido por"', () => {
            expect(normalizeVendor('VENTA-KAROL')).toBe('KAROL');
            expect(normalizeVendor('venta evelin')).toBe('EVELIN');
            expect(normalizeVendor('asesor david')).toBe('DAVID');
            expect(normalizeVendor('vendido por jhon')).toBe('JHON');
            expect(normalizeVendor('venta: eve')).toBe('EVELIN');
            expect(normalizeVendor('asesora: karolcita')).toBe('KAROL');
        });

        it('preserves unrecognized vendor names in uppercase', () => {
            expect(normalizeVendor('carlos')).toBe('CARLOS');
            expect(normalizeVendor('Pedro')).toBe('PEDRO');
            expect(normalizeVendor('alejandra')).toBe('ALEJANDRA');
            expect(normalizeVendor('andres felipe')).toBe('ANDRES FELIPE');
            expect(normalizeVendor('Juan David')).toBe('JUAN DAVID');
        });

        it('falls back to default vendor JHON on empty or invalid inputs', () => {
            expect(normalizeVendor('')).toBe('JHON');
            expect(normalizeVendor('   ')).toBe('JHON');
            expect(normalizeVendor('N/A')).toBe('JHON');
            expect(normalizeVendor('no identificado')).toBe('JHON');
            expect(normalizeVendor('no detectado')).toBe('JHON');
        });
    });

    describe('extractVendor (Integration)', () => {
        it('extracts and normalizes vendor from chat context strings', () => {
            expect(extractVendor('venta Karol reloj casio')).toBe('KAROL');
            expect(extractVendor('vendido por Eve')).toBe('EVELIN');
            expect(extractVendor('asesor jhoncito')).toBe('JHON');
            expect(extractVendor('venta-davidcito')).toBe('DAVID');
            expect(extractVendor('VENTA-KAROL')).toBe('KAROL');
            expect(extractVendor('EVELIN LA MEJOR')).toBe('EVELIN');
        });

        it('extracts and preserves unknown vendor in uppercase', () => {
            expect(extractVendor('venta Carlos reloj casio')).toBe('CARLOS');
        });

        it('defaults to JHON when no vendor is found or context is noisy', () => {
            expect(extractVendor('pago por transferencia')).toBe('JHON');
            expect(extractVendor('venta en Bogota')).toBe('JHON');
            expect(extractVendor('')).toBe('JHON');
        });
    });
});
