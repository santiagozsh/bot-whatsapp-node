# 0001 — Migrar de whatsapp-web.js a @whiskeysockets/baileys

**Status:** accepted

**Context:** whatsapp-web.js 1.34.7 (Puppeteer) falla permanentemente al obtener datos de chat para
remitentes cuyo ID contiene `@lid` (formato introducido por WhatsApp en 2025). El error
`ExecutionContext.#evaluate` → `r: r` en `getChat()` / `getChats()` / `getChatById()` no es
transitorio — ocurre siempre, para todo contacto con ID `@lid`, sin excepción conocida.

**Decisión:** migrar la capa de conexión WhatsApp de `whatsapp-web.js` (Puppeteer) a
`@whiskeysockets/baileys` (WebSocket nativo).

**Consecuencias:**
- La conexión deja de depender de Puppeteer (headless Chrome), eliminando ~300 MB de dependencias
  y el overhead de gestión del navegador.
- La autenticación pasa de `LocalAuth` (archivos de sesión de Puppeteer) a
  `useMultiFileAuthState` (pares de credenciales Multi-Device de Baileys).
- El evento `message_create` se reemplaza por `messages.upsert`.
- Los métodos asíncronos de la API de Puppeteer (`getChat()`, `downloadMedia()`,
  `getQuotedMessage()`) se reemplazan por datos directos del objeto mensaje de Baileys.
- Se introduce un caché en memoria de grupos autorizados (`groupFetchAllParticipating()`) para
  reemplazar `getChat()`.
- El pipeline de negocio (OCR, Sheets, AI, classifier) no requiere cambios — solo cambia la
  interfaz de entrada.

## Opciones consideradas

| Opción | Resultado |
|--------|-----------|
| **Retry + rate-limit en getChat()** | No es transitorio — falla siempre |
| **Parche runtime (override de método)** | No repara el error raíz de Puppeteer |
| **Fork propio de wweb.js** | Mantenimiento inviable para un solo dev |
| **Version pinning (wweb.js anterior a @lid)** | No existe versión de wa-version anterior a `@lid` en el repositorio público |
| **Baileys (WebSocket)** | ✅ Funciona con IDs `@lid`, sin Puppeteer |
