import { google } from 'googleapis';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { formatearFecha, formatearCuenta, generarSiguienteId } from '../utils/helpers';
import { obtenerDepartamento } from '../utils/colombia.data';

dotenv.config();

// El ID de tu Excel (Lo sacas de la URL de tu Google Sheets: https://docs.google.com/spreadsheets/d/AQUI_ESTA_EL_ID/edit)
const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_ID as string;

export const inicializarGoogleSheets = async () => {
    // Busca el archivo de llaves en la raíz del proyecto
    const auth = new google.auth.GoogleAuth({
        keyFile: path.join(__dirname, '../../google-keys.json'),
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const cliente = await auth.getClient();
    return google.sheets({ version: 'v4', auth: cliente as any });
};

export const escribirFilaEnExcel = async (datosJSON: any) => {
    try {
        const sheets = await inicializarGoogleSheets();


        // PASO 1: Leer la última fila de la columna A para saber el N.Pedido
        console.log('🔍 Leyendo la columna A para calcular el N.Pedido...');
        const response = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: 'Ingresos transacciones!A:A', // Solo leemos la columna A
        });

        const filas = response.data.values;
        let ultimoId = 'LG-00';
        
        if (filas && filas.length > 0) {
            // Tomamos el último valor que exista en la columna A
            ultimoId = filas[filas.length - 1]?.[0] || 'LG-00';
        }

        // PASO 2: Procesar los datos con nuestros Helpers
        const nuevoId = generarSiguienteId(ultimoId);
        const fechaLimpia = formatearFecha(datosJSON.fecha);
        const cuentaLimpia = formatearCuenta(datosJSON.cuentaDestino);

        // PASO 3: Construir la fila final usando los datos de la IA
        const filaDeDatos = [
            nuevoId,                               // N.Pedido
            fechaLimpia,                           // Fecha
            datosJSON.tipo || "Ingreso",           // Tipo dinámico
            datosJSON.descripcion || "Pedido al por menor", // Descripción dinámica
            datosJSON.precioCompra,                // Precio
            datosJSON.medioDePago,                 // Medio
            datosJSON.referenciaDePago,            // Referencia
            cuentaLimpia,                          // # Cuenta
            datosJSON.vendedor || "JHON"           // ¡Vendedor dinámico! (JHON por defecto si falla)
        ];

        console.log('📝 Escribiendo datos en Google Sheets...');

        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            // "Ingresos transacciones" es el nombre exacto de la pestaña en tu Excel
            range: 'Ingresos transacciones!A:I', 
            valueInputOption: 'USER_ENTERED', // Para que Excel respete el formato de números y fechas
            requestBody: {
                values: [filaDeDatos],
            },
        });

        console.log('✅ ¡Fila agregada correctamente a Google Sheets!');

    } catch (error) {
        console.error('❌ Error escribiendo en Google Sheets:', error);
    }
};

// ==========================================
// MODO DE PRUEBA AISLADA
// ==========================================
// if (require.main === module) {
//     const datosDePrueba = {
//         fecha: "19/06/2026",
//         precioCompra: "165000",
//         medioDePago: "Nequi",
//         referenciaDePago: "M11650120",
//         cuentaDestino: "3143527475"
//     };

//     // Si falta el ID del Excel, avisamos
//     if (!SPREADSHEET_ID) {
//         console.error('⚠️ Faltó poner el GOOGLE_SHEETS_ID en el archivo .env');
//     } else {
//         escribirFilaEnExcel(datosDePrueba);
//     }
// }

// ==========================================
// BLOQUE 6 — Hoja Ventas
// ==========================================

/**
 * Campos de la hoja "Ingresos transacciones" que se pueden actualizar
 * parcialmente desde un Reply tardío (ej. corrección de vendedor o tipo).
 *
 * Columna C = tipo (índice 2)
 * Columna I = vendedor (índice 8)
 */
interface DatosIngreso {
    tipo?: string;
    vendedor?: string;
}

