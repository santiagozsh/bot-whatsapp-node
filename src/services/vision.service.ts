import Tesseract from 'tesseract.js';

/**
 * Extrae todo el texto de una imagen usando Tesseract OCR (local, sin APIs externas).
 * Optimizado para comprobantes bancarios colombianos (Nequi, Bancolombia, Daviplata).
 */
export const extraerTextoConVision = async (imagenBase64: string): Promise<string> => {
    try {
        console.log('👁️ [OCR] Extrayendo texto con Tesseract...');

        // Convertimos el base64 a un Buffer que Tesseract puede leer
        const buffer = Buffer.from(imagenBase64, 'base64');

        const resultado = await Tesseract.recognize(
            buffer,
            'spa+eng', // Español + Inglés (cubre términos bancarios en ambos idiomas)
            {
                // Silenciamos los logs internos de Tesseract para no ensuciar la consola
                logger: () => {},
            }
        );

        const textoExtraido = resultado.data.text.trim();

        if (!textoExtraido) {
            console.warn('⚠️ [OCR] No se detectó texto en la imagen.');
            return 'SIN_TEXTO_DETECTADO';
        }

        console.log(`✅ [OCR] Texto extraído (${textoExtraido.length} caracteres).`);
        return textoExtraido;

    } catch (error) {
        console.error('❌ [OCR] Error en Tesseract:', error);
        throw error;
    }
};
