import Tesseract from 'tesseract.js';
import { logger } from '../utils/logger';

type ModoOCR = 'comprobante' | 'formulario';

/**
 * Extrae todo el texto de una imagen usando Tesseract OCR (local, sin APIs externas).
 *
 * @param imagenBase64 - Imagen en base64
 * @param modo - 'comprobante' (default) | 'formulario' (PSM SINGLE_BLOCK)
 */
export const extraerTextoConVision = async (
    imagenBase64: string,
    modo: ModoOCR = 'comprobante'
): Promise<string> => {
    try {
        logger.info('OCR', `Extrayendo texto (${modo})...`);

        const buffer = Buffer.from(imagenBase64, 'base64');

        let resultado: Tesseract.RecognizeResult;

        if (modo === 'formulario') {
            const worker = await Tesseract.createWorker('spa+eng', Tesseract.OEM.LSTM_ONLY);
            await worker.setParameters({
                tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK,
            });
            resultado = await worker.recognize(buffer);
            await worker.terminate();
        } else {
            resultado = await Tesseract.recognize(
                buffer,
                'spa+eng',
                { logger: () => {} }
            );
        }

        const textoExtraido = resultado.data.text.trim();

        if (!textoExtraido) {
            logger.warn('OCR', 'No se detectó texto en la imagen.');
            return 'SIN_TEXTO_DETECTADO';
        }

        logger.info('OCR', `Texto extraído (${textoExtraido.length} caracteres).`);
        return textoExtraido;

    } catch (error) {
        logger.error('OCR', 'Error en Tesseract:', error);
        throw error;
    }
};