/**
 * Crea una fila nueva en la hoja Ventas con los datos del cliente.
 *
 * El departamento se deduce localmente desde el municipio usando el diccionario
 * colombia.data.ts, sin gastar tokens adicionales de OpenAI.
 *
 * @param datosCliente  JSON retornado por extraerDatosCliente()
 * @param nPedido       Identificador del pedido (ej. "LG-26")
 * @param fecha         Fecha formateada (ej. "25-Jun-2026")
 * @returns             Número de fila creado en la hoja (1-indexed), para guardarlo en SQLite.
 *                      Retorna -1 si ocurre un error.
 */
export const escribirFilaVenta = async (
    datosCliente: any,
    nPedido: string,
    fecha: string
): Promise<number> => {
    try {
        const sheets = await inicializarGoogleSheets();
        const hojaVentas = process.env.SHEETS_VENTAS_NOMBRE || 'Ventas';

        // PASO 1: Leer la columna A para calcular el número de la próxima fila
        const lecturaActual = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${hojaVentas}!A:A`,
        });

        const filasExistentes = lecturaActual.data.values || [];
        // La nueva fila ocupa la posición después de las existentes (incluye cabecera)
        const numeroFilaNueva = filasExistentes.length + 1;

        // PASO 2: Deducir el departamento localmente (sin tokens de IA)
        const departamento = obtenerDepartamento(datosCliente.municipio || '');

        // PASO 3: Construir la fila de 10 columnas (A → J)
        const filaDeDatos = [
            nPedido,                                   // A — N.Pedido
            fecha,                                     // B — Fecha
            datosCliente.nombreCliente  || 'N/A',      // C — Nombre Cliente
            datosCliente.email          || 'N/A',      // D — Email
            datosCliente.telefono       || 'N/A',      // E — Teléfono
            datosCliente.municipio      || 'N/A',      // F — Municipio
            departamento,                              // G — Departamento (diccionario local)
            datosCliente.producto       || 'N/A',      // H — Producto
            datosCliente.cantidadRelojes ?? 0,         // I — Cant. Relojes
            datosCliente.cantidadOtros  ?? 0,          // J — Cant. Otros
        ];

        console.log(`📝 [VENTAS] Escribiendo fila ${numeroFilaNueva} en "${hojaVentas}"...`);

        await sheets.spreadsheets.values.append({
            spreadsheetId: SPREADSHEET_ID,
            range: `${hojaVentas}!A:J`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [filaDeDatos] },
        });

        console.log(`✅ [VENTAS] Fila ${numeroFilaNueva} creada correctamente para ${nPedido}.`);
        return numeroFilaNueva;

    } catch (error) {
        console.error('❌ [VENTAS] Error escribiendo fila de venta:', error);
        return -1;
    }
};

/**
 * Actualiza una fila ya existente en la hoja Ventas con datos nuevos,
 * pero SOLO sobreescribe las celdas que están vacías, en "N/A", o en 0.
 *
 * Esto permite complementar datos parciales sin borrar lo que ya había.
 *
 * @param filaVenta   Número de fila en la hoja (1-indexed, ej. 5 → fila 5)
 * @param datosNuevos JSON con los datos frescos del cliente
 */
export const mergeFilaVenta = async (
    filaVenta: number,
    datosNuevos: any
): Promise<void> => {
    try {
        const sheets = await inicializarGoogleSheets();
        const hojaVentas = process.env.SHEETS_VENTAS_NOMBRE || 'Ventas';

        // PASO 1: Leer la fila actual completa (columnas A→J)
        const lecturaActual = await sheets.spreadsheets.values.get({
            spreadsheetId: SPREADSHEET_ID,
            range: `${hojaVentas}!A${filaVenta}:J${filaVenta}`,
        });

        const filaActual: string[] = lecturaActual.data.values?.[0] || [];

        // Función auxiliar: decide si un valor actual está "vacío" y debe reemplazarse
        const estaVacio = (valor: string | undefined): boolean => {
            if (valor === undefined || valor === null) return true;
            const limpio = valor.toString().trim().toUpperCase();
            return limpio === '' || limpio === 'N/A' || limpio === '0';
        };

        // Deducir departamento del municipio nuevo (por si el original era N/A)
        const deptoNuevo = obtenerDepartamento(datosNuevos.municipio || '');

        // PASO 2: Construir la fila resultante: mantener valor actual si ya tiene datos,
        //         usar el nuevo si el actual estaba vacío.
        const filaFinal = [
            filaActual[0] || '',                                                    // A — N.Pedido (nunca se toca)
            filaActual[1] || '',                                                    // B — Fecha (nunca se toca)
            estaVacio(filaActual[2]) ? (datosNuevos.nombreCliente  || 'N/A') : filaActual[2], // C — Nombre
            estaVacio(filaActual[3]) ? (datosNuevos.email          || 'N/A') : filaActual[3], // D — Email
            estaVacio(filaActual[4]) ? (datosNuevos.telefono       || 'N/A') : filaActual[4], // E — Teléfono
            estaVacio(filaActual[5]) ? (datosNuevos.municipio      || 'N/A') : filaActual[5], // F — Municipio
            estaVacio(filaActual[6]) ? deptoNuevo                             : filaActual[6], // G — Departamento
            estaVacio(filaActual[7]) ? (datosNuevos.producto       || 'N/A') : filaActual[7], // H — Producto
            estaVacio(filaActual[8]) ? (datosNuevos.cantidadRelojes ?? 0)    : filaActual[8], // I — Cant. Relojes
            estaVacio(filaActual[9]) ? (datosNuevos.cantidadOtros  ?? 0)    : filaActual[9], // J — Cant. Otros
        ];

        // PASO 3: Escribir la fila mezclada de vuelta
        await sheets.spreadsheets.values.update({
            spreadsheetId: SPREADSHEET_ID,
            range: `${hojaVentas}!A${filaVenta}:J${filaVenta}`,
            valueInputOption: 'USER_ENTERED',
            requestBody: { values: [filaFinal] },
        });

        console.log(`✅ [VENTAS] Fila ${filaVenta} actualizada (merge) correctamente.`);

    } catch (error) {
        console.error('❌ [VENTAS] Error haciendo merge en fila de venta:', error);
    }
};

/**
 * Actualiza columnas específicas de una fila en "Ingresos transacciones".
 *
 * Solo escribe las columnas que se indiquen en `campos`, sin tocar las demás.
 * Útil para Reply tardío donde el usuario corrige el vendedor o el tipo.
 *
 * @param filaIngreso  Número de fila en la hoja (1-indexed)
 * @param campos       Objeto parcial con los campos a actualizar (tipo y/o vendedor)
 */
export const actualizarFilaIngreso = async (
    filaIngreso: number,
    campos: Partial<DatosIngreso>
): Promise<void> => {
    try {
        const sheets = await inicializarGoogleSheets();

        // Mapa de campo → columna de la hoja "Ingresos transacciones"
        const mapColumnas: Record<keyof DatosIngreso, string> = {
            tipo:     'C',   // columna C
            vendedor: 'I',   // columna I
        };

        // Construir los rangos de actualización solo para los campos provistos
        const data: { range: string; values: string[][] }[] = [];

        for (const [campo, valor] of Object.entries(campos) as [keyof DatosIngreso, string][]) {
            if (valor !== undefined && valor !== null) {
                const col = mapColumnas[campo];
                data.push({
                    range: `Ingresos transacciones!${col}${filaIngreso}`,
                    values: [[valor]],
                });
            }
        }

        if (data.length === 0) {
            console.log('⚠️ [INGRESOS] actualizarFilaIngreso: ningún campo válido para actualizar.');
            return;
        }

        await sheets.spreadsheets.values.batchUpdate({
            spreadsheetId: SPREADSHEET_ID,
            requestBody: {
                valueInputOption: 'USER_ENTERED',
                data,
            },
        });

        console.log(`✅ [INGRESOS] Fila ${filaIngreso} actualizada: ${Object.keys(campos).join(', ')}.`);

    } catch (error) {
        console.error('❌ [INGRESOS] Error actualizando fila de ingreso:', error);
    }
};
