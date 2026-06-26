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

function extraerCantidad(item: string): { cantidad: number; textoLimpio: string } {
    const t = item.trim();

    const trailingMult = t.match(/^(.+?)\s*[×xX]\s*(\d+)$/);
    if (trailingMult && trailingMult[1] && trailingMult[2]) {
        return { cantidad: parseInt(trailingMult[2], 10), textoLimpio: trailingMult[1].trim() };
    }

    const leadingMult = t.match(/^(\d+)\s*[×xX]\s*(.+)/);
    if (leadingMult && leadingMult[1] && leadingMult[2]) {
        return { cantidad: parseInt(leadingMult[1], 10), textoLimpio: leadingMult[2].trim() };
    }

    const leadingQty = t.match(/^(\d+)\s+(.+)/);
    if (leadingQty && leadingQty[1] && leadingQty[2]) {
        return { cantidad: parseInt(leadingQty[1], 10), textoLimpio: leadingQty[2].trim() };
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

function clasificarItem(item: string): { esReloj: boolean; cantidad: number } {
    const { cantidad, textoLimpio } = extraerCantidad(item);
    const normalizado = normalizarTexto(textoLimpio);
    const palabras = normalizado.split(/\s+/);

    const coincideConOtros = palabras.some(p => KEYWORDS_OTROS.has(p));
    if (coincideConOtros) {
        return { esReloj: false, cantidad };
    }

    if (contieneMarcaReloj(normalizado)) {
        return { esReloj: true, cantidad };
    }

    const coincideConReloj = palabras.some(p => KEYWORDS_RELOJ.has(p));
    if (coincideConReloj) {
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

    return { esReloj: false, cantidad };
}

export function clasificarProducto(producto: string): { cantidadRelojes: number; cantidadOtros: number } {
    if (!producto || producto.trim() === '' || producto === 'N/A') {
        return { cantidadRelojes: 0, cantidadOtros: 0 };
    }

    const items = producto.split(',').map(i => i.trim()).filter(Boolean);
    let cantidadRelojes = 0;
    let cantidadOtros = 0;

    for (const item of items) {
        const { esReloj, cantidad } = clasificarItem(item);
        if (esReloj) {
            cantidadRelojes += cantidad;
        } else {
            cantidadOtros += cantidad;
        }
    }

    return { cantidadRelojes, cantidadOtros };
}
