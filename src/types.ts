/**
 * Shared domain types and interfaces for the Luxury Gotti WhatsApp accounting automation bot.
 */

/**
 * Raw OCR fields extracted by OpenAI Prompt A from bank receipt text (all optional).
 */
export interface RawOcrData {
    esComprobanteValido?: boolean;
    fecha?: string;
    descripcion?: string;
    precioCompra?: string;
    medioDePago?: string;
    referenciaDePago?: string;
    cuentaDestino?: string;
}

// Backward-compatible alias
export type DatosOCRBrutos = RawOcrData;

/**
 * Validated and enriched income transaction data ready for Google Sheets `Ingresos transacciones` insertion.
 */
export interface IncomeData {
    esComprobanteValido: boolean;
    fecha: string;
    tipo: string;
    descripcion: string;
    precioCompra: string;
    medioDePago: string;
    referenciaDePago: string;
    cuentaDestino: string;
    vendedor: string;
}

// Backward-compatible alias
export type DatosIngreso = IncomeData;

/**
 * Raw customer and vendor information extracted by OpenAI Prompt B from conversational text.
 */
export interface RawCustomerData {
    nombreCliente: string;
    email: string;
    telefono: string;
    municipio: string;
    vendedor: string;
}

// Backward-compatible alias
export type DatosClienteCrudos = RawCustomerData;

/**
 * Unified customer order record combining Prompt B contact details with local deterministic product quantities.
 */
export interface CustomerData extends RawCustomerData {
    producto: string;
    cantidadRelojes: number;
    cantidadOtros: number;
}

// Backward-compatible alias
export type DatosCliente = CustomerData;

/**
 * Partial income fields for direct corrections (e.g. via WhatsApp reply).
 */
export interface PartialIncomeData {
    tipo?: string;
    vendedor?: string;
    descripcion?: string;
}

// Backward-compatible alias
export type DatosIngresoParcial = PartialIncomeData;

/**
 * Structured product counts and item lines parsed by the local product parser.
 */
export interface ProductData {
    lineasProducto: string[];
    cantidadRelojes: number;
    cantidadOtros: number;
}

// Backward-compatible alias
export type DatosProducto = ProductData;
