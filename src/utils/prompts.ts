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

export const construirPromptCliente = (bloqueTexto: string): string => {
return `Eres un asistente de ventas. Extrae los datos del cliente a partir del siguiente texto.

TEXTO ACUMULADO:
\${bloqueTexto}

REGLAS:
- Extrae únicamente lo que esté explícito en el texto. NO inventes ni supongas datos.
- Campos de texto no encontrados → "N/A" (exactamente así, en mayúsculas).
- Campos de cantidad no encontrados → 0.
- "telefono": solo dígitos, sin espacios ni guiones. Si no aparece → "N/A".
- "municipio": solo el nombre del municipio, sin el departamento.
- "producto": descripción breve de lo que se vendió (ej. "QyQ", "reloj cronógrafo", "pulsera"). Si no aparece → "N/A".
- "cantidadRelojes": número entero de relojes mencionados. Si no aparece → 0.
- "cantidadOtros": número entero de otros artículos no-relojes mencionados. Si no aparece → 0.
- NO incluyas el departamento, eso se deduce por separado.
- Responde ÚNICAMENTE con el JSON exacto, sin markdown, sin texto adicional.

JSON de respuesta:
{"nombreCliente":"","email":"","telefono":"","municipio":"","producto":"","cantidadRelojes":0,"cantidadOtros":0}`;
};
