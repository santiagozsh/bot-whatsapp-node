import { normalizeText } from './helpers';
import type { DatosProducto } from '../types';

/**
 * Known watch brands and abbreviations sold by Luxury Gotti (replicas and originals).
 */
const WATCH_BRANDS: Set<string> = new Set([
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

/**
 * Generic watch keywords indicating a watch item.
 */
const WATCH_KEYWORDS: Set<string> = new Set([
    "RELOJ", "RELOJES", "CRONOGRAFO", "CRONÓGRAFO",
]);

/**
 * Accessories and non-watch product categories.
 */
const ACCESSORY_KEYWORDS: Set<string> = new Set([
    "GAFAS", "LENTES", "LENTE",
    "PERFUME", "PERFUMERIA", "PERFUMERÍA", "COLONIA",
    "CAJA", "CAJAS", "ESTUCHE", "ESTUCHES",
    "CORREA", "CORREAS",
    "PULSERA", "PULSERAS",
    "FUNDA", "FUNDAS",
    "ACCESORIO", "ACCESORIOS",
]);

/**
 * Bundle / promotional kit package keywords.
 */
const COMBO_KEYWORDS: Set<string> = new Set([
    "COMBO", "KIT", "PAQUETE", "LOTE",
    "EMPRENDEDOR", "DESPEGUE", "IMPULSO", "DOMINIO",
    "MONEY", "YAKARTA", "RIO", "INICIO INTELIGENTE",
]);

const MAX_SAFE_QUANTITY = 50;

/**
 * Parses an integer safely, enforcing upper and lower bounds.
 */
function parseSafeQuantity(value: string): number {
    const n = parseInt(value, 10);
    if (isNaN(n) || n <= 0 || n > MAX_SAFE_QUANTITY) return 1;
    return n;
}

const QUANTITY_UNIT_KEYWORDS: Set<string> = new Set([
    'UNDS', 'UND', 'UNIDADES',
    'CAJAS', 'CAJA',
    'RELOJES', 'RELOJ',
    'CORREAS', 'CORREA',
    'PULSERAS', 'PULSERA',
    'FUNDAS', 'FUNDA',
    'GAFAS', 'LENTES', 'LENTE',
    'PERFUMES', 'PERFUME', 'COLONIAS', 'COLONIA',
    'ESTUCHES', 'ESTUCHE',
    'ACCESORIOS', 'ACCESORIO',
]);

/**
 * Distinguishes whether a numeric prefix is a product price (e.g. 150000) rather than a quantity.
 */
function isPrice(value: string, nextWord?: string): boolean {
    const numStr = value.replace(/[.,]/g, '');
    const n = parseInt(numStr, 10);
    if (isNaN(n)) return false;
    if (n > 999) return true;
    if (nextWord && QUANTITY_UNIT_KEYWORDS.has(nextWord.toUpperCase())) return false;
    if (/\d000/.test(numStr) && n >= 1000) return true;
    return false;
}

/**
 * Extracts multiplier quantities from item strings (e.g., "CASIO x2", "2x TISSOT", "3 GAFAS").
 */
function extractQuantity(item: string): { quantity: number; cleanText: string } {
    const trimmed = item.trim();

    // Trailing multiplier: "CASIO x2", "ROLEX × 3"
    const trailingMult = trimmed.match(/^(.+?)\s*[×xX]\s*(\d+)$/);
    if (trailingMult && trailingMult[1] && trailingMult[2]) {
        return { quantity: parseSafeQuantity(trailingMult[2]), cleanText: trailingMult[1].trim() };
    }

    // Leading multiplier: "2x TISSOT"
    const leadingMult = trimmed.match(/^(\d+)\s*[×xX]\s*(.+)/);
    if (leadingMult && leadingMult[1] && leadingMult[2]) {
        const nextWord = leadingMult[2].trim().split(/\s+/)[0];
        if (isPrice(leadingMult[1], nextWord)) return { quantity: 1, cleanText: trimmed };
        return { quantity: parseSafeQuantity(leadingMult[1]), cleanText: leadingMult[2].trim() };
    }

    // Leading quantity: "2 CASIO"
    const leadingQty = trimmed.match(/^(\d+)\s+(.+)/);
    if (leadingQty && leadingQty[1] && leadingQty[2]) {
        const nextWord = leadingQty[2].trim().split(/\s+/)[0];
        if (isPrice(leadingQty[1], nextWord)) return { quantity: 1, cleanText: trimmed };
        return { quantity: parseSafeQuantity(leadingQty[1]), cleanText: leadingQty[2].trim() };
    }

    return { quantity: 1, cleanText: trimmed };
}

/**
 * Checks if a normalized string contains a known watch brand (single or multi-word).
 */
function containsWatchBrand(normalized: string): boolean {
    const words = normalized.split(/\s+/);

    if (words[0] && WATCH_BRANDS.has(words[0])) return true;

    for (let i = 0; i < words.length; i++) {
        for (let j = i + 1; j <= Math.min(i + 3, words.length); j++) {
            const phrase = words.slice(i, j).join(' ');
            if (WATCH_BRANDS.has(phrase)) return true;
        }
    }

    return false;
}

/**
 * Classifies an individual line item into a Watch vs Accessory category with its parsed quantity.
 */
function classifyItem(item: string): { isWatch: boolean; quantity: number } | null {
    const { quantity, cleanText } = extractQuantity(item);
    const normalized = normalizeText(cleanText);
    const words = normalized.split(/\s+/);

    const cleanItem = item.trim();
    if (/^\d[\d.,]*$/.test(cleanItem)) return null;

    const matchesAccessories = words.some(p => ACCESSORY_KEYWORDS.has(p));
    if (matchesAccessories) {
        return { isWatch: false, quantity };
    }

    if (containsWatchBrand(normalized)) {
        return { isWatch: true, quantity };
    }

    const isCombo = [...COMBO_KEYWORDS].some(kw => normalized.includes(kw));
    if (isCombo) {
        const watchMatch = normalized.match(/(\d+)\s+RELOJ/);
        if (watchMatch && watchMatch[1]) {
            return { isWatch: true, quantity: parseInt(watchMatch[1], 10) };
        }
        return { isWatch: true, quantity: 1 };
    }

    const matchesWatchKeywords = words.some(p => WATCH_KEYWORDS.has(p));
    if (matchesWatchKeywords) {
        return { isWatch: true, quantity };
    }

    return null;
}

/**
 * Parses raw unstructured conversational text into structured product lines,
 * splitting counts between watches and other accessories.
 * 
 * @example
 * parseProductList("CASIO retro x2, 1 PERFUME 100ml")
 * // => { lineasProducto: ["CASIO retro x2", "1 PERFUME 100ml"], cantidadRelojes: 2, cantidadOtros: 1 }
 * 
 * @param rawText - Unstructured order text from WhatsApp.
 * @returns Structured product line items and categorized unit counts.
 */
export function parseProductList(rawText: string): DatosProducto {
    if (!rawText || rawText.trim() === '') {
        return { lineasProducto: [], cantidadRelojes: 0, cantidadOtros: 0 };
    }

    const lines = rawText.split('\n').flatMap(line => line.split(','));
    const items = lines.map(i => i.trim()).filter(Boolean);

    let cantidadRelojes = 0;
    let cantidadOtros = 0;
    const lineasProducto: string[] = [];

    for (const item of items) {
        const result = classifyItem(item);
        if (!result) continue;
        const { isWatch, quantity } = result;
        if (isWatch) {
            cantidadRelojes += quantity;
        } else {
            cantidadOtros += quantity;
        }
        lineasProducto.push(item);
    }

    return { lineasProducto, cantidadRelojes, cantidadOtros };
}
