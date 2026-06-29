import { normalizarTexto } from './helpers';

const MARCAS_RELOJ: Set<string> = new Set([
    "CSO", "CASIO",
    "CURREN",
    "G-FORCE", "GFORCE", "G FORCE", "G FORCE GP",
    "INVCT", "INVICTA",
    "RCHRD MLL", "RICHARD MILLE", "RM",
    "TSOT", "TISSOT",
    "RLX", "ROLEX",
    "PATEK",
    "DAYTONA",
    "SUBMARINO",
    "SPORT-G", "SPORT G",
    "TOKYO",
    "YAKARTA",
]);

const KEYWORDS_RELOJ: Set<string> = new Set([
    "RELOJ", "RELOJES", "CRONOGRAFO", "CRONÓGRAFO",
]);

const KEYWORDS_OTROS: Set<string> = new Set([
    "GAFAS", "LENTES", "LENTE",
    "PERFUME", "PERFUMERIA", "PERFUMERÍA", "COLONIA",
    "CAJA", "CAJAS", "ESTUCHE", "ESTUCHES",
    "CORREA", "CORREAS",
    "PULSERA", "PULSERAS",
    "FUNDA", "FUNDAS",
    "ACCESORIO", "ACCESORIOS",
]);

const KEYWORDS_COMBO: Set<string> = new Set([
    "COMBO", "KIT", "PAQUETE", "LOTE",
    "EMPRENDEDOR", "DESPEGUE", "IMPULSO", "DOMINIO",
    "MONEY", "YAKARTA", "RIO", "INICIO INTELIGENTE",
]);

const CANTIDAD_MAXIMA = 50;

function parsearCantidadSegura(valor: string): number {
    const n = parseInt(valor, 10);
    if (isNaN(n) || n <= 0 || n > CANTIDAD_MAXIMA) return 1;
    return n;
}

function esPrecio(valor: string): boolean {
    const numeroStr = valor.replace(/[.,]/g, '');
    const n = parseInt(numeroStr, 10);
    if (isNaN(n)) return false;
    if (n > 999) return true;
    if (/\d000/.test(numeroStr)) return true;
    return false;
}

function extraerCantidad(item: string): { cantidad: number; textoLimpio: string } {
    const t = item.trim();

    const trailingMult = t.match(/^(.+?)\s*[×xX]\s*(\d+)$/);
    if (trailingMult && trailingMult[1] && trailingMult[2]) {
        return { cantidad: parsearCantidadSegura(trailingMult[2]), textoLimpio: trailingMult[1].trim() };
    }

    const leadingMult = t.match(/^(\d+)\s*[×xX]\s*(.+)/);
    if (leadingMult && leadingMult[1] && leadingMult[2]) {
        if (esPrecio(leadingMult[1])) return { cantidad: 1, textoLimpio: t };
        return { cantidad: parsearCantidadSegura(leadingMult[1]), textoLimpio: leadingMult[2].trim() };
    }

    const leadingQty = t.match(/^(\d+)\s+(.+)/);
    if (leadingQty && leadingQty[1] && leadingQty[2]) {
        if (esPrecio(leadingQty[1])) return { cantidad: 1, textoLimpio: t };
        return { cantidad: parsearCantidadSegura(leadingQty[1]), textoLimpio: leadingQty[2].trim() };
    }

    return { cantidad: 1, textoLimpio: t };
}

function contieneMarcaReloj(normalizado: string): boolean {
    const palabras = normalizado.split(/\s+/);

    if (palabras[0] && MARCAS_RELOJ.has(palabras[0])) return true;

    for (let i = 0; i < palabras.length; i++) {
        for (let j = i + 1; j <= Math.min(i + 3, palabras.length); j++) {
            const frase = palabras.slice(i, j).join(' ');
            if (MARCAS_RELOJ.has(frase)) return true;
        }
    }

    return false;
}

function clasificarItem(item: string): { esReloj: boolean; cantidad: number } | null {
    const { cantidad, textoLimpio } = extraerCantidad(item);
    const normalizado = normalizarTexto(textoLimpio);
    const palabras = normalizado.split(/\s+/);

    // Si el item es puro precio sin marca/producto → no es producto
    const itemLimpio = item.trim();
    if (/^\d[\d.,]*$/.test(itemLimpio)) return null;

    const coincideConOtros = palabras.some(p => KEYWORDS_OTROS.has(p));
    if (coincideConOtros) {
        return { esReloj: false, cantidad };
    }

    if (contieneMarcaReloj(normalizado)) {
        return { esReloj: true, cantidad };
    }

    const esCombo = [...KEYWORDS_COMBO].some(kw => normalizado.includes(kw));
    if (esCombo) {
        const matchRelojes = normalizado.match(/(\d+)\s+RELOJ/);
        if (matchRelojes && matchRelojes[1]) {
            return { esReloj: true, cantidad: parseInt(matchRelojes[1], 10) };
        }
        return { esReloj: true, cantidad: 1 };
    }

    const coincideConReloj = palabras.some(p => KEYWORDS_RELOJ.has(p));
    if (coincideConReloj) {
        return { esReloj: true, cantidad };
    }

    return null;
}

export function clasificarProducto(producto: string): { cantidadRelojes: number; cantidadOtros: number } {
    if (!producto || producto.trim() === '' || producto === 'N/A') {
        return { cantidadRelojes: 0, cantidadOtros: 0 };
    }

    const items = producto.split(',').map(i => i.trim()).filter(Boolean);
    let cantidadRelojes = 0;
    let cantidadOtros = 0;

    for (const item of items) {
        const resultado = clasificarItem(item);
        if (!resultado) continue;
        const { esReloj, cantidad } = resultado;
        if (esReloj) {
            cantidadRelojes += cantidad;
        } else {
            cantidadOtros += cantidad;
        }
    }

    return { cantidadRelojes, cantidadOtros };
}

export interface DatosProducto {
    lineasProducto: string[];
    cantidadRelojes: number;
    cantidadOtros: number;
}

export function extraerListaProductos(textoCrudo: string): DatosProducto {
    if (!textoCrudo || textoCrudo.trim() === '') {
        return { lineasProducto: [], cantidadRelojes: 0, cantidadOtros: 0 };
    }

    const lineas = textoCrudo.split('\n').flatMap(linea => linea.split(','));
    const items = lineas.map(i => i.trim()).filter(Boolean);

    let cantidadRelojes = 0;
    let cantidadOtros = 0;
    const lineasProducto: string[] = [];

    for (const item of items) {
        const resultado = clasificarItem(item);
        if (!resultado) continue;
        const { esReloj, cantidad } = resultado;
        if (esReloj) {
            cantidadRelojes += cantidad;
        } else {
            cantidadOtros += cantidad;
        }
        lineasProducto.push(item);
    }

    return { lineasProducto, cantidadRelojes, cantidadOtros };
}
