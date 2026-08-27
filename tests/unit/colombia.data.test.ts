import { describe, it, expect } from 'vitest';
import { getDepartment } from '../../src/utils/colombia.data';

describe('colombia.data.ts — getDepartment', () => {
    it('returns N/A for empty, whitespace, or undefined input', () => {
        expect(getDepartment('')).toBe('N/A');
        expect(getDepartment('   ')).toBe('N/A');
    });

    it('resolves major Colombian capitals regardless of casing or accents', () => {
        expect(getDepartment('Bogotá')).toBe('CUNDINAMARCA');
        expect(getDepartment('bogota')).toBe('CUNDINAMARCA');
        expect(getDepartment('BOGOTA D.C.')).toBe('CUNDINAMARCA');
        expect(getDepartment('Medellín')).toBe('ANTIOQUIA');
        expect(getDepartment('medellin')).toBe('ANTIOQUIA');
        expect(getDepartment('Cali')).toBe('VALLE DEL CAUCA');
        expect(getDepartment('Barranquilla')).toBe('ATLÁNTICO');
        expect(getDepartment('Armenia')).toBe('QUINDÍO');
        expect(getDepartment('Cartagena')).toBe('BOLÍVAR');
        expect(getDepartment('Pereira')).toBe('RISARALDA');
    });

    it('resolves intermediate municipalities correctly', () => {
        expect(getDepartment('Soacha')).toBe('CUNDINAMARCA');
        expect(getDepartment('Bello')).toBe('ANTIOQUIA');
        expect(getDepartment('Palmira')).toBe('VALLE DEL CAUCA');
        expect(getDepartment('Floridablanca')).toBe('SANTANDER');
        expect(getDepartment('Dosquebradas')).toBe('RISARALDA');
    });

    it('returns N/A for unknown or foreign cities', () => {
        expect(getDepartment('Miami')).toBe('N/A');
        expect(getDepartment('XYZ_NON_EXISTENT')).toBe('N/A');
    });
});
