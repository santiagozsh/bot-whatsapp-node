/**
 * Tipos compartidos del dominio del bot.
 */

// Extraído por OpenAI Prompt A desde el comprobante bancario
export interface DatosIngreso {
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

// Extraído por OpenAI Prompt B desde el contexto del chat (datos crudos de persona)
export interface DatosClienteCrudos {
    nombreCliente: string;
    email: string;
    telefono: string;
    municipio: string;
    vendedor: string;
}

// Datos completos del cliente: lo de OpenAI + productos extraídos localmente
export interface DatosCliente extends DatosClienteCrudos {
    producto: string;
    cantidadRelojes: number;
    cantidadOtros: number;
}

// Campos opcionales para actualizar una fila de Ingreso (correcciones)
export interface DatosIngresoParcial {
    tipo?: string;
    vendedor?: string;
}

// Producto individual detectado por el parser local
export interface DatosProducto {
    lineasProducto: string[];
    cantidadRelojes: number;
    cantidadOtros: number;
}
