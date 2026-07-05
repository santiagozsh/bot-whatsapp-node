// src/utils/prompts.ts
export const construirPromptContable = (contextoWhatsApp: string, textoOCR: string): string => {
return `Analista contable. Extrae datos del comprobante.

OCR:
${textoOCR}

WhatsApp:
${contextoWhatsApp}

FILTRO: Si no es transferencia (Nequi, Bancolombia, Davivienda, Daviplata) → {"esComprobanteValido":false}. Casos: caja, reloj, foto, SIN_TEXTO_DETECTADO.

EXTRAER:
- fecha: DD/MM/YYYY
- precioCompra: string sin símbolos (ej "165000")
- medioDePago: banco del OCR (Nequi, Bancolombia, etc.)
- referenciaDePago: n° de referencia, No.Comprobante, No.Aprob
- cuentaDestino: cuenta destino (10 dígitos)
- descripcion: ""Pedido al por menor" ponlo por defecto"

JSON: {"esComprobanteValido":true,"fecha":"","descripcion":"","precioCompra":"","medioDePago":"","referenciaDePago":"","cuentaDestino":""}`;
};

export const construirPromptCliente = (bloqueTexto: string): string => {
return `Asistente de ventas. Extrae datos del cliente.

TEXTO:
${bloqueTexto}

REGLAS:
- Solo datos explícitos, no inventes. No encontrado → "N/A".
- telefono: solo dígitos.
- municipio: solo nombre, sin departamento.
- nombreCliente: SOLO si hay comprador explícito (ej "nombre: Juan", "cliente: Maria", "pedido de Pedro"). NO confundir "venta Evelin/Alejandra/Karol" (es vendedor, no cliente). Si solo hay "venta X" → "N/A".
- vendedor: "venta" + nombre (Evelin, Alejandra, Aleja, Karol) o "vendedor: nombre". Si no → "N/A".

JSON: {"nombreCliente":"","email":"","telefono":"","municipio":"","vendedor":""}`;
};
