import sharp from 'sharp';
import { logger } from './logger';
import {
    INCOME_ACCOUNTS,
    ADVANCE_ACCOUNTS,
    BODEGA_ACCOUNTS,
    ADVANCE_NAMES,
    KNOWN_VENDORS,
    DEFAULT_VENDOR,
    VENDOR_ALIASES,
} from './config.data';

/**
 * Transforms a date string from "DD/MM/YYYY" format into the business-standard "D-Mes-YYYY" format.
 * 
 * @example
 * formatDate("01/05/2026") // => "1-May-2026"
 * formatDate("15/12/2025") // => "15-Dic-2025"
 * 
 * @param originalDate - Date string in DD/MM/YYYY format.
 * @returns Formatted date string, or original string if pattern does not match.
 */
export const formatDate = (originalDate: string): string => {
    const months = ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"];
    const parts = originalDate.split('/');

  if (parts.length === 3) {
    const day = parseInt(parts[0] || '1', 10);
    const monthIndex = parseInt(parts[1] || '1', 10) - 1;
    const month = months[monthIndex];
    const year = parts[2];
    return `${day}-${month}-${year}`;
  }
  return originalDate;
};

/**
 * Formats a 10-digit Colombian phone or bank account number into spaced segments: "XXX XXX XXXX".
 * 
 * @example
 * formatAccountNumber("3143527475") // => "314 352 7475"
 * 
 * @param originalAccount - Raw account or phone number string.
 * @returns Spaced 10-digit string or original input if length != 10.
 */
export const formatAccountNumber = (originalAccount: string): string => {
  const cleanAccount = originalAccount.replace(/\s+/g, '');
  if (cleanAccount.length === 10) {
    return `${cleanAccount.slice(0, 3)} ${cleanAccount.slice(3, 6)} ${cleanAccount.slice(6)}`;
  }
  return originalAccount;
};

/**
 * Executes an asynchronous task with exponential backoff retries.
 * Retries are triggered exclusively on HTTP 429 (Rate Limit) and HTTP 500+ (Server Errors).
 * Client errors (4xx other than 429) fail immediately without retrying.
 * 
 * Retry delay formula: `delayBaseMs * 2^(attempt)`
 * 
 * @param fn - The asynchronous function to execute.
 * @param maxAttempts - Total number of allowed attempts (default: 4).
 * @param delayBaseMs - Base delay in milliseconds for backoff (default: 1000ms).
 * @returns Result of the resolved asynchronous operation.
 */
export const executeWithRetry = async <T>(
  fn: () => Promise<T>,
  maxAttempts: number = 4,
  delayBaseMs: number = 1000
): Promise<T> => {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error: any) {
      const isLastAttempt = attempt === maxAttempts - 1;
      const statusCode = error?.status || error?.response?.status;
      const isRetryable = statusCode === 429 || (statusCode && statusCode >= 500);

      if (!isRetryable || isLastAttempt) {
        throw error;
      }

      const waitMs = delayBaseMs * Math.pow(2, attempt);
      logger.warn('RETRY', `Attempt ${attempt + 1}/${maxAttempts} failed (${statusCode}). Retrying in ${waitMs / 1000}s...`);
      await new Promise(resolve => setTimeout(resolve, waitMs));
    }
  }
  throw new Error('executeWithRetry: maximum retry attempts exhausted');
};

/**
 * Normalizes a text string by converting to uppercase, stripping accents/diacritics, and trimming whitespace.
 * Used for deterministic city lookups against the Colombian department dictionary.
 * 
 * @example
 * normalizeText("Bogotá") // => "BOGOTA"
 * normalizeText("Medellín") // => "MEDELLIN"
 * 
 * @param text - Input string to normalize.
 * @returns Uppercase ASCII string without diacritics.
 */
export const normalizeText = (text: string): string => {
  return text
    .toUpperCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
};

