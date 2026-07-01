import { google } from 'googleapis';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { formatearFecha, formatearCuenta, generarSiguienteId } from '../utils/helpers';
import { obtenerDepartamento } from '../utils/colombia.data';
import { logger } from '../utils/logger';
import type { DatosIngreso, DatosCliente, DatosIngresoParcial } from '../types';

dotenv.config();

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID as string;

const inicializarGoogleSheets = async () => {
    const auth = new google.auth.GoogleAuth({
        keyFile: path.join(__dirname, '../../google-keys.json'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const cliente = await auth.getClient();
    return google.sheets({ version: 'v4', auth: cliente as any });
};

export const escribirFilaEnExcel = async (datosJSON: DatosIngreso): Promise<{ nPedido: string; filaIngreso: number } | null> => {
    try {
        const sheets = await inicializarGoogleSheets();

        logger.info('SHEETS', 'Leyendo columna A para calcular N.Pedido...');
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Ingresos transacciones!A:A',
        });

        const filas = response.data.values;
        let ultimoId = 'LG-00';
        const filaIngreso = (filas?.length || 0) + 1;

        if (filas && filas.length > 0) {
            ultimoId = filas[filas.length - 1]?.[0] || 'LG-00';
        }

        const nuevoId = generarSiguienteId(ultimoId);
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

        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Ingresos transacciones!A:I',
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [filaDeDatos] },
        });

        logger.info('SHEETS', `Fila creada: ${nuevoId} (fila ${filaIngreso})`);
        return { nPedido: nuevoId, filaIngreso };

    } catch (error) {
        logger.error('SHEETS', 'Error escribiendo fila:', error);
        return null;
    }
};


export const escribirFilaVenta = async (
    datosCliente: DatosCliente,
    nPedido: string,
    fecha: string
): Promise<number> => {
    try {
        const sheets = await inicializarGoogleSheets();
        const hojaVentas = process.env.SHEETS_VENTAS_NOMBRE || 'Ventas';

        const lecturaActual = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${hojaVentas}!A:A`,
        });

        const filasExistentes = lecturaActual.data.values || [];
        const numeroFilaNueva = filasExistentes.length + 1;

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

        logger.info('SHEETS', `Escribiendo Ventas fila ${numeroFilaNueva} para ${nPedido}...`);

        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${hojaVentas}!A:J`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [filaDeDatos] },
        });

        logger.info('SHEETS', `Ventas fila ${numeroFilaNueva} creada para ${nPedido}`);
        return numeroFilaNueva;

    } catch (error) {
        logger.error('SHEETS', 'Error escribiendo fila de venta:', error);
        return -1;
    }
};

export const mergeFilaVenta = async (
    filaVenta: number,
    datosNuevos: DatosCliente
): Promise<void> => {
    try {
        const sheets = await inicializarGoogleSheets();
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

    } catch (error) {
        logger.error('SHEETS', 'Error en merge de venta:', error);
    }
};

export const actualizarFilaIngreso = async (
    filaIngreso: number,
    campos: DatosIngresoParcial
): Promise<void> => {
    try {
        const sheets = await inicializarGoogleSheets();

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

    } catch (error) {
        logger.error('SHEETS', 'Error actualizando fila de ingreso:', error);
    }
};


