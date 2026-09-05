/**
 * Builds the accounting analysis prompt (Prompt A) sent to OpenAI.
 * Uses concise English system instructions to minimize token usage while retaining
 * exact Colombian banking domain keywords in Spanish for extraction accuracy.
 * 
 * @param whatsappContext - Text conversation history accumulated between receipts.
 * @param ocrText - Text extracted from the receipt image via Tesseract / TrOCR.
 * @param bankByColor - Visual bank hint derived from image color palette analysis.
 * @returns Complete prompt string ready for OpenAI chat completion.
 */
export const buildAccountingPrompt = (
    whatsappContext: string,
    ocrText: string,
    bankByColor?: string
): string => {
    const bankHint = bankByColor
        ? `\nVISUALLY DETECTED BANK: ${bankByColor}. Use this value for medioDePago.\n`
        : '';

    return `Accounting Analyst. Extract bank transfer payment data from receipt OCR text.
${bankHint}
OCR (text from RECEIPT IMAGE):
${ocrText}

DECISION — esComprobanteValido:
- true ONLY if OCR is a genuine Colombian bank transfer receipt (Nequi, Bancolombia, Davivienda, Daviplata, Nu, BBVA, Western Union) containing: bank/wallet, amount, reference number, or account.
- false if OCR is a product photo, watch, box, paper note, or unreadable chat.
- Base your decision EXCLUSIVELY on the OCR text above. The WhatsApp conversation context below must NEVER influence this decision.

EXTRACTION (only if esComprobanteValido is true):
- fecha: DD/MM/YYYY
- precioCompra: numeric string without symbols (e.g. "165000")
- medioDePago: Bank or wallet that ISSUED the receipt (Nequi, Bancolombia, Davivienda, Daviplata, NU, BBVA, Western Union, etc.). Note: OCR may contain promotional text like "transferencias a Nequi" from other banks. Determine who actually ISSUED it. If unknown -> "No identificado".
- referenciaDePago: Reference number, No.Comprobante, No.Aprob
- cuentaDestino: 10-digit destination account number
- descripcion: "Pedido al por menor" by default

WHATSAPP CONVERSATION CONTEXT (Use only to enrich missing fields, never for esComprobanteValido):
${whatsappContext}

JSON: {"esComprobanteValido":true,"fecha":"","descripcion":"","precioCompra":"","medioDePago":"","referenciaDePago":"","cuentaDestino":""}`;
};

// Backward-compatible alias
export const construirPromptContable = buildAccountingPrompt;

/**
 * Builds the customer details extraction prompt (Prompt B) sent to OpenAI.
 * Uses concise English instructions to extract shipping and buyer information.
 * 
 * @param textBlock - Accumulated WhatsApp message context.
 * @returns Complete prompt string ready for OpenAI chat completion.
 */
export const buildCustomerPrompt = (textBlock: string): string => {
    return `Sales Assistant. Extract customer shipping and vendor data from chat text.

TEXT:
${textBlock}

RULES:
- Only extract explicit data, do not hallucinate. If not found -> "N/A".
- telefono: digits only.
- municipio: city/municipality name only, without department.
- nombreCliente: ONLY if there is an explicit buyer (e.g. "nombre: Juan", "cliente: Maria", "pedido de Pedro"). DO NOT confuse with "venta Jhon/Evelin/Karol/David" (vendor, not customer). If only "venta X" -> "N/A".
- vendedor: "venta" + name (Jhon, Evelin, Karol, David) or "vendedor: name". Otherwise -> "N/A".

JSON: {"nombreCliente":"","email":"","telefono":"","municipio":"","vendedor":""}`;
};

// Backward-compatible alias
export const construirPromptCliente = buildCustomerPrompt;
