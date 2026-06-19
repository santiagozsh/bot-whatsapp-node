import { GoogleGenerativeAI } from '@google/generative-ai';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

// 1. Cargamos las variables de entorno (.env)
dotenv.config();


// 2. Inicializamos el cliente de Gemini con nuestra llave
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);

// 3. Función auxiliar para convertir la imagen a un formato que la IA entienda
function prepararImagen(rutaArchivo: string, mimeType: string) {
    return {
        inlineData: {
            data: Buffer.from(fs.readFileSync(rutaArchivo)).toString("base64"),
            mimeType
        },
    };
}

export const extraerDatosConIA = async () => {
    try {
        console.log('🤖 Enviando imagen a Gemini...');

        // Leemos el modelo del .env, y si por algún motivo no existe, usamos uno por defecto
        const geminiModel = process.env.GEMINI_MODEL || "gemini-3.5-flash";
        
        const model = genAI.getGenerativeModel({ 
            model: geminiModel,
            generationConfig: {
                responseMimeType: "application/json", // ¡Forzamos a que solo devuelva JSON!
            }
        });

        // 4. Preparamos el Prompt Maestro y la Imagen
        // (Asegúrate de que el nombre del archivo aquí coincida con la imagen que pusiste)
        const imagen = prepararImagen("prueba.png", "image/png"); 
        
        const prompt = `
            Eres un experto analista contable. Extrae los datos de esta captura de pantalla de transferencia bancaria.
            Devuelve un objeto JSON con exactamente esta estructura y llaves:
            {
                "fecha": "DD/MM/YYYY",
                "precioCompra": "Solo el número sin puntos ni comas",
                "medioDePago": "ej. Nequi, Bancolombia, Daviplata",
                "referenciaDePago": "El número de referencia o comprobante. Si no hay, pon N/A",
                "cuentaDestino": "El número de teléfono o cuenta al que ingresó el dinero"
            }
        `;

        // 5. Disparamos la petición a los servidores de Google
        const resultado = await model.generateContent([prompt, imagen]);
        const respuestaJson = resultado.response.text();

        console.log('\n✅ ¡Extracción exitosa! Este es el JSON:');
        console.log(respuestaJson);

    } catch (error) {
        console.error('❌ Error al procesar con IA:', error);
    }
};

// ==========================================
// MODO DE PRUEBA: Ejecutar esto solo si corremos este archivo directamente
// ==========================================
if (require.main === module) {
    extraerDatosConIA();
}
