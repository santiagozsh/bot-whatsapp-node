import Tesseract from 'tesseract.js';
import { logger } from '../utils/logger';

interface TrOCRPipeline {
    (input: string | Buffer): Promise<Array<{ generated_text: string }>>;
}

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

// ── TrOCR pipeline (lazy init, se descarga una sola vez) ───────

let trocrPipeline: TrOCRPipeline | null = null;
let trocrCargando = false;

async function obtenerTrOCR(): Promise<TrOCRPipeline | null> {
    if (trocrPipeline) return trocrPipeline;
    if (trocrCargando) return null;

    try {
        trocrCargando = true;
        logger.info('TrOCR', 'Cargando modelo microsoft/trocr-base-handwritten...');

        // Dynamic import para no cargar transformers si nunca se necesita
        const { pipeline } = await import('@xenova/transformers');
        trocrPipeline = await pipeline('image-to-text', 'Xenova/trocr-base-handwritten') as TrOCRPipeline;

        logger.info('TrOCR', 'Modelo cargado correctamente');
        return trocrPipeline;
    } catch (error) {
        logger.error('TrOCR', 'Error cargando modelo:', error);
        return null;
    } finally {
        trocrCargando = false;
    }
}

// ── OCR mejorado: Tesseract → TrOCR fallback ──────────────────

const UMBRAL_TEXTO_CORTO = 10; // caracteres mínimos para confiar en Tesseract

/**
 * Extrae texto de una imagen con estrategia en cascada:
 * 1. Tesseract primero (rápido, bueno para texto impreso y capturas de pantalla)
 * 2. Si Tesseract falla (texto vacío o muy corto) → TrOCR (especializado en manuscrita)
 * 3. Si TrOCR también falla → retornar cadena vacía (se descarta, 0 tokens)
 *
 * @param imagenBase64 - Imagen en base64 ya optimizada (Sharp)
 */
export const extraerTextoConVisionMejorado = async (
    imagenBase64: string
): Promise<string> => {
    try {
        // Paso 1: Tesseract
        const textoTesseract = await extraerTextoConVision(imagenBase64);

        const esTextoValido = textoTesseract
            && textoTesseract !== 'SIN_TEXTO_DETECTADO'
            && textoTesseract.length >= UMBRAL_TEXTO_CORTO;

        if (esTextoValido) {
            return textoTesseract;
        }

        // Paso 2: Tesseract falló → intentar TrOCR
        logger.info('TrOCR', `Tesseract obtuvo texto corto/vacío (${textoTesseract.length} chars). Intentando TrOCR...`);

        const pipeline = await obtenerTrOCR();
        if (!pipeline) {
            logger.warn('TrOCR', 'Modelo no disponible, descartando imagen');
            return '';
        }

        const buffer = Buffer.from(imagenBase64, 'base64');
        const resultados = await pipeline(buffer);
        const textoTrOCR = (resultados?.[0]?.generated_text || '').trim();

        if (textoTrOCR && textoTrOCR.length >= UMBRAL_TEXTO_CORTO) {
            logger.info('TrOCR', `Texto extraído (${textoTrOCR.length} caracteres).`);
            return textoTrOCR;
        }

        logger.warn('TrOCR', 'Tampoco se detectó texto con TrOCR.');
        return '';

    } catch (error) {
        logger.error('OCR', 'Error en OCR mejorado:', error);
        return '';
    }
};
