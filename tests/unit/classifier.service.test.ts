import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    classifyDailyOrders,
    getFormattedTodayDate,
    parseNumericPrice,
    determineOrderClassification,
} from '../../src/services/classifier.service';
import * as sheetsService from '../../src/services/sheets.service';
import type { IncomeRow, SalesRow } from '../../src/services/sheets.service';

describe('classifier.service.ts (Nightly Order Classifier)', () => {
    describe('parseNumericPrice', () => {
        it('cleans non-numeric currency symbols and parses integer', () => {
            expect(parseNumericPrice('$165.000')).toBe(165000);
            expect(parseNumericPrice('250,000 COP')).toBe(250000);
            expect(parseNumericPrice('0')).toBe(0);
            expect(parseNumericPrice('')).toBe(0);
        });
    });

    describe('getFormattedTodayDate', () => {
        it('formats a date into D-Mes-YYYY matching Google Sheets date schema', () => {
            const testDate = new Date(2026, 7, 5); // 5 Aug 2026 (month is 0-indexed: 7 = Aug)
            expect(getFormattedTodayDate(testDate)).toBe('5-Ago-2026');
        });
    });

    describe('determineOrderClassification', () => {
        it('classifies as wholesale when sales record has >= 3 total units', () => {
            const income: IncomeRow = {
                fila: 2,
                nPedido: 'LG-001',
                fecha: '5-Ago-2026',
                tipo: 'Ingreso',
                descripcion: 'Pedido al por menor',
                precioCompra: '120000',
                medioDePago: 'Nequi',
                referenciaDePago: 'REF1',
                cuentaDestino: '3143527475',
                vendedor: 'Karol',
            };

            const sales: SalesRow = {
                fila: 2,
                nPedido: 'LG-001',
                cantidadRelojes: 2,
                cantidadOtros: 1, // 2 + 1 = 3 units
            };

            expect(determineOrderClassification(income, sales)).toBe('Pedido mayorista');
        });

        it('classifies as retail when sales record has < 3 total units', () => {
            const income: IncomeRow = {
                fila: 3,
                nPedido: 'LG-002',
                fecha: '5-Ago-2026',
                tipo: 'Ingreso',
                descripcion: 'Pedido al por menor',
                precioCompra: '165000',
                medioDePago: 'Nequi',
                referenciaDePago: 'REF2',
                cuentaDestino: '3143527475',
                vendedor: 'Karol',
            };

            const sales: SalesRow = {
                fila: 3,
                nPedido: 'LG-002',
                cantidadRelojes: 1,
                cantidadOtros: 1, // 2 units
            };

            expect(determineOrderClassification(income, sales)).toBe('Pedido al por menor');
        });

        it('falls back to price threshold when no sales record is found (>= 250000)', () => {
            const incomeWholesale: IncomeRow = {
                fila: 4,
                nPedido: 'LG-003',
                fecha: '5-Ago-2026',
                tipo: 'Ingreso',
                descripcion: 'Pedido al por menor',
                precioCompra: '320000',
                medioDePago: 'Bancolombia',
                referenciaDePago: 'REF3',
                cuentaDestino: '3143527475',
                vendedor: 'JHON',
            };

            const incomeRetail: IncomeRow = {
                ...incomeWholesale,
                precioCompra: '150000',
            };

            expect(determineOrderClassification(incomeWholesale)).toBe('Pedido mayorista');
            expect(determineOrderClassification(incomeRetail)).toBe('Pedido al por menor');
        });
    });

    describe('classifyDailyOrders (End-to-End Workflow)', () => {
        beforeEach(() => {
            vi.restoreAllMocks();
        });

        it('updates only today orders whose description has changed', async () => {
            const todayStr = getFormattedTodayDate();

            const mockIncomes: IncomeRow[] = [
                {
                    fila: 2,
                    nPedido: 'LG-001',
                    fecha: todayStr,
                    tipo: 'Ingreso',
                    descripcion: 'Pedido al por menor', // Needs update -> Wholesale (3 watches)
                    precioCompra: '180000',
                    medioDePago: 'Nequi',
                    referenciaDePago: 'R1',
                    cuentaDestino: '3143527475',
                    vendedor: 'Karol',
                },
                {
                    fila: 3,
                    nPedido: 'LG-002',
                    fecha: todayStr,
                    tipo: 'Ingreso',
                    descripcion: 'Pedido al por menor', // Already correct (1 watch) -> No-op
                    precioCompra: '90000',
                    medioDePago: 'Nequi',
                    referenciaDePago: 'R2',
                    cuentaDestino: '3143527475',
                    vendedor: 'Karol',
                },
                {
                    fila: 4,
                    nPedido: 'LG-003',
                    fecha: '1-Ene-2026', // Different date -> Ignored
                    tipo: 'Ingreso',
                    descripcion: 'Pedido al por menor',
                    precioCompra: '500000',
                    medioDePago: 'Nequi',
                    referenciaDePago: 'R3',
                    cuentaDestino: '3143527475',
                    vendedor: 'Karol',
                },
            ];

            const mockSales: SalesRow[] = [
                { fila: 2, nPedido: 'LG-001', cantidadRelojes: 3, cantidadOtros: 0 },
                { fila: 3, nPedido: 'LG-002', cantidadRelojes: 1, cantidadOtros: 0 },
            ];

            vi.spyOn(sheetsService, 'readIncomeRows').mockResolvedValue(mockIncomes);
            vi.spyOn(sheetsService, 'readSalesRows').mockResolvedValue(mockSales);
            const updateSpy = vi.spyOn(sheetsService, 'updateIncomeRow').mockResolvedValue();

            await classifyDailyOrders();

            // Only LG-001 (row 2) needed an update
            expect(updateSpy).toHaveBeenCalledTimes(1);
            expect(updateSpy).toHaveBeenCalledWith(2, { descripcion: 'Pedido mayorista' });
        });
    });
});
