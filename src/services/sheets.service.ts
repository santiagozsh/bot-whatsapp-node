import { google } from 'googleapis';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { formatDate, formatAccountNumber, executeWithRetry } from '../utils/helpers';
import { generateNextOrderNumber, registerSequenceSyncCallback } from './memory.service';
import { getDepartment } from '../utils/colombia.data';
import { logger } from '../utils/logger';
import { recordSheetsOperation } from './metrics.service';
import type { DatosIngreso, DatosCliente, DatosIngresoParcial } from '../types';

dotenv.config();

const SPREADSHEET_ID = (() => {
    const id = process.env.GOOGLE_SHEETS_ID;
    if (!id && process.env.NODE_ENV !== 'test') {
        throw new Error('GOOGLE_SHEETS_ID is not defined in environment variables');
    }
    return id || 'TEST_SPREADSHEET_ID';
})();

let sheetsClientPromise: Promise<any> | null = null;

const initGoogleSheetsClient = async () => {
    const auth = new google.auth.GoogleAuth({
        keyFile: path.join(__dirname, '../../google-keys.json'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const client = await auth.getClient();
    return google.sheets({ version: 'v4', auth: client as any });
};

/**
 * Retrieves or initializes the singleton Google Sheets v4 API client.
 */
export const getSheetsClient = async () => {
    if (!sheetsClientPromise) {
        sheetsClientPromise = initGoogleSheetsClient();
        logger.info('SHEETS', 'Google Sheets client initialized (singleton)');
    }
    return sheetsClientPromise;
};

// Backward-compatible alias
export const obtenerSheets = getSheetsClient;

/**
 * Injects a mock Google Sheets client for isolated testing.
 */
export function _setSheetsClientForTesting(client: any): void {
    sheetsClientPromise = Promise.resolve(client);
}

/**
 * Resets the cached Google Sheets client singleton.
 */
export function _resetSheetsClientForTesting(): void {
    sheetsClientPromise = null;
}

const extractRowNumber = (updatedRange: string | undefined | null): number => {
    if (!updatedRange) return 0;
    const match = updatedRange.match(/!?[A-Z]+(\d+)/);
    return match?.[1] ? parseInt(match[1], 10) : 0;
};

/**
 * Appends a new financial transaction row to the `Ingresos transacciones` Google Sheet (Columns A–I).
 * 
 * Column Schema:
 * - A: N.Pedido (`LG-XXX`)
 * - B: Date (`D-Mes-YYYY`)
 * - C: Type (`Ingreso` / `Abono`)
 * - D: Description (`Pedido al por menor`)
 * - E: Price / Amount
 * - F: Payment Method (`Nequi`, `Bancolombia`, etc.)
 * - G: Payment Reference
 * - H: Destination Account (`XXX XXX XXXX`)
 * - I: Vendor (`Karol`, `JHON`, etc.)
 * 
 * @param incomeData - Extracted and sanitized income transaction data.
 * @returns Object containing the generated `nPedido` and 1-based `filaIngreso` row number, or null on failure.
 */
export const appendIncomeRow = async (
    incomeData: DatosIngreso
): Promise<{ nPedido: string; filaIngreso: number } | null> => {
    try {
        return await executeWithRetry(async () => {
            const sheets = await getSheetsClient();
            const newOrderId = await generateNextOrderNumber();

            const cleanDate = formatDate(incomeData.fecha);
            const cleanAccount = formatAccountNumber(incomeData.cuentaDestino);

            const rowData = [
                newOrderId,
                cleanDate,
                incomeData.tipo || "Ingreso",
                incomeData.descripcion || "Pedido al por menor",
                incomeData.precioCompra,
                incomeData.medioDePago,
                incomeData.referenciaDePago,
                cleanAccount,
                incomeData.vendedor || "JHON",
            ];

            const appendResponse = await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                range: 'Ingresos transacciones!A:I',
                valueInputOption: 'USER_ENTERED',
                insertDataOption: 'INSERT_ROWS',
                requestBody: { values: [rowData] },
            });

            const updatedRange: string | undefined | null = appendResponse.data.updates?.updatedRange;
            const incomeRowIndex = extractRowNumber(updatedRange);

            logger.info('SHEETS', `Income row created: ${newOrderId} (row ${incomeRowIndex})`);
            recordSheetsOperation('append_income', 'success');
            return { nPedido: newOrderId, filaIngreso: incomeRowIndex };
        });
    } catch (error) {
        logger.error('SHEETS', 'Error appending income row (exhausted retries):', error);
        recordSheetsOperation('append_income', 'error');
        return null;
    }
};

// Backward-compatible alias
export const escribirFilaEnExcel = appendIncomeRow;

/**
 * Appends a new sales record row to the `Ventas` Google Sheet (Columns A–J).
 * Resolves the Colombian department automatically from the municipality string.
 * 
 * Column Schema:
 * - A: N.Pedido (`LG-XXX`)
 * - B: Date
 * - C: Customer Name
 * - D: Email
 * - E: Phone
 * - F: Municipality
 * - G: Department
 * - H: Product Details
 * - I: Watch Quantity
 * - J: Other Accessories Quantity
 * 
 * @param customerData - Extracted customer, address, and product details.
 * @param orderNumber - The associated `LG-XXX` order identifier.
 * @param formattedDate - Transaction date string.
 * @returns 1-based row number in the `Ventas` sheet, or -1 on failure.
 */
export const appendSalesRow = async (
    customerData: DatosCliente,
    orderNumber: string,
    formattedDate: string
): Promise<number> => {
    try {
        return await executeWithRetry(async () => {
            const sheets = await getSheetsClient();
            const salesSheetName = process.env.SHEETS_VENTAS_NOMBRE || 'Ventas';

            const department = getDepartment(customerData.municipio || '');

            const rowData = [
                orderNumber,
                formattedDate,
                customerData.nombreCliente  || 'N/A',
                customerData.email          || 'N/A',
                customerData.telefono       || 'N/A',
                customerData.municipio      || 'N/A',
                department,
                customerData.producto       || 'N/A',
                customerData.cantidadRelojes ?? 0,
                customerData.cantidadOtros  ?? 0,
            ];

            const appendResponse = await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                range: `${salesSheetName}!A:J`,
                valueInputOption: 'USER_ENTERED',
                insertDataOption: 'INSERT_ROWS',
                requestBody: { values: [rowData] },
            });

            const updatedRange: string | undefined | null = appendResponse.data.updates?.updatedRange;
            const salesRowIndex = extractRowNumber(updatedRange);

            logger.info('SHEETS', `Sales row ${salesRowIndex} created for ${orderNumber}`);
            recordSheetsOperation('append_sales', 'success');
            return salesRowIndex;
        });
    } catch (error) {
        logger.error('SHEETS', 'Error appending sales row (exhausted retries):', error);
        recordSheetsOperation('append_sales', 'error');
        return -1;
    }
};

