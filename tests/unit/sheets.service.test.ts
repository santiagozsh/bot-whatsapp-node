import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    appendIncomeRow,
    appendSalesRow,
    enrichSalesRow,
    updateIncomeRow,
    getLatestOrderNumberFromSheets,
    readIncomeRows,
    readSalesRows,
    _setSheetsClientForTesting,
    _resetSheetsClientForTesting,
} from '../../src/services/sheets.service';
import type { DatosIngreso, DatosCliente } from '../../src/types';

describe('sheets.service.ts (Google Sheets API Layer)', () => {
    let mockSheetsClient: any;

    beforeEach(() => {
        _resetSheetsClientForTesting();

        mockSheetsClient = {
            spreadsheets: {
                values: {
                    append: vi.fn(),
                    get: vi.fn(),
                    update: vi.fn(),
                    batchUpdate: vi.fn(),
                },
            },
        };

        _setSheetsClientForTesting(mockSheetsClient);
    });

    describe('appendIncomeRow', () => {
        it('formats fields and appends to Ingresos transacciones!A:I', async () => {
            mockSheetsClient.spreadsheets.values.append.mockResolvedValue({
                data: {
                    updates: {
                        updatedRange: 'Ingresos transacciones!A15:I15',
                    },
                },
            });

            const incomeData: DatosIngreso = {
                esComprobanteValido: true,
                fecha: '05/08/2026',
                tipo: 'Ingreso',
                descripcion: 'Pedido al por menor',
                precioCompra: '165000',
                medioDePago: 'Nequi',
                referenciaDePago: 'M123456',
                cuentaDestino: '3143527475',
                vendedor: 'Karol',
            };

            const result = await appendIncomeRow(incomeData);

            expect(result).not.toBeNull();
            expect(result?.filaIngreso).toBe(15);
            expect(mockSheetsClient.spreadsheets.values.append).toHaveBeenCalledTimes(1);

            const appendCall = mockSheetsClient.spreadsheets.values.append.mock.calls[0][0];
            expect(appendCall.range).toBe('Ingresos transacciones!A:I');
            const rowValues = appendCall.requestBody.values[0];
            expect(rowValues[1]).toBe('5-Ago-2026'); // Formatted date
            expect(rowValues[7]).toBe('314 352 7475'); // Formatted account
            expect(rowValues[8]).toBe('Karol');
        });
    });

    describe('appendSalesRow', () => {
        it('resolves department and appends 10-column record to Ventas!A:J', async () => {
            mockSheetsClient.spreadsheets.values.append.mockResolvedValue({
                data: {
                    updates: {
                        updatedRange: 'Ventas!A10:J10',
                    },
                },
            });

            const clientData: DatosCliente = {
                nombreCliente: 'Yenci Perez',
                email: 'N/A',
                telefono: '3106131751',
                municipio: 'Armenia',
                vendedor: 'KAROL',
                producto: 'CASIO retro x2',
                cantidadRelojes: 2,
                cantidadOtros: 0,
            };

            const rowIndex = await appendSalesRow(clientData, 'LG-010', '5-Ago-2026');

            expect(rowIndex).toBe(10);
            const callArgs = mockSheetsClient.spreadsheets.values.append.mock.calls[0][0];
            const row = callArgs.requestBody.values[0];

            expect(row[0]).toBe('LG-010');
            expect(row[1]).toBe('5-Ago-2026');
            expect(row[2]).toBe('Yenci Perez');
            expect(row[5]).toBe('Armenia');
            expect(row[6]).toBe('QUINDÍO'); // Department resolved from Armenia
            expect(row[7]).toBe('CASIO retro x2');
            expect(row[8]).toBe(2);
        });
    });

    describe('enrichSalesRow (Non-destructive merge)', () => {
        it('preserves existing cell values and only populates empty/NA cells', async () => {
            // Mock existing row in Ventas (has customer name and phone, but missing city & product)
            mockSheetsClient.spreadsheets.values.get.mockResolvedValue({
                data: {
                    values: [
                        ['LG-001', '1-Ene-2026', 'Carlos Ruiz', 'N/A', '3001234567', 'N/A', 'N/A', 'N/A', 0, 0],
                    ],
                },
            });

            mockSheetsClient.spreadsheets.values.update.mockResolvedValue({});

            const newData: DatosCliente = {
                nombreCliente: 'Carlos Ruiz',
                email: 'carlos@mail.com',
                telefono: '3001234567',
                municipio: 'Medellín',
                vendedor: 'JHON',
                producto: 'TISSOT PRX x1',
                cantidadRelojes: 1,
                cantidadOtros: 0,
            };

            await enrichSalesRow(5, newData);

            expect(mockSheetsClient.spreadsheets.values.update).toHaveBeenCalledTimes(1);
            const updateCall = mockSheetsClient.spreadsheets.values.update.mock.calls[0][0];
            const mergedRow = updateCall.requestBody.values[0];

            expect(mergedRow[0]).toBe('LG-001'); // Preserved
            expect(mergedRow[2]).toBe('Carlos Ruiz'); // Preserved
            expect(mergedRow[3]).toBe('carlos@mail.com'); // Enriched from N/A
            expect(mergedRow[5]).toBe('Medellín'); // Enriched from N/A
            expect(mergedRow[6]).toBe('ANTIOQUIA'); // Enriched department
            expect(mergedRow[7]).toBe('TISSOT PRX x1'); // Enriched product
            expect(mergedRow[8]).toBe(1); // Enriched quantity
        });
    });

    describe('updateIncomeRow', () => {
        it('batches cell updates for specified columns (tipo, descripcion, vendedor)', async () => {
            mockSheetsClient.spreadsheets.values.batchUpdate.mockResolvedValue({});

            await updateIncomeRow(8, { tipo: 'Abono', vendedor: 'Karol' });

            expect(mockSheetsClient.spreadsheets.values.batchUpdate).toHaveBeenCalledTimes(1);
            const batchCall = mockSheetsClient.spreadsheets.values.batchUpdate.mock.calls[0][0];
            const updates = batchCall.requestBody.data;

            expect(updates).toHaveLength(2);
            expect(updates[0]).toEqual({ range: 'Ingresos transacciones!C8', values: [['Abono']] });
            expect(updates[1]).toEqual({ range: 'Ingresos transacciones!I8', values: [['Karol']] });
        });
    });

    describe('getLatestOrderNumberFromSheets', () => {
        it('scans column A bottom-up and extracts the highest LG-XXX numeric ID', async () => {
            mockSheetsClient.spreadsheets.values.get.mockResolvedValue({
                data: {
                    values: [
                        ['N.Pedido'],
                        ['LG-001'],
                        ['LG-002'],
                        ['LG-045'],
                    ],
                },
            });

            const result = await getLatestOrderNumberFromSheets();
            expect(result).toBe(45);
        });

        it('returns null if no valid LG order numbers exist in column A', async () => {
            mockSheetsClient.spreadsheets.values.get.mockResolvedValue({
                data: { values: [['Header only'], ['Invalid']] },
            });

            const result = await getLatestOrderNumberFromSheets();
            expect(result).toBeNull();
        });
    });

    describe('readIncomeRows & readSalesRows', () => {
        it('reads and maps income rows, skipping row 1 header', async () => {
            mockSheetsClient.spreadsheets.values.get.mockResolvedValue({
                data: {
                    values: [
                        ['N.Pedido', 'Fecha', 'Tipo', 'Desc', 'Precio', 'Medio', 'Ref', 'Cuenta', 'Vendedor'],
                        ['LG-001', '1-Ene-2026', 'Ingreso', 'Pedido al por menor', '165000', 'Nequi', 'M1', '314 352 7475', 'Karol'],
                    ],
                },
            });

            const rows = await readIncomeRows();
            expect(rows).toHaveLength(1);
            expect(rows[0]?.fila).toBe(2);
            expect(rows[0]?.nPedido).toBe('LG-001');
            expect(rows[0]?.vendedor).toBe('Karol');
        });

        it('reads and maps sales rows, parsing watch and accessory quantities', async () => {
            mockSheetsClient.spreadsheets.values.get.mockResolvedValue({
                data: {
                    values: [
                        ['N.Pedido', 'Fecha', 'Cliente', 'Email', 'Tel', 'Mun', 'Depto', 'Prod', 'Relojes', 'Otros'],
                        ['LG-001', '1-Ene-2026', 'Yenci', 'N/A', '3106131751', 'Armenia', 'QUINDÍO', 'CASIO x2', '2', '0'],
                    ],
                },
            });

            const rows = await readSalesRows();
            expect(rows).toHaveLength(1);
            expect(rows[0]?.fila).toBe(2);
            expect(rows[0]?.cantidadRelojes).toBe(2);
            expect(rows[0]?.cantidadOtros).toBe(0);
        });
    });
});
