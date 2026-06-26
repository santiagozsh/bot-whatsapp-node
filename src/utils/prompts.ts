// src/utils/prompts.ts
export const construirPromptContable = (contextoWhatsApp: string, textoOCR: string): string => {
return `Eres un analista contable. Clasifica el siguiente comprobante de pago.

TEXTO EXTRAÍDO DEL COMPROBANTE (OCR):
${textoOCR}

CONTEXTO DE WHATSAPP (mensajes asociados):
${contextoWhatsApp}

PASO 1 - FILTRO: ¿El texto del OCR corresponde a un comprobante de transferencia bancaria (Nequi, Bancolombia, Davivienda, Daviplata, etc.)?
Si NO lo es (caja, reloj, foto sin texto financiero, "SIN_TEXTO_DETECTADO"), responde: {"esComprobanteValido":false} y termina.

PASO 2 - EXTRACCIÓN (solo si es comprobante válido):
- fecha, precioCompra, referenciaDePago, cuentaDestino: extráelos del texto OCR.
- medioDePago: IDENTIFICA el banco o entidad exacto desde el texto OCR. NO asumas "Nequi" por defecto. El texto normalmente dice "Bancolombia", "Davivienda", "Daviplata", "Nequi", etc. Si el texto menciona un banco específico, USA ESE. Solo usa "Nequi" si el texto realmente dice Nequi.
- tipo:
  * Cuenta destino es "3143527475", "3224442154" o "3212267474" → "Ingreso"
  * La cuenta destino, el nombre del destinatario, o el texto menciona o coincide con alguna de estas → "Abono":
    - "YENCI" o "YENNY"
    - "YAZMIN" o "RAMIREZ"
    - "3106131751" o "310 613 1751" o "3103455869" o "310 345 5869"
    - "03759053996" o "037-590539-96" (cuenta Bancolombia)
  * Si es "Abono" → medioDePago debe ser "Nequi bodega"
  * Cualquier otra cuenta → "Egreso"
- descripcion: 3 o más artículos en el contexto de WhatsApp → "Pedido mayorista", si no → "Pedido al por menor"
- vendedor: busca Evelin, Alejandra o Karol en el contexto. Si no aparece ninguno → "JHON"

Responde ÚNICAMENTE con este JSON exacto:
{"esComprobanteValido":true,"fecha":"DD/MM/YYYY","tipo":"Ingreso","descripcion":"Pedido al por menor","precioCompra":"165000","medioDePago":"Nequi","referenciaDePago":"M11650120","cuentaDestino":"3143527475","vendedor":"JHON"}`;
};

export const construirPromptCliente = (bloqueTexto: string): string => {
return `Eres un asistente de ventas. Extrae los datos del cliente a partir del siguiente texto.

TEXTO ACUMULADO:
${bloqueTexto}

REGLAS:
- Extrae únicamente lo que esté explícito en el texto. NO inventes ni supongas datos.
- Campos de texto no encontrados → "N/A" (exactamente así, en mayúsculas).
- Campos de cantidad no encontrados → 0.
- "telefono": solo dígitos, sin espacios ni guiones. Si no aparece → "N/A".
- "municipio": solo el nombre del municipio, sin el departamento.
- "producto": lista COMPLETA de todos los productos/artículos encontrados en el texto, exactamente como aparecen, separados por comas. Ejemplo: "RM 60.000, Patek 60.000, Gforce 135.000, 5 Cajas de lujo 55.000, Envío 18.000". NO resumas ni combines. Si no aparece ningún producto → "N/A".
- NO incluyas el departamento, eso se deduce por separado.
- Responde ÚNICAMENTE con el JSON exacto, sin markdown, sin texto adicional.

JSON de respuesta:
{"nombreCliente":"","email":"","telefono":"","municipio":"","producto":""}`;
};
