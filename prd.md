# ✅ Checklist V2.0 — Bot WhatsApp Luxury Gotti

> Cada bloque es independiente y puede trabajarse en un chat separado.
> El orden importa: los bloques anteriores son prerequisito de los siguientes.
> Estado: `[ ]` pendiente · `[/]` en progreso · `[x]` completado

---

## 📋 Referencias rápidas

| Archivo | Ruta |
|---|---|
| Controlador | `src/controllers/message.controller.ts` |
| Servicio IA | `src/services/ai.service.ts` |
| Servicio Sheets | `src/services/sheets.service.ts` |
| Servicio WA | `src/services/whatsapp.service.ts` |
| Prompts | `src/utils/prompts.ts` |
| Helpers | `src/utils/helpers.ts` |
| Plan completo | `implementation_plan.md` (este directorio) |

---

## BLOQUE 0 — Preparación del entorno
> **Prerequisito:** Ninguno. Hacerlo primero.

- [x] Instalar dependencias nuevas:
  ```bash
  npm install better-sqlite3
  npm install @types/better-sqlite3 --save-dev
  ```
- [x] Agregar variables nuevas al `.env`:
  ```env
  TIEMPO_ESPERA_CAJA=300000
  SHEETS_VENTAS_NOMBRE=Ventas
  ```
- [x] Verificar que el proyecto compila sin errores: `npx tsc --noEmit`

---

## BLOQUE 1 — `memory.service.ts` (SQLite)
> **Prerequisito:** Bloque 0 completo.  
> **Archivo nuevo:** `src/services/memory.service.ts`  
> **Propósito:** Guardar el mapping `messageId → { nPedido, filaIngreso, filaVenta }` para el mecanismo de Reply tardío.

- [x] Crear `src/services/memory.service.ts`
- [x] Implementar función `inicializarDB()` — crea el archivo `bot_memory.db` y la tabla si no existe
- [x] Implementar función `guardarTransaccion(messageId, nPedido, filaIngreso)` — inserta un registro
- [x] Implementar función `buscarTransaccion(messageId)` — devuelve el registro o `null`
- [x] Implementar función `actualizarFilaVenta(messageId, filaVenta)` — actualiza el campo filaVenta
- [x] Implementar limpieza FIFO — al superar 300 registros, borrar los más antiguos
- [x] Llamar `inicializarDB()` al arrancar desde `src/index.ts`
- [x] **Verificar:** `npx tsc --noEmit` sin errores ✅

---

## BLOQUE 2 — `colombia.data.ts` (Diccionario de municipios)
> **Prerequisito:** Ninguno (independiente).  
> **Archivo nuevo:** `src/utils/colombia.data.ts`  
> **Propósito:** Deducir el departamento colombiano a partir del municipio, sin gastar tokens de IA.

- [x] Crear `src/utils/colombia.data.ts` con el mapa completo de ~1120 municipios → departamento
- [x] Implementar función `obtenerDepartamento(municipio: string): string`
  - Normaliza el input: mayúsculas + remover tildes antes de buscar
  - Si no encuentra → retorna `"N/A"`
- [x] Agregar función `normalizarTexto(texto: string): string` en `src/utils/helpers.ts`
- [x] **Verificar:** Probar con: `"Armenia" → "QUINDÍO"`, `"bogotá" → "CUNDINAMARCA"`, `"XYZ" → "N/A"` ✅

---

## BLOQUE 3 — Extender la Caja (timer + estructura)
> **Prerequisito:** Bloque 0.  
> **Archivo:** `src/controllers/message.controller.ts`  
> **Propósito:** Cambiar el timer de 15 seg a configurable por `.env`, y agregar campos para datos de cliente en la estructura de la caja.

- [x] Cambiar `const TIEMPO_ESPERA = 15000` por `const TIEMPO_ESPERA = parseInt(process.env.TIEMPO_ESPERA_CAJA || '300000')`
- [x] Agregar campo `imagenesCliente: string[]` a la interfaz `ImagenCaja` (imágenes adicionales que no son comprobantes)
- [x] Agregar campo `imagenesPrevias: string[]` a la interfaz `CajaRecoleccion` (imágenes de cliente que llegan antes del comprobante)
- [x] **Verificar:** El bot sigue funcionando con el timer extendido. `npx tsc --noEmit` ✅

---

## BLOQUE 4 — Prompt B: Extractor de cliente
> **Prerequisito:** Bloque 2 (para saber qué campos se esperan).  
> **Archivo:** `src/utils/prompts.ts`  
> **Propósito:** Nuevo prompt especializado que recibe un bloque de texto libre y extrae los datos del cliente.

- [x] Agregar función `construirPromptCliente(bloqueTexto: string): string` en `prompts.ts`
- [x] El prompt debe pedir este JSON exacto:
  ```json
  {
    "nombreCliente": "",
    "email": "",
    "telefono": "",
    "municipio": "",
    "producto": "",
    "cantidadRelojes": 0,
    "cantidadOtros": 0
  }
  ```
