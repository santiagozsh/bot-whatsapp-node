// src/utils/prompts.ts
export const construirPromptContable = (contextoTexto: string): string => {
    return `
        Eres un analista contable experto. Analiza la siguiente imagen y el historial de mensajes de WhatsApp asociado.
        
        HISTORIAL DE MENSAJES (Contexto):
        """
        ${contextoTexto}
        """
        
        REGLA VITAL DE FILTRADO:
        Lo primero que debes hacer es determinar si la imagen es realmente un comprobante de transferencia bancaria/pago (Nequi, Bancolombia, etc.). 
        Si la imagen es una caja de envío, un reloj, texto, o cualquier otra cosa, debes poner "esComprobanteValido": false y dejar el resto vacío.
        
        REGLAS DE NEGOCIO (Solo si es un comprobante válido):
        1. Fecha, Precio de Compra, Medio de Pago, Referencia y Cuenta Destino se extraen de la imagen. 
        2. Tipo: 
           - Cuenta "3143527475", "3224442154" o "3212267474" -> "Ingreso".
           - Mención de "YENCI" -> "Abono".
           - Cualquier otra cuenta -> "Egreso".
        3. Descripción: Si en los textos se mencionan 3 o más artículos -> "Pedido mayorista". Sino -> "Pedido al por menor".
        4. Vendedor: Busca quién hizo la venta (Evelin, Alejandra, Karol). Por defecto es "JHON".
        
        Devuelve estrictamente un JSON con esta estructura exacta:
        {
          "esComprobanteValido": true o false,
          "fecha": "DD/MM/YYYY",
          "tipo": "Ingreso",
          "descripcion": "Pedido al por menor",
          "precioCompra": "165000",
          "medioDePago": "Nequi",
          "referenciaDePago": "M11650120",
          "cuentaDestino": "3143527475",
          "vendedor": "JHON"
        }
    `;
};
