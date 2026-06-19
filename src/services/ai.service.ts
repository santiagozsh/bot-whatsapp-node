import { GoogleGenerativeAI } from '@google/generative-ai';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import { construirPromptContable } from '../utils/prompts';

// 1. Cargamos las variables de entorno (.env)
dotenv.config();


// 2. Inicializamos el cliente de Gemini con nuestra llave
const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY as string);

// Ahora preparamos la imagen directamente desde la memoria (Base64)
function prepareImage(base64: string, mimeType: string) {
    return {
        inlineData: {
            data: base64,
            mimeType
        },
    };
}

export const extraerDatosConIA = async (imagenBase64: string, mimeType: string, contextoTexto: string) => {
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

        const imageReady  = prepareImage(imagenBase64, mimeType);

        // Llamamos a la función que nos trae el texto gigante
        const prompt = construirPromptContable(contextoTexto);
        
        // 5. Disparamos la petición a los servidores de Google
        const resultado = await model.generateContent([prompt, imageReady]);
        const respuestaJson = resultado.response.text();

        console.log('\n✅ ¡Extracción exitosa! Este es el JSON:');
        console.log(respuestaJson);
        return JSON.parse(respuestaJson);

    } catch (error) {
        console.error('❌ Error al procesar con IA:', error);
    }
};

// ==========================================
// MODO DE PRUEBA:
// ==========================================
// if (require.main === module) {
//     const probarMegaprompt = async () => {
//         try {
//             const base64Prueba = Buffer.from(fs.readFileSync("prueba.png")).toString("base64");
            
//             const textosSimulados = `
//                 [10:05 AM] Karol: Chicos, aquí mando el pago del cliente de Bogotá.
//                 [10:06 AM] Karol: Son 4 relojes en total, 2 Rolex y 2 Cartier.
//             `;

//             const resultado = await extraerDatosConIA(base64Prueba, "image/png", textosSimulados);
//             console.log('\n✅ Prueba del Megaprompt exitosa. Resultado:');
//             console.log(resultado);
//         } catch (e) {
//             console.log("No se pudo hacer la prueba aislada. Falta prueba.png");
//         }
//     };
//     probarMegaprompt();
// }
