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