/**
 * Cleans noisy OCR output text prior to LLM evaluation to eliminate token waste and improve extraction precision.
 * Removes non-printable control characters, normalizes line breaks, collapses excess spaces,
 * and standardizes typographical quotes and dashes.
 * 
 * @param text - Raw OCR text output.
 * @returns Sanitized text string.
 */
export const normalizeOcrText = (text: string): string => {
  if (!text) return text;
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[•·]/g, '-')
    .replace(/[‒–—―]/g, '-')
    .replace(/[\u201C\u201D\u201E\u201F«»]/g, '"')
    .replace(/[\u2018\u2019\u201A\u201B‹›]/g, "'")
    .trim();
};

/**
 * Classifies an incoming transaction as regular revenue ('Ingreso') or an advance payment ('Abono').
 * Matches the destination bank account or receipt text against business configuration rules.
 * 
 * @param destinationAccount - Target bank account string.
 * @param ocrText - Text extracted from the payment receipt.
 * @returns 'Ingreso' or 'Abono'.
 */
export const classifyIncomeType = (
  destinationAccount: string,
  ocrText: string
): 'Ingreso' | 'Abono' => {
  const cleanAccount = destinationAccount.replace(/[\s.\-()]/g, '');
  const lowerOcr = ocrText.toLowerCase();

  if (INCOME_ACCOUNTS.some((acc: string) => cleanAccount.includes(acc))) return 'Ingreso';
  if (ADVANCE_ACCOUNTS.some((acc: string) => cleanAccount.includes(acc))) return 'Abono';
  if (ADVANCE_NAMES.some((name: string) => lowerOcr.includes(name))) return 'Abono';

  return 'Ingreso';
};

/**
 * Normalizes and determines the canonical Colombian payment method.
 * Priority:
 * 1. If target account belongs to warehouse accounts (`BODEGA_ACCOUNTS`) -> 'Nequi bodega'
 * 2. If visual bank color palette was detected -> detected bank
 * 3. Canonical bank name normalization from raw LLM/OCR extraction (`NU`, `BBVA`, `Bancolombia`, `Davivienda`, `Daviplata`, `Nequi`, `Western Union`, `Efectivo`)
 * 
 * @param rawPaymentMethod - Raw string extracted by LLM or OCR.
 * @param destinationAccount - Target bank account string.
 * @param bankByColor - Visual hint from color analysis.
 * @returns Canonical Colombian payment method string.
 */
export const resolvePaymentMethod = (
  rawPaymentMethod?: string,
  destinationAccount?: string,
  bankByColor?: string
): string => {
  const cleanAccount = (destinationAccount || '').replace(/[\s.\-()]/g, '');

  if (BODEGA_ACCOUNTS.some((acc: string) => cleanAccount.includes(acc))) {
    return 'Nequi bodega';
  }

  if (bankByColor && bankByColor !== 'No detectado') {
    return bankByColor;
  }

  const raw = (rawPaymentMethod || '').trim().toLowerCase();
  if (!raw || raw === 'n/a' || raw === 'no identificado' || raw === 'no detectado') {
    return 'No identificado';
  }

  if (raw.includes('nequi bodega') || raw.includes('bodega')) return 'Nequi bodega';
  if (raw.includes('nubank') || raw === 'nu' || raw.startsWith('nu ') || raw.includes('nu c.f.')) return 'NU';
  if (raw.includes('bbva')) return 'BBVA';
  if (raw.includes('bancolombia')) return 'Bancolombia';
  if (raw.includes('daviplata')) return 'Daviplata';
  if (raw.includes('davivienda')) return 'Davivienda';
  if (raw.includes('nequi')) return 'Nequi';
  if (raw.includes('western') || raw.includes('wenstern')) return 'Western Union';
  if (raw.includes('efectivo')) return 'Efectivo';

  return rawPaymentMethod ? rawPaymentMethod.trim() : 'No identificado';
};

