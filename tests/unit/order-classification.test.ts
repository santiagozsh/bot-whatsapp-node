import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    classifyDailyOrders,
    determineOrderClassification,
    getFormattedTodayDate,
} from '../../src/services/classifier.service';
import { classifyOrderDescription } from '../../src/utils/helpers';
import * as sheetsService from '../../src/services/sheets.service';
import type { IncomeRow, SalesRow } from '../../src/services/sheets.service';

describe('Order Classification & Description Logic (Issue #12)', () => {
    describe('classifyOrderDescription helper', () => {
        it('returns "Pedido mayorista" when price strictly exceeds 250000 COP', () => {
            expect(classifyOrderDescription(250001)).toBe('Pedido mayorista');
            expect(classifyOrderDescription('300000')).toBe('Pedido mayorista');
            expect(classifyOrderDescription('$500.000')).toBe('Pedido mayorista');
        });

        it('returns "Pedido al por menor" when price is exactly 250000 COP with < 3 units', () => {
            expect(classifyOrderDescription(250000, 1)).toBe('Pedido al por menor');
            expect(classifyOrderDescription('250000', 2)).toBe('Pedido al por menor');
            expect(classifyOrderDescription('$250.000', 0)).toBe('Pedido al por menor');
        });

        it('returns "Pedido al por menor" when price is below 250000 COP and units < 3', () => {
            expect(classifyOrderDescription(120000, 1)).toBe('Pedido al por menor');
            expect(classifyOrderDescription('180000', 2)).toBe('Pedido al por menor');
            expect(classifyOrderDescription(0, 0)).toBe('Pedido al por menor');
        });

        it('returns "Pedido mayorista" when total units >= 3, even if price <= 250000 COP', () => {
            expect(classifyOrderDescription(150000, 3)).toBe('Pedido mayorista');
            expect(classifyOrderDescription(80000, 5)).toBe('Pedido mayorista');
            expect(classifyOrderDescription(250000, 3)).toBe('Pedido mayorista');
        });
    });

    describe('determineOrderClassification', () => {
        it('classifies as "Pedido mayorista" if total units >= 3 regardless of price', () => {
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
                vendedor: 'KAROL',
            };
            const sales: SalesRow = {
                fila: 2,
                nPedido: 'LG-001',
                cantidadRelojes: 2,
                cantidadOtros: 1, // 3 units
            };

            expect(determineOrderClassification(income, sales)).toBe('Pedido mayorista');
        });

        it('classifies as "Pedido mayorista" if price > 250000 COP even with only 1 unit', () => {
            const income: IncomeRow = {
                fila: 3,
                nPedido: 'LG-002',
                fecha: '5-Ago-2026',
                tipo: 'Ingreso',
                descripcion: 'Pedido al por menor',
                precioCompra: '320000',
                medioDePago: 'Bancolombia',
                referenciaDePago: 'REF2',
                cuentaDestino: '3143527475',
                vendedor: 'DAVID',
            };
            const sales: SalesRow = {
                fila: 3,
                nPedido: 'LG-002',
                cantidadRelojes: 1,
                cantidadOtros: 0, // 1 unit
            };

            expect(determineOrderClassification(income, sales)).toBe('Pedido mayorista');
        });

        it('classifies as "Pedido al por menor" for exactly 250000 COP with 2 units', () => {
            const income: IncomeRow = {
                fila: 4,
                nPedido: 'LG-003',
                fecha: '5-Ago-2026',
                tipo: 'Ingreso',
                descripcion: 'Pedido al por menor',
                precioCompra: '250000',
                medioDePago: 'Nequi',
                referenciaDePago: 'REF3',
                cuentaDestino: '3143527475',
                vendedor: 'JHON',
            };
            const sales: SalesRow = {
                fila: 4,
                nPedido: 'LG-003',
                cantidadRelojes: 2,
                cantidadOtros: 0,
            };

            expect(determineOrderClassification(income, sales)).toBe('Pedido al por menor');
        });

        it('preserves "PAGOS CONTRAENTREGA" in determineOrderClassification (inviolable)', () => {
            const incomeCod: IncomeRow = {
                fila: 5,
                nPedido: 'LG-004',
                fecha: '5-Ago-2026',
                tipo: 'Ingreso',
                descripcion: 'PAGOS CONTRAENTREGA',
                precioCompra: '500000', // high price
                medioDePago: 'Efectivo',
                referenciaDePago: 'N/A',
                cuentaDestino: 'N/A',
                vendedor: 'JHON',
            };
            const sales: SalesRow = {
                fila: 5,
                nPedido: 'LG-004',
                cantidadRelojes: 10, // 10 units
                cantidadOtros: 0,
            };

            expect(determineOrderClassification(incomeCod, sales)).toBe('PAGOS CONTRAENTREGA');
        });
    });

    describe('classifyDailyOrders (PAGOS CONTRAENTREGA Guard & Nightly Reconciliation)', () => {
        beforeEach(() => {
            vi.restoreAllMocks();
        });

        it('never overwrites rows with PAGOS CONTRAENTREGA even with wholesale criteria', async () => {
            const todayStr = getFormattedTodayDate();
            const mockIncomes: IncomeRow[] = [
                {
                    fila: 2,
                    nPedido: 'LG-010',
                    fecha: todayStr,
                    tipo: 'Ingreso',
                    descripcion: 'PAGOS CONTRAENTREGA',
                    precioCompra: '600000',
                    medioDePago: 'Efectivo',
                    referenciaDePago: 'N/A',
                    cuentaDestino: 'N/A',
                    vendedor: 'JHON',
                },
                {
                    fila: 3,
                    nPedido: 'LG-011',
                    fecha: todayStr,
                    tipo: 'Ingreso',
                    descripcion: 'Pedido al por menor', // Needs update -> Pedido mayorista
                    precioCompra: '300000',
                    medioDePago: 'Nequi',
                    referenciaDePago: 'REF11',
                    cuentaDestino: '3143527475',
                    vendedor: 'EVELIN',
                },
            ];

            const mockSales: SalesRow[] = [
                { fila: 2, nPedido: 'LG-010', cantidadRelojes: 4, cantidadOtros: 0 },
                { fila: 3, nPedido: 'LG-011', cantidadRelojes: 1, cantidadOtros: 0 },
            ];

            vi.spyOn(sheetsService, 'readIncomeRows').mockResolvedValue(mockIncomes);
            vi.spyOn(sheetsService, 'readSalesRows').mockResolvedValue(mockSales);
            const updateSpy = vi.spyOn(sheetsService, 'updateIncomeRow').mockResolvedValue();

            // Mock getFormattedTodayDate to match todayStr
            await classifyDailyOrders();

            // Should ONLY update LG-011 to 'Pedido mayorista', LG-010 is untouched!
            const updatedRows = updateSpy.mock.calls;
            const updatedRow2 = updatedRows.find(call => call[0] === 2);
            expect(updatedRow2).toBeUndefined(); // Fila 2 (PAGOS CONTRAENTREGA) must never be updated
        });
    });
});
