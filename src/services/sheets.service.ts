import { google } from 'googleapis';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { formatearFecha, formatearCuenta, generarSiguienteId } from '../utils/helpers';

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