const VENDOR_PATTERN = /(?:venta|vendedor|vendido por|asesor(?:a)?)[:\s-]+(\w+)/i;
const SPANISH_STOP_WORDS = new Set([
  'en', 'de', 'del', 'la', 'el', 'que', 'con', 'sin', 'por', 'para',
  'un', 'una', 'los', 'las', 'y', 'o', 'no', 'se', 'su', 'al', 'a',
  'es', 'lo', 'le', 'me', 'te', 'tu', 'mi', 'mas', 'pero', 'como',
  'ya', 'si', 'muy', 'todo', 'hay', 'nos', 'han', 'son', 'fue', 'era'
]);

/**
 * Normalizes a raw vendor input string into a canonical vendor name in strict uppercase.
 * Handles casing, removes operational prefixes (e.g. "venta-", "asesor "), maps
 * diminutives/aliases, preserves unrecognized names in uppercase, and defaults to JHON.
 * 
 * @example
 * normalizeVendor("eve") // => "EVELIN"
 * normalizeVendor("jhoncito") // => "JHON"
 * normalizeVendor("VENTA-KAROL") // => "KAROL"
 * normalizeVendor("carlos") // => "CARLOS"
 * normalizeVendor("") // => "JHON"
 * 
 * @param rawName - Raw vendor text from context, reply, or prompt.
 * @returns Normalized vendor string in uppercase.
 */
export const normalizeVendor = (rawName?: string | null): string => {
  if (!rawName) return DEFAULT_VENDOR;

  let cleaned = rawName.trim();
  if (!cleaned) return DEFAULT_VENDOR;

  // Clean operational prefixes like "venta-", "venta: ", "asesora: ", "vendido por "
  cleaned = cleaned.replace(/^(?:venta|vendedor|asesor(?:a)?|vendido por)[:\s-]+/i, '').trim();

  const lower = cleaned.toLowerCase();

  const invalidPlaceholders = new Set([
    '', 'n/a', 'na', 'no identificado', 'no detectado', 'desconocido', 'ninguno', 'null', 'undefined'
  ]);
  if (invalidPlaceholders.has(lower) || SPANISH_STOP_WORDS.has(lower)) {
    return DEFAULT_VENDOR;
  }

  // 1. Direct canonical match
  const canonicalMatch = KNOWN_VENDORS.find(v => v.toLowerCase() === lower);
  if (canonicalMatch) {
    return canonicalMatch;
  }

  // 2. Direct alias match
  if (VENDOR_ALIASES[lower]) {
    return VENDOR_ALIASES[lower];
  }

  // 3. Substring/prefix alias matching (e.g. "evelin la mejor", "eve la mejor")
  for (const [alias, canonical] of Object.entries(VENDOR_ALIASES)) {
    if (lower === alias || lower.startsWith(alias + ' ') || lower.endsWith(' ' + alias)) {
      return canonical;
    }
  }

  // 4. Fallback: preserve unknown vendor in uppercase
  return cleaned.toUpperCase();
};

/**
 * Extracts the sales vendor name from WhatsApp chat context using regex heuristics.
 * Ignores common Spanish prepositions and stop words, matching against known vendors when possible.
 * Normalizes all outputs to canonical uppercase or preserved uppercase. Defaults to 'JHON'.
 * 
 * @example
 * extractVendor("venta Karol 2 casio") // => "KAROL"
 * extractVendor("vendido por Eve") // => "EVELIN"
 * extractVendor("pago por transferencia") // => "JHON"
 * 
 * @param context - Accumulated WhatsApp text context.
 * @returns Normalized uppercase vendor name.
 */
