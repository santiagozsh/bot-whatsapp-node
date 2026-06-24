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
            console.log(`⏳ [RETRY] Intento ${intento + 1}/${maxIntentos} falló (${statusCode}). Reintentando en ${espera / 1000}s...`);
            await new Promise(resolve => setTimeout(resolve, espera));
        }
    }
    throw new Error('ejecutarConRetry: se agotaron los intentos');
};
