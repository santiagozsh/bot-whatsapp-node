import { logger } from './logger';

// 1. Generar el identificador único en cascada
export const generarSiguienteId = (ultimoId: string): string => {
    // Si la hoja está vacía y no hay ID previo, arrancamos en LG-01
    if (!ultimoId || !ultimoId.startsWith('LG-')) return 'LG-01';
    
    // Extraemos el número después del guion y le sumamos 1
    const numeroActual = parseInt(ultimoId.split('-')[1] || '0', 10);
    const siguienteNumero = numeroActual + 1;
    
    // padStart asegura que si es 4, ponga "04", y si es 15, deje "15"
    return `LG-${siguienteNumero.toString().padStart(2, '0')}`;
};

// 2. Cambiar formato de "DD/MM/YYYY" a "D-Mes-YYYY"
export const formatearFecha = (fechaOriginal: string): string => {
    const meses = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    const partes = fechaOriginal.split('/');
    
    if (partes.length === 3) {
        const dia = parseInt(partes[0] || '1', 10); // parseInt quita el cero a la izquierda del día (ej. 01 -> 1)
        const mes = meses[parseInt(partes[1] || '1', 10) - 1]; // Array empieza en 0, por eso restamos 1
        const anio = partes[2];
        return `${dia}-${mes}-${anio}`;
    }
    return fechaOriginal; 
};

// 3. Separar la cuenta con espacios "314 352 7475"
export const formatearCuenta = (cuentaOriginal: string): string => {
    const cuentaLimpia = cuentaOriginal.replace(/\s+/g, ''); // Quitamos espacios por si acaso
    if (cuentaLimpia.length === 10) {
        return `${cuentaLimpia.slice(0, 3)} ${cuentaLimpia.slice(3, 6)} ${cuentaLimpia.slice(6)}`;
    }
    return cuentaOriginal; 
};

// 4. Retry con backoff exponencial para llamadas a APIs externas
/**
 * Ejecuta una función async con reintentos y backoff exponencial.
 * Solo reintenta en errores de rate limit (429) o errores de servidor (500+).
 * 
 * Ejemplo de tiempos con config por defecto (maxIntentos=4):
 *   Intento 1: inmediato
 *   Intento 2: espera 1 segundo
 *   Intento 3: espera 2 segundos
 *   Intento 4: espera 4 segundos
 *   Total máximo de espera: 7 segundos (solo si TODOS fallan)
 */