export const extractVendor = (context: string): string => {
  if (!context || !context.trim()) return DEFAULT_VENDOR;

  const match = context.match(VENDOR_PATTERN);
  if (match && match[1]) {
    const candidate = match[1].trim();
    const candidateLower = candidate.toLowerCase();

    if (SPANISH_STOP_WORDS.has(candidateLower) || candidate.length < 2) {
      return DEFAULT_VENDOR;
    }

    return normalizeVendor(candidate);
  }

  // Check if context as a whole directly resolves to a vendor or alias (e.g. "EVELIN LA MEJOR")
  const trimmed = context.trim();
  const directNormalized = normalizeVendor(trimmed);
  if (directNormalized !== trimmed.toUpperCase() || KNOWN_VENDORS.includes(directNormalized as any)) {
    return directNormalized;
  }

  // Check if any canonical vendor is present as a standalone word
  for (const vendor of KNOWN_VENDORS) {
    const regex = new RegExp(`\\b${vendor}\\b`, 'i');
    if (regex.test(context)) {
      return vendor;
    }
  }

  // Check if any alias is present as a standalone phrase
  for (const [alias, canonical] of Object.entries(VENDOR_ALIASES)) {
    const regex = new RegExp(`\\b${alias}\\b`, 'i');
    if (regex.test(context)) {
      return canonical;
    }
  }

  return DEFAULT_VENDOR;
};

const MIN_USEFUL_CHARS = 8;
const MAX_SHORT_TOKEN_RATIO = 0.55;

/**
 * Evaluates whether an OCR text payload contains meaningful content or is pure visual noise/garbage.
 * Rejects payloads that are too short or dominated by 1-2 character fragment tokens.
 * 
 * @param text - OCR output text.
 * @returns True if text contains viable customer/order data, false otherwise.
 */
export const isUsefulText = (text: string): boolean => {
  if (!text || text === 'SIN_TEXTO_DETECTADO') return false;

  const trimmed = text.trim();
  if (trimmed.length < MIN_USEFUL_CHARS) return false;

  const tokens = trimmed
    .split(/\s+/)
    .map(t => t.replace(/^[^\wáéíóúüñÁÉÍÓÚÜÑ]+|[^\wáéíóúüñÁÉÍÓÚÜÑ]+$/g, ''))
    .filter(t => t.length > 0);

  if (tokens.length === 0) return false;

  const shortTokensCount = tokens.filter(t => t.length <= 2).length;
  const shortTokenRatio = shortTokensCount / tokens.length;

  if (shortTokenRatio > MAX_SHORT_TOKEN_RATIO) return false;

  return true;
};

/**
 * Analyzes the dominant color palette of a receipt image to detect the issuing Colombian bank.
 * Acts as a fast, zero-token visual heuristic:
 * - Yellow + Black => Bancolombia
 * - Magenta / Purple => Nequi
 * - Red + White => Davivienda
 * - Red => Daviplata
 * 
 * @param imageBase64 - Base64-encoded image string.
 * @returns Detected bank name or undefined if unrecognized.
 */