// Backward-compatible alias
export const escribirFilaVenta = appendSalesRow;

/**
 * Non-destructively enriches an existing sales row in the `Ventas` sheet.
 * Reads current row data and only fills blank or 'N/A' cells with new incoming information,
 * preventing accidental overwriting of confirmed data.
 * 
 * @param salesRowIndex - 1-based row index in the `Ventas` sheet.
 * @param incomingData - Fresh customer/product data extracted from a late WhatsApp message.
 */
export const enrichSalesRow = async (
    salesRowIndex: number,
    incomingData: DatosCliente
): Promise<void> => {
    try {
        await executeWithRetry(async () => {
            const sheets = await getSheetsClient();
            const salesSheetName = process.env.SHEETS_VENTAS_NOMBRE || 'Ventas';

            const currentRead = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${salesSheetName}!A${salesRowIndex}:J${salesRowIndex}`,
            });

            const currentRow: string[] = currentRead.data.values?.[0] || [];

            const isEmptyValue = (value: string | undefined): boolean => {
                if (value === undefined || value === null) return true;
                const clean = value.toString().trim().toUpperCase();
                return clean === '' || clean === 'N/A' || clean === '0';
            };

            const newDepartment = getDepartment(incomingData.municipio || '');

            const finalRow = [
                currentRow[0] || '',
                currentRow[1] || '',
                isEmptyValue(currentRow[2]) ? (incomingData.nombreCliente  || 'N/A') : currentRow[2],
                isEmptyValue(currentRow[3]) ? (incomingData.email          || 'N/A') : currentRow[3],
                isEmptyValue(currentRow[4]) ? (incomingData.telefono       || 'N/A') : currentRow[4],
                isEmptyValue(currentRow[5]) ? (incomingData.municipio      || 'N/A') : currentRow[5],
                isEmptyValue(currentRow[6]) ? newDepartment                         : currentRow[6],
                isEmptyValue(currentRow[7]) ? (incomingData.producto       || 'N/A') : currentRow[7],
                isEmptyValue(currentRow[8]) ? (incomingData.cantidadRelojes ?? 0)    : currentRow[8],
                isEmptyValue(currentRow[9]) ? (incomingData.cantidadOtros  ?? 0)    : currentRow[9],
            ];

            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${salesSheetName}!A${salesRowIndex}:J${salesRowIndex}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [finalRow] },
            });

            logger.info('SHEETS', `Sales row ${salesRowIndex} enriched successfully`);
            recordSheetsOperation('enrich_sales', 'success');
        });
    } catch (error) {
        logger.error('SHEETS', 'Error enriching sales row (exhausted retries):', error);
        recordSheetsOperation('enrich_sales', 'error');
    }
};

// Backward-compatible alias
export const mergeFilaVenta = enrichSalesRow;

/**
 * Updates specific columns (tipo, descripcion, vendedor) of an existing income row.
 * 
 * @param incomeRowIndex - 1-based row index in `Ingresos transacciones`.
 * @param fieldsToUpdate - Object containing partial field updates.
 */
export const updateIncomeRow = async (
    incomeRowIndex: number,
    fieldsToUpdate: DatosIngresoParcial
): Promise<void> => {
    try {
        await executeWithRetry(async () => {
            const sheets = await getSheetsClient();

            const columnMap: Record<string, string> = {
                tipo:        'C',
                descripcion: 'D',
                vendedor:    'I',
            };

            const updateData: { range: string; values: string[][] }[] = [];

            for (const [field, value] of Object.entries(fieldsToUpdate)) {
                if (value !== undefined && value !== null) {
                    const col = columnMap[field];
                    if (col) {
                        updateData.push({
                            range: `Ingresos transacciones!${col}${incomeRowIndex}`,
                            values: [[value]],
                        });
                    }
                }
            }

            if (updateData.length === 0) {
                logger.warn('SHEETS', 'updateIncomeRow: no valid fields provided');
                return;
            }

            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                requestBody: {
                    valueInputOption: 'USER_ENTERED',
                    data: updateData,
                },
            });

            logger.info('SHEETS', `Income row ${incomeRowIndex} updated: ${Object.keys(fieldsToUpdate).join(', ')}`);
            recordSheetsOperation('update_income', 'success');
        });
    } catch (error) {
        logger.error('SHEETS', 'Error updating income row (exhausted retries):', error);
        recordSheetsOperation('update_income', 'error');
    }
};

// Backward-compatible alias
export const actualizarFilaIngreso = updateIncomeRow;

export interface IncomeRow {
    fila: number;
    nPedido: string;
    fecha: string;
    tipo: string;
    descripcion: string;
    precioCompra: string;
    medioDePago: string;
    referenciaDePago: string;
    cuentaDestino: string;
    vendedor: string;
}

// Backward-compatible alias
export type FilaIngreso = IncomeRow;

export interface SalesRow {
    fila: number;
    nPedido: string;
    cantidadRelojes: number;
    cantidadOtros: number;
}

// Backward-compatible alias
export type FilaVenta = SalesRow;

/**
 * Scans Column A of `Ingresos transacciones` from bottom up to discover the latest numerical order ID (`LG-XXX`).
 * Used at startup to synchronize SQLite's sequence counter with Google Sheets.
 * 
 * @returns Highest numerical order ID found, or null if empty.
 */
export const getLatestOrderNumberFromSheets = async (): Promise<number | null> => {
    try {
        return await executeWithRetry(async () => {
            const sheets = await getSheetsClient();

            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: 'Ingresos transacciones!A:A',
            });

            const rows = response.data.values || [];
            for (let i = rows.length - 1; i >= 0; i--) {
                const value = rows[i]?.[0];
                if (value) {
                    const match = String(value).match(/LG-(\d+)/);
                    if (match && match[1]) {
                        return parseInt(match[1], 10);
                    }
                }
            }
            return null;
        });
    } catch (error) {
        logger.error('SHEETS', 'Error getting latest order number from Sheets:', error);
        return null;
    }
};

// Backward-compatible alias
export const obtenerUltimoNPedido = getLatestOrderNumberFromSheets;

/**
 * Reads all transaction records from `Ingresos transacciones!A:I`, skipping the header row.
 * 
 * @returns Array of IncomeRow objects with 1-based sheet row indices.
 */
export const readIncomeRows = async (): Promise<IncomeRow[]> => {
    try {
        return await executeWithRetry(async () => {
            const sheets = await getSheetsClient();

            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: 'Ingresos transacciones!A:I',
            });

            const rows = response.data.values || [];
            if (rows.length <= 1) return [];

            return rows.slice(1).map((row: string[], index: number) => ({
                fila: index + 2,
                nPedido: row[0] || '',
                fecha: row[1] || '',
                tipo: row[2] || '',
                descripcion: row[3] || '',
                precioCompra: row[4] || '',
                medioDePago: row[5] || '',
                referenciaDePago: row[6] || '',
                cuentaDestino: row[7] || '',
                vendedor: row[8] || '',
            }));
        });
    } catch (error) {
        logger.error('SHEETS', 'Error reading income rows from Sheets:', error);
        return [];
    }
};

// Backward-compatible alias
export const leerIngresosTransacciones = readIncomeRows;

/**
 * Reads all sales records from `Ventas!A:J`, skipping the header row.
 * 
 * @returns Array of SalesRow objects with parsed item quantities.
 */
export const readSalesRows = async (): Promise<SalesRow[]> => {
    try {
        return await executeWithRetry(async () => {
            const sheets = await getSheetsClient();
            const salesSheetName = process.env.SHEETS_VENTAS_NOMBRE || 'Ventas';

            const response = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${salesSheetName}!A:J`,
            });

            const rows = response.data.values || [];
            if (rows.length <= 1) return [];

            return rows.slice(1).map((row: string[], index: number) => ({
                fila: index + 2,
                nPedido: row[0] || '',
                cantidadRelojes: parseInt(row[8] ?? '0', 10) || 0,
                cantidadOtros: parseInt(row[9] ?? '0', 10) || 0,
            }));
        });
    } catch (error) {
        logger.error('SHEETS', 'Error reading sales rows from Sheets:', error);
        return [];
    }
};

// Backward-compatible alias
export const leerVentas = readSalesRows;

registerSequenceSyncCallback(getLatestOrderNumberFromSheets);
