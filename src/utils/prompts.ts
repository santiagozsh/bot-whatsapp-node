// src/utils/prompts.ts
export const construirPromptContable = (contextoWhatsApp: string, textoOCR: string): string => {
return `Eres un analista contable. Clasifica el siguiente comprobante de pago.

TEXTO EXTRAÍDO DEL COMPROBANTE (OCR):
${textoOCR}

CONTEXTO DE WHATSAPP (mensajes asociados):
${contextoWhatsApp}

PASO 1 - FILTRO: ¿El texto del OCR corresponde a un comprobante de transferencia bancaria (Nequi, Bancolombia, Daviplata, etc.)?
Si NO lo es (caja, reloj, foto sin texto financiero, "SIN_TEXTO_DETECTADO"), responde: {"esComprobanteValido":false} y termina.

PASO 2 - EXTRACCIÓN (solo si es comprobante válido):
- fecha, precioCompra, medioDePago, referenciaDePago, cuentaDestino: extráelos del texto OCR.
- tipo:
  * Cuenta destino es "3143527475", "3224442154" o "3212267474" → "Ingreso"
  * Menciona "YENCI" → "Abono"
  * Cualquier otra cuenta → "Egreso"
- descripcion: 3 o más artículos en el contexto de WhatsApp → "Pedido mayorista", si no → "Pedido al por menor"
- vendedor: busca Evelin, Alejandra o Karol en el contexto. Si no aparece ninguno → "JHON"

Responde ÚNICAMENTE con este JSON exacto:
{"esComprobanteValido":true,"fecha":"DD/MM/YYYY","tipo":"Ingreso","descripcion":"Pedido al por menor","precioCompra":"165000","medioDePago":"Nequi","referenciaDePago":"M11650120","cuentaDestino":"3143527475","vendedor":"JHON"}`;
};