export const ejecutarConRetry = async <T>(
    fn: () => Promise<T>,
    maxIntentos: number = 4,
    delayBaseMs: number = 1000
): Promise<T> => {
    for (let intento = 0; intento < maxIntentos; intento++) {
        try {
            return await fn();
        } catch (error: any) {
            const esUltimoIntento = intento === maxIntentos - 1;
            const statusCode = error?.status || error?.response?.status;
            const esReintentable = statusCode === 429 || (statusCode && statusCode >= 500);

            if (!esReintentable || esUltimoIntento) {
                throw error; // Error no reintentable o ya no hay intentos
            }

            const espera = delayBaseMs * Math.pow(2, intento); // 1s, 2s, 4s...
            logger.warn('RETRY', `Intento ${intento + 1}/${maxIntentos} falló (${statusCode}). Reintentando en ${espera / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, espera));
        }
    }
    throw new Error('ejecutarConRetry: se agotaron los intentos');
};

// 5. Normalizar texto para búsquedas (mayúsculas sin tildes ni diacríticos)
/**
 * Convierte un texto a mayúsculas y elimina tildes/diacríticos.
 * Ejemplo: "Bogotá" → "BOGOTA", "Medellín" → "MEDELLIN", "ñoño" → "NONO"
 * Usado por obtenerDepartamento() en colombia.data.ts y otros lookups locales.
 */
export const normalizarTexto = (texto: string): string => {
    return texto
        .toUpperCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .trim();
};

// 6. Normalizar texto extraído por OCR para mejorar precisión de la IA
export const normalizarTextoOCR = (texto: string): string => {
    if (!texto) return texto;
    return texto
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')  // caracteres de control no imprimibles
        .replace(/\r\n/g, '\n')                            // normalizar saltos de línea
        .replace(/\r/g, '\n')
        .replace(/[ \t]+/g, ' ')                           // múltiples espacios → uno solo
        .replace(/\n{3,}/g, '\n\n')                        // múltiples saltos de línea → máximo 2
        .replace(/[•·]/g, '-')                             // bullets a guiones
        .replace(/[‒–—―]/g, '-')                           // guiones largos/medios a guión normal
        .replace(/[""']/g, '"')                           // comillas curvas a rectas
        .replace(/[''']/g, "'")
        .trim();
};

// 7. Clasificar tipo de transacción (Ingreso vs Abono) según cuenta y texto
const CUENTAS_ABONO = ['3106131751', '3103455869', '03759053996'];
const NOMBRES_ABONO = ['yenci', 'yenny', 'yazmin', 'ramirez'];
const CUENTAS_INGRESO = ['3143527475', '3224442154', '3212267474'];

export const clasificarTipoIngreso = (
    cuentaDestino: string,
    textoOCR: string
): 'Ingreso' | 'Abono' => {
    const cuenta = cuentaDestino.replace(/[\s.\-()]/g, '');
    const texto = textoOCR.toLowerCase();

    if (CUENTAS_INGRESO.some(c => cuenta.includes(c))) return 'Ingreso';

    if (CUENTAS_ABONO.some(c => cuenta.includes(c))) return 'Abono';

    if (NOMBRES_ABONO.some(n => texto.includes(n))) return 'Abono';

    return 'Ingreso';
};

// 8. Extraer vendedor del contexto de WhatsApp con regex
const VENDEDORES_CONOCIDOS = ['evelin', 'alejandra', 'aleja', 'karol', 'david'];
const PATRON_VENDEDOR = /(?:venta|vendedor|vendido por)[:\s]+(\w+)/i;
const STOP_WORDS = new Set(['en', 'de', 'del', 'la', 'el', 'que', 'con', 'sin', 'por', 'para', 'un', 'una', 'los', 'las', 'y', 'o', 'no', 'se', 'su', 'al', 'a', 'es', 'lo', 'le', 'me', 'te', 'tu', 'mi', 'mas', 'pero', 'como', 'ya', 'si', 'muy', 'todo', 'hay', 'nos', 'han', 'son', 'fue', 'era']);

export const extraerVendedor = (contexto: string): string => {
    const match = contexto.match(PATRON_VENDEDOR);
    if (match && match[1]) {
        const nombre = match[1].toLowerCase();

        // Ignorar si capturó una palabra vacía de contenido (stop word)
        if (STOP_WORDS.has(nombre) || nombre.length < 2) return 'JHON';

        const conocido = VENDEDORES_CONOCIDOS.find(v => nombre.includes(v));
        if (conocido) {
            return conocido.charAt(0).toUpperCase() + conocido.slice(1);
        }
        return match[1].charAt(0).toUpperCase() + match[1].slice(1).toLowerCase();
    }

    return 'JHON';
};

// 9. Validar si un texto extraído por OCR es potencialmente útil o es basura
const MIN_CHARS_UTILES = 8;
const MAX_RATIO_TOKENS_CORTOS = 0.55;

export const esTextoUtil = (texto: string): boolean => {
    if (!texto || texto === 'SIN_TEXTO_DETECTADO') return false;

    const limpio = texto.trim();

    if (limpio.length < MIN_CHARS_UTILES) return false;

    // Tokenizar: dividir por espacios y limpiar puntuación en bordes
    const tokens = limpio
        .split(/\s+/)
        .map(t => t.replace(/^[^\wáéíóúüñÁÉÍÓÚÜÑ]+|[^\wáéíóúüñÁÉÍÓÚÜÑ]+$/g, ''))
        .filter(t => t.length > 0);

    if (tokens.length === 0) return false;

    const tokensCortos = tokens.filter(t => t.length <= 2).length;
    const ratioCortos = tokensCortos / tokens.length;

    // OCR basura produce muchos tokens de 1-2 caracteres
    if (ratioCortos > MAX_RATIO_TOKENS_CORTOS) return false;

    return true;
};