export const detectBankByColor = async (imageBase64: string): Promise<string | undefined> => {
  try {
    const buffer = Buffer.from(imageBase64, 'base64');
    const { data, info } = await sharp(buffer)
      .resize(200, 200, { fit: 'inside' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const totalPixels = info.width * info.height;
    let white = 0, black = 0, yellow = 0, pink = 0, red = 0;

    for (let i = 0; i < data.length; i += 4) {
      const r = data[i]!;
      const g = data[i + 1]!;
      const b = data[i + 2]!;

      if (r > 220 && g > 220 && b > 220) { white++; continue; }
      if (r < 60 && g < 60 && b < 60) { black++; continue; }
      if (r > 170 && g > 140 && b < 110 && (r - b) > 80) { yellow++; continue; }
      if (r > 130 && b > 120 && (r - g) > 20 && (b - g) > 20 && g < 170) { pink++; continue; }
      if (r > 180 && g < 100 && b < 100 && (r - g) > 80) { red++; continue; }
    }

    const pct = (count: number) => ((count / totalPixels) * 100);

    logger.debug('COLOR', `white=${pct(white).toFixed(1)}% black=${pct(black).toFixed(1)}% yellow=${pct(yellow).toFixed(1)}% pink=${pct(pink).toFixed(1)}% red=${pct(red).toFixed(1)}%`);

    if (yellow / totalPixels > 0.02 && black / totalPixels > 0.02) return 'Bancolombia';
    if (pink / totalPixels > 0.04) return 'Nequi';
    if (red / totalPixels > 0.05 && white / totalPixels > 0.25) return 'Davivienda';
    if (red / totalPixels > 0.03) return 'Daviplata';

    return undefined;
  } catch (error) {
    logger.error('COLOR', 'Error detectando banco por color:', error);
    return undefined;
  }
};

// ── Cash-on-Delivery (COD) Helpers ──────────────────────────

export interface CodCollectionData {
  amount: string;
  medioDePago: string;
  vendedor: string;
}

const COD_KEYWORD_PATTERN = /\b(?:contraentrega|contraentregas|contra\s+entrega|contras)\b/i;
const COD_DISCARD_PATTERN = /[?¿]|\b(?:cuanto\s+falta|faltan?|pendiente|va\s+a\s+pagar|por\s+pagar|enviar\s+contraentrega|guia)\b/i;
const COD_RECEIPT_VERB_PATTERN = /\b(?:recibi|recibo|recolecte|entregaron|cobre|pago|pagaron|liquide|efectivo|de\s+contras|de\s+contraentrega)\b/i;

/**
 * Strips diacritics and converts string to lowercase for resilient regex boundary matching.
 */
function stripDiacritics(str: string): string {
  return str.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Parses and extracts cash-on-delivery (COD) collection reports from plain text messages.
 * Detects amounts in any position while rejecting non-collection intents, shipping inquiries, and questions.
 * Disambiguates monetary amounts from Colombian 10-digit phone numbers.
 * 
 * @param text - Raw message string.
 * @returns Parsed COD collection details or null if not a valid COD cash inflow.
 */
export const parseCodCollectionMessage = (text: string): CodCollectionData | null => {
  if (!text || typeof text !== 'string') return null;

  const trimmed = text.trim();
  if (!trimmed) return null;

  const normalized = stripDiacritics(trimmed);

  // 1. Must match COD keywords
  if (!COD_KEYWORD_PATTERN.test(normalized)) return null;

  // 2. Reject questions or non-inflow contexts
  if (COD_DISCARD_PATTERN.test(normalized)) return null;

  // 3. Must have an indication of collection / cash received
  if (!COD_RECEIPT_VERB_PATTERN.test(normalized)) return null;

  // 4. Extract monetary amount candidates:
  // Match formatted amounts (e.g. 242.000, 1'500.000, $80.000) or plain numbers (e.g. 95000)
  const amountPattern = /(?:\$?\s*)((?:[1-9]\d{0,2}(?:[.'’]\d{3})+)|(?:[1-9]\d{4,8}))\b/g;
  const matches = [...trimmed.matchAll(amountPattern)];

  const validAmounts: { amountStr: string; cleanDigits: string; index: number }[] = [];

  for (const match of matches) {
    const rawMatch = match[1];
    if (!rawMatch) continue;

    const clean = rawMatch.replace(/[.'’,\s$]/g, '');

    // Disambiguate against 10-digit Colombian phone numbers starting with 3
    if (clean.length === 10 && clean.startsWith('3')) {
      continue;
    }

    const num = parseInt(clean, 10);
    // Typical COD order collection range in COP ($10,000 to $50,000,000)
    if (num >= 10000 && num <= 50000000) {
      validAmounts.push({
        amountStr: rawMatch,
        cleanDigits: clean,
        index: match.index ?? 0,
      });
    }
  }

  if (validAmounts.length === 0) return null;

  // In case of multiple numbers, pick the one closest to a collection keyword
  let chosenAmount = validAmounts[0]!;
  if (validAmounts.length > 1) {
    const verbMatch = normalized.match(COD_RECEIPT_VERB_PATTERN);
    if (verbMatch && verbMatch.index !== undefined) {
      const verbIdx = verbMatch.index;
      chosenAmount = validAmounts.reduce((prev, curr) =>
        Math.abs(curr.index - verbIdx) < Math.abs(prev.index - verbIdx) ? curr : prev
      );
    }
  }

  // 5. Determine payment method (defaults to 'Efectivo' unless explicit channel detected)
  let medioDePago = 'Efectivo';
  if (/\bnequi\b/i.test(normalized)) medioDePago = 'Nequi';
  else if (/\bbancolombia\b/i.test(normalized)) medioDePago = 'Bancolombia';
  else if (/\bdaviplata\b/i.test(normalized)) medioDePago = 'Daviplata';
  else if (/\bdavivienda\b/i.test(normalized)) medioDePago = 'Davivienda';
  else if (/\b(?:nu|nubank)\b/i.test(normalized)) medioDePago = 'NU';
  else if (/\bbbva\b/i.test(normalized)) medioDePago = 'BBVA';
  else if (/\bwestern(?:\s+union)?\b/i.test(normalized)) medioDePago = 'Western Union';

  // 6. Extract vendor or default to 'JHON'
  const vendedor = extractVendor(trimmed);

  return {
    amount: chosenAmount.cleanDigits,
    medioDePago,
    vendedor,
  };
};

const COD_CLARIFICATION_PATTERN = /^(?:es|pago(?:\s+en)?|va)?\s*(?:contraentrega|contraentregas|contra\s+entrega|contras)$/i;

/**
 * Determines whether a message specifies that an existing order is dispatched cash-on-delivery.
 * Validates that the message is a pure clarification rather than a new cash collection report.
 * 
 * @param text - Raw message text.
 * @returns True if the message indicates COD order modality without cash collection amount.
 */
export const isCodClarification = (text: string): boolean => {
  if (!text || typeof text !== 'string') return false;
  const trimmed = text.trim();
  if (!trimmed) return false;

  // If it is a full collection message with amount, it is not a pure clarification
  if (parseCodCollectionMessage(trimmed) !== null) {
    return false;
  }

  const normalized = stripDiacritics(trimmed);

  if (COD_CLARIFICATION_PATTERN.test(normalized)) {
    return true;
  }

  // Also support phrases like "pago contraentrega" or "es contraentrega" inside short sentences (< 40 chars)
  if (normalized.length <= 40 && /\b(?:es\s+contraentrega|pago\s+contraentrega|va\s+contraentrega|pago\s+en\s+contraentrega)\b/i.test(normalized)) {
    return true;
  }

  return false;
};

export const WHOLESALE_QUANTITY_THRESHOLD = 3;
export const WHOLESALE_PRICE_THRESHOLD = 250000;

/**
 * Classifies an order description as wholesale ("Pedido mayorista") or retail ("Pedido al por menor").
 * Evaluates whether total units >= 3 OR price > $250,000 COP.
 * Exactly $250,000 COP with < 3 units classifies as "Pedido al por menor".
 * 
 * @param price - Raw price string or numeric price integer.
 * @param totalUnits - Optional total units count (watches + accessories).
 * @returns 'Pedido mayorista' | 'Pedido al por menor'
 */
export const classifyOrderDescription = (
  price: number | string,
  totalUnits: number = 0
): 'Pedido mayorista' | 'Pedido al por menor' => {
  const numericPrice = typeof price === 'number'
    ? price
    : parseInt(String(price).replace(/[^0-9]/g, ''), 10) || 0;

  if (totalUnits >= WHOLESALE_QUANTITY_THRESHOLD || numericPrice > WHOLESALE_PRICE_THRESHOLD) {
    return 'Pedido mayorista';
  }

  return 'Pedido al por menor';
};