- [x] Regla en el prompt: campos de texto no encontrados → `"N/A"`, cantidades → `0`
- [x] El prompt NO pide departamento (lo deduce el diccionario local)
- [x] **Verificar:** Pasar un texto de prueba tipo `"Mateo Bedoya, 3217769177, Armenia, QyQ 2 relojes"` y ver que extrae correctamente

---

## BLOQUE 5 — `ai.service.ts`: función de extracción de cliente
> **Prerequisito:** Bloque 4.  
> **Archivo:** `src/services/ai.service.ts`  
> **Propósito:** Nueva función que recibe el bloque de texto acumulado y llama a OpenAI con el Prompt B.

- [x] Agregar función `extraerDatosCliente(bloqueTexto: string)` en `ai.service.ts`
  - Recibe texto plano (ya procesado por OCR si venía de imagen)
  - Llama a OpenAI con `construirPromptCliente()`
  - Devuelve el JSON del cliente parseado
- [x] La función reutiliza el mismo cliente OpenAI ya inicializado
- [x] Loguea el uso de tokens igual que `extraerDatosConIA()`
- [x] **Verificar:** Llamar la función manualmente con un texto de prueba. Ver JSON en consola.

---

## BLOQUE 6 — `sheets.service.ts`: escritura y merge en Ventas
> **Prerequisito:** Bloque 2 (diccionario Colombia).  
> **Archivo:** `src/services/sheets.service.ts`  
> **Propósito:** Funciones para crear y actualizar filas en la hoja "Ventas".

- [x] Agregar función `escribirFilaVenta(datosCliente: any, nPedido: string, fecha: string)`
  - Construye la fila con los 10 campos de la hoja Ventas
  - Usa `obtenerDepartamento()` del diccionario local
  - Hace `append` a la hoja `process.env.SHEETS_VENTAS_NOMBRE`
  - Devuelve el número de fila creado (para guardarlo en SQLite)
- [x] Agregar función `mergeFilaVenta(filaVenta: number, datosNuevos: any)`
  - Lee primero la fila actual
  - Solo sobreescribe campos que están en `"N/A"` o `0`
  - Usa `spreadsheets.values.update` (no `.append`)
- [x] Agregar función `actualizarFilaIngreso(filaIngreso: number, campos: Partial<DatosIngreso>)`
  - Actualiza solo las columnas especificadas de "Ingresos transacciones"
  - Útil para corregir vendedor o tipo desde un Reply
- [x] **Verificar:** `npx tsc --noEmit` sin errores ✅

---

## BLOQUE 7 — Cierre de caja: escritura dual
> **Prerequisito:** Bloques 1, 5 y 6.  
> **Archivo:** `src/controllers/message.controller.ts`  
> **Propósito:** Al cerrar la caja, después de procesar los comprobantes, extraer y escribir los datos del cliente para la última transacción válida (LIFO).

- [x] Al cierre del cronómetro, después del loop de imágenes de comprobante:
  - [x] Identificar la **última imagen válida** (último comprobante con `esComprobanteValido: true`)
  - [x] Recopilar su `textosEspecificos[]` + `imagenesCliente[]` + `cajaCerrada.textosPrevios[]`
  - [x] Para cada imagen en `imagenesCliente[]`: pasar por Tesseract OCR → texto
  - [x] Unir todo en un bloque de texto
  - [x] Si el bloque NO está vacío → llamar `extraerDatosCliente(bloque)`
  - [x] Si hay datos de cliente extraídos → llamar `escribirFilaVenta()`
  - [x] Guardar `filaVenta` en SQLite con `actualizarFilaVenta()`
- [x] **Verificar:** Mandar imagen de pago + texto de cliente al sandbox. Ver que aparece en las dos hojas.

---

## BLOQUE 8 — Lógica de imagen adicional dentro de la caja
> **Prerequisito:** Bloque 7.  
> **Archivo:** `src/controllers/message.controller.ts`  
> **Propósito:** Cuando llega una imagen dentro de la caja (y ya hay un comprobante), evaluar si es otro comprobante o imagen con datos de cliente.

- [x] Cuando llega una imagen JPG/PNG y ya hay al menos una imagen en la caja:
  - [x] Descargar, comprimir con Sharp, pasar por Tesseract OCR
  - [x] Llamar `extraerDatosConIA()` para clasificar
  - [x] Si `esComprobanteValido: true` → agregar a `imagenes[]` como nuevo comprobante
  - [x] Si `esComprobanteValido: false` → agregar el base64 a `imagenesCliente[]` del último comprobante
- [x] **Verificar:** Mandar foto de pago + foto de formulario de cliente. El formulario debe ir a Ventas, el pago a Ingresos.

---

