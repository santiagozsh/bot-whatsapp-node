// src/utils/prompts.ts
export const construirPromptContable = (contextoWhatsApp: string, textoOCR: string, bancoPorColor?: string): string => {
const hintBanco = bancoPorColor
    ? `\nBANCO DETECTADO VISUALMENTE: ${bancoPorColor}. Usa este valor como medioDePago.\n`
    : '';

return `Analista contable. Extrae los datos de una transferencia bancaria a partir del OCR de la imagen del comprobante.
${hintBanco}
OCR (texto extraído de la IMAGEN):
${textoOCR}

DECISIÓN — esComprobanteValido:
- true SOLO si el OCR corresponde a un comprobante real de transferencia (Nequi, Bancolombia, Davivienda o Daviplata) con datos típicos: banco/billetera, valor, referencia y/o cuenta.
- false si el OCR es de otra cosa (foto de producto, caja, reloj, nota, chat) o es ilegible.
- Decide EXCLUSIVAMENTE con el OCR de arriba. El historial de WhatsApp de abajo es solo contexto de la conversación y NUNCA debe influir en esta decisión.

EXTRAER (solo si esComprobanteValido es true):
- fecha: DD/MM/YYYY
- precioCompra: string sin símbolos (ej "165000")
- medioDePago: banco o billetera que EMITE el comprobante. ATENCIÓN: el OCR puede mencionar "Nequi" como texto promocional de otros bancos ("transferencias a Nequi"). Ignora esas menciones y determina quién EMITE realmente el comprobante. Si no puedes determinarlo → "No identificado".
- referenciaDePago: n° de referencia, No.Comprobante, No.Aprob
- cuentaDestino: cuenta destino (10 dígitos)
- descripcion: "Pedido al por menor" por defecto

HISTORIAL DE WHATSAPP (contexto de la conversación — NO es la imagen. Úsalo solo para enriquecer campos, nunca para esComprobanteValido):
${contextoWhatsApp}

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
