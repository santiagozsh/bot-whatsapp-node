// src/utils/prompts.ts
export const construirPromptContable = (contextoWhatsApp: string, textoOCR: string): string => {
return `Eres un analista contable. Extrae los datos del siguiente comprobante de pago.

TEXTO EXTRAÍDO DEL COMPROBANTE (OCR):
${textoOCR}

CONTEXTO DE WHATSAPP (mensajes asociados):
${contextoWhatsApp}

PASO 1 - FILTRO: ¿El texto del OCR corresponde a un comprobante de transferencia bancaria (Nequi, Bancolombia, Davivienda, Daviplata, etc.)?
Si NO lo es (caja, reloj, foto sin texto financiero, "SIN_TEXTO_DETECTADO"), responde: {"esComprobanteValido":false} y termina.

PASO 2 - EXTRACCIÓN (solo si es comprobante válido):
- fecha: extrae la fecha del comprobante en formato DD/MM/YYYY.
- precioCompra: monto de la transacción como string (ej. "165000"), sin símbolos ni separadores de miles.
- medioDePago: IDENTIFICA el banco o entidad exacto desde el texto OCR: "Nequi", "Bancolombia", "Davivienda", "Daviplata", etc. Usa el nombre que aparezca en el comprobante.
- referenciaDePago: número de referencia, comprobante o transacción.
- cuentaDestino: número de cuenta a la que se envió el pago (10 dígitos normalmente).
- descripcion: si en el contexto de WhatsApp aparecen 3 o más artículos → "Pedido mayorista", si no → "Pedido al por menor".

Responde ÚNICAMENTE con este JSON exacto:
{"esComprobanteValido":true,"fecha":"DD/MM/YYYY","descripcion":"Pedido al por menor","precioCompra":"165000","medioDePago":"Nequi","referenciaDePago":"M11650120","cuentaDestino":"3143527475"}`;
};

export const construirPromptCliente = (bloqueTexto: string): string => {
return `Eres un asistente de ventas. Extrae los datos del cliente a partir del siguiente texto.

TEXTO ACUMULADO:
${bloqueTexto}

REGLAS:
- Extrae únicamente lo que esté explícito en el texto. NO inventes ni supongas datos.
- Campos de texto no encontrados → "N/A" (exactamente así, en mayúsculas).
- "telefono": solo dígitos, sin espacios ni guiones. Si no aparece → "N/A".
- "municipio": solo el nombre del municipio, sin el departamento.
- "nombreCliente": SOLO si el texto menciona explícitamente el nombre de un comprador/cliente (ej. "nombre: Juan", "cliente: Maria", "pedido de Pedro"). NO confundas "venta Evelin", "venta Alejandra", "venta Karol" con nombre de cliente — esas frases indican quién vendió, no quién compró. Si solo aparece "venta X" sin datos de comprador → "N/A".
- "vendedor": busca en el texto si se menciona "venta" seguido de un nombre (Evelin, Alejandra, Aleja, Karol) o si aparece explícitamente "vendedor: nombre". Si no se encuentra → "N/A".
- NO incluyas el departamento, eso se deduce por separado.
- Responde ÚNICAMENTE con el JSON exacto, sin markdown, sin texto adicional.

JSON de respuesta:
{"nombreCliente":"","email":"","telefono":"","municipio":"","vendedor":""}`;
};
