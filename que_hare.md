# Plan — Bloque 10: Respuestas del bot en Sandbox

## Archivos afectados

1. `src/services/whatsapp.service.ts`
2. `src/controllers/message.controller.ts`

## Cambios

### `whatsapp.service.ts`
- Agregar función `enviarMensaje(chat, texto)` que:
  - Solo envía si `chat.name === 'Contabilidad'` (sandbox)
  - En producción (grupo con pipe en el nombre) no hace nada

### `message.controller.ts`
- Importar `enviarMensaje` y `obtenerDepartamento`
- Cambiar `iniciarCronometro(chatId, chatName)` → `iniciarCronometro(chatId, chat)` para tener el objeto chat en el closure
- Agregar confirms en el cronometro:
  - `✅ LG-26 | $165.000 Nequi | Karol` por cada comprobante válido
  - `👤 LG-26 | Mateo Bedoya | Armenia, Quindío` si se escribió Ventas
  - `⚠️ Imagen no reconocida como comprobante` si no es válido
- Agregar `🔄 LG-26 actualizado` en los dos sitios donde se llama `procesarReplyTardio` cuando es merge

## Verificación
```bash
npx tsc --noEmit
```
