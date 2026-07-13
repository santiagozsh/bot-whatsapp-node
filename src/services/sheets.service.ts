import { google } from 'googleapis';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { formatearFecha, formatearCuenta, ejecutarConRetry } from '../utils/helpers';
import { generarSiguienteNPedido } from './memory.service';
import { obtenerDepartamento } from '../utils/colombia.data';
import { logger } from '../utils/logger';
import type { DatosIngreso, DatosCliente, DatosIngresoParcial } from '../types';

dotenv.config();

const SPREADSHEET_ID = (() => {
    const id = process.env.GOOGLE_SHEETS_ID;
    if (!id) throw new Error('GOOGLE_SHEETS_ID no está definido en las variables de entorno');
    return id;
})();

let sheetsClientPromise: ReturnType<typeof inicializarGoogleSheets> | null = null;

const inicializarGoogleSheets = async () => {
    const auth = new google.auth.GoogleAuth({
        keyFile: path.join(__dirname, '../../google-keys.json'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const cliente = await auth.getClient();
    // googleapis-common bundles its own google-auth-library version,
    // causing TS to reject type assertion to a narrower type. `any` is the pragmatic cast.
    return google.sheets({ version: 'v4', auth: cliente as any });
};

const obtenerSheets = async () => {
    if (!sheetsClientPromise) {
        sheetsClientPromise = inicializarGoogleSheets();
        logger.info('SHEETS', 'Cliente de Google Sheets inicializado (singleton)');
    }
    return sheetsClientPromise;
};

const extraerNumeroFila = (updatedRange: string | undefined | null): number => {
    if (!updatedRange) return 0;
    const match = updatedRange.match(/!?[A-Z]+(\d+)/);
    return match?.[1] ? parseInt(match[1], 10) : 0;
};

export const escribirFilaEnExcel = async (datosJSON: DatosIngreso): Promise<{ nPedido: string; filaIngreso: number } | null> => {
    try {
        return await ejecutarConRetry(async () => {
            const sheets = await obtenerSheets();

            const nuevoId = generarSiguienteNPedido();

            const fechaLimpia = formatearFecha(datosJSON.fecha);
            const cuentaLimpia = formatearCuenta(datosJSON.cuentaDestino);

            const filaDeDatos = [
                nuevoId,
                fechaLimpia,
                datosJSON.tipo || "Ingreso",
                datosJSON.descripcion || "Pedido al por menor",
                datosJSON.precioCompra,
                datosJSON.medioDePago,
                datosJSON.referenciaDePago,
                cuentaLimpia,
                datosJSON.vendedor || "JHON",
            ];

            const appendResponse = await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                range: 'Ingresos transacciones!A:I',
                valueInputOption: 'USER_ENTERED',
                insertDataOption: 'INSERT_ROWS',
                requestBody: { values: [filaDeDatos] },
            });

            const updatedRange: string | undefined | null = appendResponse.data.updates?.updatedRange;
            const filaIngreso = extraerNumeroFila(updatedRange);

            logger.info('SHEETS', `Fila creada: ${nuevoId} (fila ${filaIngreso})`);
            return { nPedido: nuevoId, filaIngreso };
        });
    } catch (error) {
        logger.error('SHEETS', 'Error escribiendo fila (agotados reintentos):', error);
        return null;
    }
};


export const escribirFilaVenta = async (
    datosCliente: DatosCliente,
    nPedido: string,
    fecha: string
): Promise<number> => {
    try {
        return await ejecutarConRetry(async () => {
            const sheets = await obtenerSheets();
            const hojaVentas = process.env.SHEETS_VENTAS_NOMBRE || 'Ventas';

            const departamento = obtenerDepartamento(datosCliente.municipio || '');

            const filaDeDatos = [
                nPedido,
                fecha,
                datosCliente.nombreCliente  || 'N/A',
                datosCliente.email          || 'N/A',
                datosCliente.telefono       || 'N/A',
                datosCliente.municipio      || 'N/A',
                departamento,
                datosCliente.producto       || 'N/A',
                datosCliente.cantidadRelojes ?? 0,
                datosCliente.cantidadOtros  ?? 0,
            ];

            const appendResponse = await sheets.spreadsheets.values.append({
                spreadsheetId: SPREADSHEET_ID,
                range: `${hojaVentas}!A:J`,
                valueInputOption: 'USER_ENTERED',
                insertDataOption: 'INSERT_ROWS',
                requestBody: { values: [filaDeDatos] },
            });

            const updatedRange: string | undefined | null = appendResponse.data.updates?.updatedRange;
            const numeroFilaNueva = extraerNumeroFila(updatedRange);

            logger.info('SHEETS', `Ventas fila ${numeroFilaNueva} creada para ${nPedido}`);
            return numeroFilaNueva;
        });
    } catch (error) {
        logger.error('SHEETS', 'Error escribiendo fila de venta (agotados reintentos):', error);
        return -1;
    }
};

export const mergeFilaVenta = async (
    filaVenta: number,
    datosNuevos: DatosCliente
): Promise<void> => {
    try {
        await ejecutarConRetry(async () => {
            const sheets = await obtenerSheets();
            const hojaVentas = process.env.SHEETS_VENTAS_NOMBRE || 'Ventas';

            const lecturaActual = await sheets.spreadsheets.values.get({
                spreadsheetId: SPREADSHEET_ID,
                range: `${hojaVentas}!A${filaVenta}:J${filaVenta}`,
            });

            const filaActual: string[] = lecturaActual.data.values?.[0] || [];

            const estaVacio = (valor: string | undefined): boolean => {
                if (valor === undefined || valor === null) return true;
                const limpio = valor.toString().trim().toUpperCase();
                return limpio === '' || limpio === 'N/A' || limpio === '0';
            };

            const deptoNuevo = obtenerDepartamento(datosNuevos.municipio || '');

            const filaFinal = [
                filaActual[0] || '',
                filaActual[1] || '',
                estaVacio(filaActual[2]) ? (datosNuevos.nombreCliente  || 'N/A') : filaActual[2],
                estaVacio(filaActual[3]) ? (datosNuevos.email          || 'N/A') : filaActual[3],
                estaVacio(filaActual[4]) ? (datosNuevos.telefono       || 'N/A') : filaActual[4],
                estaVacio(filaActual[5]) ? (datosNuevos.municipio      || 'N/A') : filaActual[5],
                estaVacio(filaActual[6]) ? deptoNuevo                             : filaActual[6],
                estaVacio(filaActual[7]) ? (datosNuevos.producto       || 'N/A') : filaActual[7],
                estaVacio(filaActual[8]) ? (datosNuevos.cantidadRelojes ?? 0)    : filaActual[8],
                estaVacio(filaActual[9]) ? (datosNuevos.cantidadOtros  ?? 0)    : filaActual[9],
            ];

            await sheets.spreadsheets.values.update({
                spreadsheetId: SPREADSHEET_ID,
                range: `${hojaVentas}!A${filaVenta}:J${filaVenta}`,
                valueInputOption: 'USER_ENTERED',
                requestBody: { values: [filaFinal] },
            });

            logger.info('SHEETS', `Ventas fila ${filaVenta} mergeada`);
        });
    } catch (error) {
        logger.error('SHEETS', 'Error en merge de venta (agotados reintentos):', error);
    }
};

export const actualizarFilaIngreso = async (
    filaIngreso: number,
    campos: DatosIngresoParcial
): Promise<void> => {
    try {
        await ejecutarConRetry(async () => {
            const sheets = await obtenerSheets();

            const mapColumnas: Record<string, string> = {
                tipo:     'C',
                vendedor: 'I',
            };

            const data: { range: string; values: string[][] }[] = [];

            for (const [campo, valor] of Object.entries(campos)) {
                if (valor !== undefined && valor !== null) {
                    const col = mapColumnas[campo];
                    data.push({
                        range: `Ingresos transacciones!${col}${filaIngreso}`,
                        values: [[valor]],
                    });
                }
            }

            if (data.length === 0) {
                logger.warn('SHEETS', 'actualizarFilaIngreso: ningún campo válido');
                return;
            }

            await sheets.spreadsheets.values.batchUpdate({
                spreadsheetId: SPREADSHEET_ID,
                requestBody: {
                    valueInputOption: 'USER_ENTERED',
                    data,
                },
            });

            logger.info('SHEETS', `Ingreso fila ${filaIngreso} actualizado: ${Object.keys(campos).join(', ')}`);
        });
    } catch (error) {
        logger.error('SHEETS', 'Error actualizando fila de ingreso (agotados reintentos):', error);
    }
};