## BLOQUE 9 — Reply tardío (mecanismo de corrección)
> **Prerequisito:** Bloques 1, 5 y 6.  
> **Archivo:** `src/controllers/message.controller.ts`  
> **Propósito:** Cuando llega un Reply a un mensaje cuyo messageId está en SQLite, procesarlo como corrección/complemento de datos de cliente.

- [x] Al recibir cualquier mensaje con `msg.hasQuotedMsg === true`:
  - [x] Obtener `quotedMessage.id._serialized`
  - [x] Consultar SQLite con `buscarTransaccion(quotedMessageId)`
  - [x] Si no existe en SQLite → ignorar (puede ser reply normal de conversación)
  - [x] Si existe:
    - [x] ¿Es texto? → pasar directamente a `extraerDatosCliente()`
    - [x] ¿Es imagen? → OCR primero, luego `extraerDatosCliente()`
    - [x] ¿`filaVenta` es NULL en SQLite? → `escribirFilaVenta()` (primera vez)
    - [x] ¿`filaVenta` existe? → `mergeFilaVenta()` (ya había datos, solo complementar)
    - [x] Actualizar SQLite si se creó una fila nueva en Ventas
- [x] **Verificar:** Mandar una imagen, esperar que la caja cierre (omitir datos de cliente), luego hacer Reply con los datos. Verificar que Ventas se llena correctamente.

---

## BLOQUE 10 — Respuesta del bot en Sandbox
> **Prerequisito:** Bloque 7.  
> **Archivo:** `src/services/whatsapp.service.ts`  
> **Propósito:** El bot responde en el grupo Sandbox con confirmaciones. En producción, silencio absoluto.

- [x] Agregar función `enviarMensaje(chat, texto: string)` en `whatsapp.service.ts`
  - [x] Solo ejecuta si `chat.name === 'Contabilidad'` (el sandbox)
  - [x] En producción simplemente no hace nada
- [x] Integrar confirmaciones en el cierre de caja (Bloque 7):
  - [x] `✅ LG-26 | $165.000 Nequi | Karol` — por cada comprobante válido
  - [x] `👤 LG-26 | Mateo Bedoya | Armenia, Quindío` — si se escribió Ventas
  - [x] `⚠️ Imagen no reconocida como comprobante` — si `esComprobanteValido: false`
- [x] Integrar confirmación en Reply tardío (Bloque 9):
  - [x] `🔄 LG-26 actualizado` — cuando se hace merge en Ventas
- [x] **Verificar:** En el sandbox, el bot responde. En el grupo de producción, silencio.

---

## BLOQUE 11 — Pruebas de integración end-to-end
> **Prerequisito:** Todos los bloques anteriores.

- [x] **Escenario A** — Normal:
  Imagen de pago → texto del cliente → silencio
  Esperado: fila en Ingresos + fila en Ventas

- [x] **Escenario B** — Dos pagos seguidos + datos:
  Imagen pago1 → imagen pago2 → texto cliente → silencio
  Esperado: 2 filas en Ingresos + 1 fila en Ventas (asociada al pago2)

- [x] **Escenario C** — Datos antes del pago:
  Texto cliente → imagen pago → silencio
  Esperado: fila en Ingresos + fila en Ventas

- [x] **Escenario D** — Imagen de cliente + imagen de pago:
  Imagen pago → imagen formulario cliente → silencio
  Esperado: fila en Ingresos + fila en Ventas con datos del formulario

- [x] **Escenario E** — Reply tardío:
  Imagen pago → caja cierra (sin datos cliente) → Reply con datos → Ventas se llena

- [x] **Escenario F** — Imagen no válida:
  Foto de un reloj (no comprobante) → descartada, sin escritura en ninguna hoja

- [x] **Escenario G** — Sticker/audio/video:
  Descartado por el portero, sin costo de tokens

---

## BLOQUE 12 — Actualizar documentación del proyecto
> **Prerequisito:** Bloques 1-11 completos.

- [ ] Actualizar `architecture.md` con la arquitectura V2.0
- [ ] Actualizar `PROJECT_CONTEXT.md` en el directorio del agente
- [ ] Documentar en `.env.example` todas las variables requeridas
- [ ] Confirmar que `problemas.md` sigue siendo relevante o actualizarlo

---

## 📊 Progreso general

| Bloque | Descripción | Estado |
|---|---|---|
| 0 | Preparación entorno | `[x]` |
| 1 | SQLite memory.service | `[x]` |
| 2 | Diccionario Colombia | `[x]` |
| 3 | Caja extendida (timer + estructura) | `[x]` |
| 4 | Prompt B cliente | `[x]` |
| 5 | extraerDatosCliente() | `[x]` |
| 6 | escribirFilaVenta() + merge | `[x]` |
| 7 | Cierre de caja dual | `[x]` |
| 8 | Imagen adicional en caja | `[x]` |
| 9 | Reply tardío | `[x]` |
| 10 | Respuestas sandbox | `[x]` |
| 11 | Pruebas end-to-end | `[x]` |
| 12 | Documentación | `[ ]` |
