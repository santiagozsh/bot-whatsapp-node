# SPEC — Bot WhatsApp Luxury Gotti V3.0

> **Propósito:** Automatización total de la asociación de datos en el chat de WhatsApp.
> El bot procesa comprobantes bancarios y acumula datos de cliente/productos entre comprobantes,
> sin timer, sin intervención humana, con cantidades extraídas localmente sin depender de OpenAI.

---

## Dependencias entre fases

```
Fase 1 (Asociación real: entre comprobante y comprobante)  ←  BASE
 │
 ├─► Fase 3 (Cantidades locales, sin OpenAI)               ←  independiente
 │
 └─► Fase 2 (TrOCR para imágenes manuscritas)              ←  necesita Fase 1
       │
       └─► Fase 4 (Tipos + limpieza técnica)               ←  necesita 1, 2, 3
```

**Orden recomendado:** Fase 1 → Fase 3 → Fase 2 → Fase 4

---

# Fase 1 — Asociación real: entre comprobante y comprobante

**Estado:** `[x]` completado
**Archivo principal:** `src/controllers/message.controller.ts`
**Prerequisito:** Ninguno.

**Propósito:** Eliminar el timer de 60s. La asociación sigue la regla real:
todo lo que está entre el comprobante N y el comprobante N+1 pertenece a N.
El Reply se mantiene intacto para datos que lleguen después de cerrada la transacción.

## Concepto: cómo funciona

```
              ┌──────────────────────────────┐
   TEXTO ───► │ Se acumula en CONTEXTO       │
              │ (sin timer, sin prisa)       │
              └──────────────────────────────┘

   IMAGEN ──► │ OCR → ¿tiene datos financieros?
   (papel)    │   NO → OCR local
              │        → el texto extraído se acumula en CONTEXTO
              └──────────────────────────────────────────┘

   IMAGEN ──► │ OCR → ¿tiene datos financieros?
   (comprob)  │   SÍ → ANTES de procesar ESTE comprobante:
              │     1. ¿Hay transacción anterior abierta?
              │        → toma el CONTEXTO acumulado
              │        → OpenAI Prompt B
              │        → escribe/mergea Ventas para ESA transacción
              │        → vacía el CONTEXTO
              │     2. Procesa ESTE comprobante
              │        → OpenAI Prompt A → Ingresos → SQLite
              │     3. Esta transacción queda "abierta"
              │        (esperando datos en el CONTEXTO)
              └──────────────────────────────────────────┘
```

## Traza del flujo nuevo

**Caso: datos llegan después del comprobante**

```
10:00  [IMAGEN comprobante Nequi $420.000]
         → ¿hay transacción anterior? No. Salta.
         → Procesa: Ingresos → LG-01 ✅
         → LG-01 queda "abierta", esperando datos
         → Contexto: []

10:01  "vendido por Karol"
         → Contexto: ["vendido por Karol"]

10:05  [IMAGEN papel manuscrito]
         → No tiene keywords financieros → es imagen de datos
         → OCR → texto se acumula en contexto
         → Contexto: ["vendido por Karol", "Yenci Perez 310613..."]

10:10  "fueron 3 Rolex y una caja"
         → Contexto: [..., "fueron 3 Rolex y una caja"]

10:20  "revisen el abono de ayer"  ← ruido, se acumula igual
         → Contexto: [..., "revisen el abono de ayer"]

10:40  [IMAGEN comprobante Daviplata $180.000]
         → PASO 1: LG-01 está abierta
           · Toma TODO el contexto: ["vendido por Karol", "Yenci...", "fueron 3 Rolex...", "revisen..."]
           · OpenAI Prompt B → extrae nombre, teléfono, vendedor
           · Prompt B ignora "revisen el abono..." (no contiene datos explícitos)
           · Fase 3: extrae 3 relojes + 1 otro del texto crudo
           · Escribe/mergea fila Ventas para LG-01 ✅
           · Vacía contexto
         → PASO 2: Procesa Daviplata → Ingresos → LG-02
         → LG-02 queda "abierta"
```

## Checklist Fase 1

- [x] **1.1** Eliminar el concepto de "ventana activa con timer"
  - Borrar: `ventanasActivas` (Map), `TIEMPO_VENTANA` (const), `chatsEnProceso` (Set), `textosPendientesPorChat` (Map)
  - Borrar funciones: `abrirVentanaActiva()`, `cerrarVentanaActiva()`, `extenderVentana()`, `getPendientes()`

- [x] **1.2** Renombrar y extender el buffer actual
  - `bufferTextosPorChat` → `contextoPorChat`: `Map<string, Array<{ texto: string; timestamp: number }>>`
  - Función helper `agregarAlContexto(chatId, texto)` que además aplica TTL (ver 1.5)
  - Función helper `obtenerContexto(chatId): string` que devuelve la concatenación de textos (solo lectura)

- [x] **1.3** Nuevo estado: `transaccionActualPorChat`
  - `Map<string, { nPedido: string; messageId: string; fecha: string } | null>`
  - Guarda la transacción "abierta" actual del chat (la que espera datos de Ventas)
  - Si no hay ninguna → `null`
  - Al procesar un comprobante válido, se actualiza esta entrada

- [x] **1.4** Implementar cola por chat: `encolarOperacion(chatId, fn)`
  - `Map<string, Promise<void>>` donde cada operación se encadena a la promesa anterior
  - Cada mensaje entrante (texto, imagen) se encola para garantizar procesamiento secuencial
  - Si una operación falla (catch → logger.error), no bloquea la cola para las siguientes

- [x] **1.5** TTL en el contexto: al agregar un texto, descartar si `Date.now() - timestamp > 4 horas`
  - Aplicado en `agregarAlContexto(chatId, texto)`, antes de guardar
  - También se limpian ítems expirados al obtener el contexto
  - Configurable vía `TIEMPO_TTL_CONTEXTO` (default: 4 horas en ms)

- [x] **1.6** Nueva función: `finalizarTransaccionAnterior(chatId, chat)`
  - Obtiene la transacción actual de `transaccionActualPorChat`
  - Si no hay → no hace nada
  - Obtiene el contexto acumulado (`obtenerContexto(chatId)`)
  - Si el contexto tiene datos útiles → OpenAI Prompt B → escribe/mergea Ventas
  - Si no tiene datos útiles → salta (Ventas queda vacío para esa transacción)
  - Vacía `contextoPorChat` para ese chat
  - Marca `transaccionActualPorChat` como `null`

- [x] **1.7** Reescribir `procesarImagen(msg, chat, chatId)`:
  ```
  1. OCR + Sharp (igual que ahora)
  2. Si NO tiene keywords financieros → es imagen de datos:
     a. El texto extraído se acumula en contexto (agregarAlContexto)
     b. Fin.
  3. Si SÍ tiene keywords financieros → es comprobante:
     a. finalizarTransaccionAnterior(chatId, chat)  ← cierra la anterior
     b. OpenAI Prompt A → extrae datos (igual que ahora)
     c. Verifica duplicado por referencia (igual que ahora)
     d. escribe Ingresos, guarda SQLite (igual que ahora)
     e. transaccionActualPorChat.set(chatId, { nPedido, messageId, fecha })
     f. También escribe Abono en Compras si corresponde (igual que ahora)
  ```

- [x] **1.8** Reescribir `procesarTextoSinReply(msg, chatId)`:
  - Ya no hay ventana activa
  - Siempre va al contexto: `agregarAlContexto(chatId, msg.body)`
  - (El ruido se acumula igual — OpenAI lo filtrará en el momento del cierre)

- [x] **1.9** Mantener intacto `procesarTextoConReply()` — no se modifica

- [x] **1.10** Timer de respaldo para cerrar transacciones huérfanas
  - Si después de `TIEMPO_CIERRE_RESPALDO` (default: 4 horas) no ha llegado un comprobante nuevo,
    se llama a `finalizarTransaccionAnterior()` para ese chat
  - Se implementa con un `setTimeout` que se resetea cada vez que se procesa un comprobante
  - Si no hay contexto → no se escribe nada en Ventas, simplemente se limpia

- [x] **1.11** `npx tsc --noEmit` sin errores

---

# Fase 2 — Imágenes manuscritas con TrOCR local

**Estado:** `[x]` completado
**Archivos:** `src/services/vision.service.ts`, `...`
**Prerequisito:** Fase 1 (el contexto ya acepta texto de imágenes no-comprobante).
**Propósito:** Leer fotos de papel escritas con bolígrafo sin costo de tokens,
sin pago mínimo de servicios cloud.

## Concepto

- Tesseract (actual) lee bien capturas de pantalla bancarias (fuente digital)
- Tesseract falla con texto manuscrito en bolígrafo (confianza < 40%, texto basura)
- TrOCR (`microsoft/trocr-base-handwritten`) es un modelo open-source que corre 100% local en Node.js
- Estrategia: Tesseract primero (gratis, rápido). Si falla → TrOCR como fallback (gratis, más lento).
- Si ambos fallan → descartar (0 tokens de OpenAI, la imagen era ilegible)

## Checklist Fase 2

- [x] **2.1** Instalar dependencia
  ```bash
  npm install @xenova/transformers
  ```

- [x] **2.2** Inicializar el pipeline TrOCR una sola vez al arrancar
  - En `src/index.ts` o lazy en `vision.service.ts`
  - El modelo se descarga la primera vez (~200 MB, se cachea en `~/.cache/huggingface/`)
  - La carga inicial tarda ~5-10 segundos

- [x] **2.3** Nueva función `extraerTextoConVisionMejorado(imagenBase64): Promise<string>`
  ```
  1. Tesseract primero (spa+eng, igual que ahora)
  2. Evaluar calidad del resultado:
     - Si texto vacío o "SIN_TEXTO_DETECTADO" → intentar TrOCR
     - Si texto < 10 caracteres → intentar TrOCR
     - Si texto >= 10 caracteres → devolver texto de Tesseract (es comprobante digital, no manuscrito)
  3. TrOCR: pipeline('image-to-text', 'Xenova/trocr-base-handwritten')
     - Convertir base64 a buffer
     - Pasar por el modelo
     - Devolver texto extraído
  4. Si TrOCR también falla → retornar "" (se descarta, 0 tokens)
  ```

- [x] **2.4** Integrar en `procesarImagen()`
  - Cuando la imagen NO es comprobante (sin keywords financieros),
    usar `extraerTextoConVisionMejorado()` en vez del OCR simple actual
  - El texto resultante se acumula en contexto con `agregarAlContexto(chatId, texto)`
  - Si el texto es vacío → no se acumula nada

- [x] **2.5** `npx tsc --noEmit` sin errores

---

# Fase 3 — Cantidades de productos sin depender de OpenAI

**Estado:** `[x]` completado
**Archivos:** `src/utils/luxurygotti.data.ts`, `src/utils/prompts.ts`, `src/services/ai.service.ts`, `src/services/sheets.service.ts`
**Prerequisito:** Ninguno (independiente de Fase 1 y 2).
**Propósito:** Contar cada línea de producto individualmente, como lo hace un humano.
OpenAI ya no resume/perdona líneas repetidas — las cantidades las calcula el código.

## Concepto

El bot actual le pasa el texto de productos a OpenAI y la IA responde resumiendo:
```
Input:  "RM 60.000, RM 60.000, RM 60.000, Patek 60.000, Gforce 135.000, 5 Cajas"
Output: "RM, Patek, Gforce, Cajas de lujo"  ← perdió las repeticiones
```
→ 3 relojes, 1 otro. **Error. Deberían ser 5 relojes, 5 otros.**

Con Fase 3:
1. El texto CRUDO de productos se procesa localmente, línea por línea
2. OpenAI solo extrae: nombreCliente, email, telefono, municipio, vendedor
3. Las cantidades no pasan por IA — son determinísticas

## Reglas de extracción de cantidades

| Patrón en el texto | Cantidad | Tipo |
|---|---|---|
| `RM 60.000` (una línea, sin número al inicio) | 1 | reloj |
| `RM 60.000, RM 60.000, RM 60.000` (tres ítems separados por coma) | 3 | relojes |
| `5 Cajas de lujo` | 5 | otros |
| `3 relojes Patek` | 3 | relojes |
| `6 unds Casio` | 6 | relojes |
| `2 x Rolex` / `2x Rolex` | 2 | relojes |
| `1 correa` | 1 | otro |
| Línea sin marca ni keyword conocida | 1 | otro (por defecto) |
| Precio detectable (> 999 o contiene "000") | se ignora como cantidad, se usa solo la unidad | reloj/otro |

## Checklist Fase 3

- [x] **3.1** Nueva función `extraerListaProductos(textoCrudo: string): DatosProducto` en `luxurygotti.data.ts`
  - Divide el texto en líneas (por `\n`) y en ítems (por `,`)
  - Para cada ítem:
    - Detecta si es un precio (números > 999, con punto de miles o terminados en "000") → ignorar precio
    - Detecta cantidad explícita: `"N cajas"`, `"N relojes"`, `"N unds"`, `"N x producto"`, `"N correas"`, etc.
    - Si no hay cantidad explícita → 1 unidad
    - Clasifica: ¿es reloj (marca/modelo conocido) o es otro (caja, correa, perfume, etc.)?
    - Acumula: `cantidadRelojes` y `cantidadOtros`
  - También devuelve `lineasProducto: string[]` con la lista completa (para escribir en la hoja Ventas)
  - Retorna: `{ lineasProducto: string[], cantidadRelojes: number, cantidadOtros: number }`

- [x] **3.2** Separar detección de precio vs cantidad en `extraerCantidad()`
  - Agregar helper `esPrecio(valor: string): boolean`
    - `true` si el número > 999, o contiene "000", o tiene punto de miles
    - Ejemplo: `"60.000"` → es precio, no cantidad
    - Ejemplo: `"2"` → no es precio, es cantidad

- [x] **3.3** Modificar Prompt B (`construirPromptCliente`)
  - **Eliminar** el campo `producto` del JSON de respuesta
  - **Eliminar** las reglas del prompt sobre extraer productos
  - El nuevo JSON de respuesta es solo:
    ```json
    {"nombreCliente":"","email":"","telefono":"","municipio":"","vendedor":""}
    ```
  - Prompt sigue instruyendo: "Extrae solo lo explícito", "N/A" si no encuentra, vendedor de patrón "venta X"

- [x] **3.4** Modificar `extraerDatosCliente()` en `ai.service.ts`
  - Después de recibir respuesta de OpenAI:
    - Llamar a `extraerListaProductos(bloqueTexto)` con el texto CRUDO (el mismo que se manda al prompt, sin modificar)
    - Hacer merge: `datosCliente.cantidadRelojes = locales.cantidadRelojes`
    - Hacer merge: `datosCliente.cantidadOtros = locales.cantidadOtros`
    - Hacer merge: `datosCliente.producto = locales.lineasProducto.join(', ')`
  - Eliminar la llamada a `clasificarProducto()` (ya no se usa)

- [x] **3.5** Modificar `escribirFilaVenta()` en `sheets.service.ts`
  - El campo `producto` (columna H) se llena con la lista completa de líneas
  - Formato: `"RM 60.000, RM 60.000, RM 60.000, Patek 60.000, Gforce 135.000, 5 Cajas de lujo"`

- [x] **3.6** Agregar tests unitarios rápidos para `extraerListaProductos`
  - Input: `"RM 60.000\nRM 60.000\nPatek 60.000\n5 Cajas de lujo"`
  - Esperado: `{ cantidadRelojes: 3, cantidadOtros: 5 }`
  - Input: `"6 relojes Patek, 3 cajas"`
  - Esperado: `{ cantidadRelojes: 6, cantidadOtros: 3 }`
  - Input: `"Gforce 135.000"`
  - Esperado: `{ cantidadRelojes: 1, cantidadOtros: 0 }`

- [x] **3.7** `npx tsc --noEmit` sin errores

---

# Fase 4 — Tipos y limpieza técnica

**Estado:** `[x]` completado
**Prerequisito:** Fases 1, 2, 3 completas.
**Propósito:** Interfaces tipadas, funciones separadas y testeables, eliminar `any`,
mover lógica de negocio fuera de los prompts.

## Checklist Fase 4

- [x] **4.1** Crear `src/types.ts` con todas las interfaces del dominio

- [x] **4.2** Reemplazar todos los `any` del proyecto por las interfaces

- [x] **4.3** Separar `procesarImagen()` en funciones más pequeñas y testeables

- [x] **4.4** Mover la clasificación Ingreso/Abono del prompt A a TypeScript
  - Nueva función `clasificarTipoIngreso(cuentaDestino: string, textoOCR: string): 'Ingreso' | 'Abono'`
  - Las cuentas específicas se chequean con regex en código, no por IA
  - Simplificar Prompt A: eliminar las reglas de Ingreso/Abono/vendedor, solo extraer datos crudos

- [x] **4.5** Mover la extracción de vendedor del prompt a TypeScript
  - Nueva función `extraerVendedor(texto: string): string`
  - Busca patrón `"venta Evelin"`, `"vendido por Karol"`, etc. con regex
  - Si no encuentra → `"JHON"` (default)
  - Prompt A ya no extrae vendedor

- [x] **4.6** `npx tsc --noEmit` sin errores

---

# Casos de prueba de integración

> **Prerequisito:** Fases 1, 2 y 3 completas.
> Ejecutar con el bot real en el grupo sandbox "Contabilidad".

- [ ] **C1 — Datos después del comprobante, cierre por siguiente comprobante**
  1. Mandar imagen de comprobante Nequi
  2. Mandar texto: "vendido por Karol"
  3. Mandar imagen de papel manuscrito con datos del cliente
  4. Mandar texto: "fueron 3 Rolex y 2 cajas"
  5. Mandar imagen de otro comprobante Bancolombia
  6. **Esperado:** LG-01 en Ingresos con LG-01 en Ventas (Karol + datos + 3 relojes + 2 otros). LG-02 en Ingresos.

- [ ] **C2 — Datos antes del comprobante**
  1. Mandar texto: "Mateo Bedoya 3217769177 Armenia"
  2. Mandar texto: "RM 60.000, Patek 60.000"
  3. Mandar imagen de comprobante
  4. Mandar imagen de otro comprobante (para cerrar)
  5. **Esperado:** LG-01 en Ventas con Mateo + 2 relojes.

- [ ] **C3 — Dos comprobantes seguidos sin datos**
  1. Mandar imagen comprobante 1
  2. Mandar imagen comprobante 2
  3. **Esperado:** LG-01 y LG-02 en Ingresos. Sin filas Ventas.

- [ ] **C4 — Ruido de conversación no corrompe datos**
  1. Mandar imagen comprobante 1
  2. Mandar "revisen el abono de ayer que falta"
  3. Mandar "ok ya lo reviso"
  4. Mandar "David Bedoya 3001234567 Medellín"
  5. Mandar imagen comprobante 2 (cierra el 1)
  6. **Esperado:** LG-01 Ventas con David Bedoya. El ruido ignorado.

- [ ] **C5 — Reply para completar transacción ya cerrada**
  1. Mandar imagen comprobante 1
  2. Mandar imagen comprobante 2 (cierra el 1 sin datos de cliente)
  3. Hacer Reply al mensaje del comprobante 1: "Mateo 3217769177 Armenia 3 RM"
  4. **Esperado:** Ventas de LG-01 se llena con Mateo + 3 relojes.

- [ ] **C6 — Imagen manuscrita se asocia correctamente**
  1. Mandar imagen comprobante 1
  2. Mandar foto de papel manuscrito (simula: "Yenci Perez 3106131751 Bogotá")
  3. Mandar imagen comprobante 2
  4. **Esperado:** Ventas de LG-01 con nombre Yenci, teléfono 3106131751, municipio Bogotá.

- [ ] **C7 — Cantidades: líneas repetidas no se resumen**
  1. Mandar: "RM 60.000, RM 60.000, RM 60.000, Patek 60.000, Patek 60.000, Gforce 135.000, 5 Cajas de lujo"
  2. Mandar imagen comprobante 1
  3. Mandar imagen comprobante 2
  4. **Esperado:** Ventas de LG-01: 6 relojes + 5 otros. El campo producto contiene las 7 líneas completas.

- [ ] **C8 — Cantidades explícitas**
  1. Mandar: "6 relojes Patek, 3 cajas de lujo"
  2. Mandar imagen comprobante 1
  3. Mandar imagen comprobante 2
  4. **Esperado:** Ventas de LG-01: 6 relojes + 3 otros.

- [ ] **C9 — Imagen no financiera (catálogo de reloj) se descarta sin tokens**
  1. Mandar foto cualquiera sin texto financiero (foto de un reloj, paisaje, etc.)
  2. **Esperado:** Se descarta. 0 tokens consumidos. El logger muestra "Sin datos financieros — descartada".

- [ ] **C10 — Sticker/audio/video se ignoran**
  1. Mandar sticker
  2. Mandar nota de voz
  3. **Esperado:** Ignorados por el portero. 0 tokens.

---

# Referencia de archivos

| Archivo | Fase 1 | Fase 2 | Fase 3 | Fase 4 |
|---------|--------|--------|--------|--------|
| `src/index.ts` | — | ✏️ init TrOCR | — | — |
| `src/controllers/message.controller.ts` | ✏️ reescribir | — | — | ✏️ separar |
| `src/services/vision.service.ts` | — | ✏️ TrOCR | — | — |
| `src/services/ai.service.ts` | — | — | ✏️ merge productos | ✏️ quitar any |
| `src/services/sheets.service.ts` | — | — | ✏️ columna producto | ✏️ quitar any |
| `src/services/memory.service.ts` | — | — | — | ✏️ quitar any |
| `src/utils/prompts.ts` | — | — | ✏️ eliminar producto | ✏️ simplificar |
| `src/utils/luxurygotti.data.ts` | — | — | ✏️ extraerListaProductos | — |
| `src/types.ts` | — | — | — | ✏️ crear |

Leyenda: ✏️ modificar | Crear nuevo | — sin cambios

---

# Variables de entorno (`.env`)

| Variable | Default | Descripción |
|----------|---------|-------------|
| `TIEMPO_TTL_CONTEXTO` | `14400000` | 4 horas en ms. Textos más viejos se descartan del contexto. |
| `TIEMPO_CIERRE_RESPALDO` | `14400000` | 4 horas en ms. Si no llega comprobante nuevo, se cierra la transacción. |
| `TIEMPO_VENTANA_ACTIVA` | — | **ELIMINADA.** Ya no se usa. |

---

# Progreso general

| Fase | Descripción | Estado |
|------|-------------|--------|
| 1 | Asociación real: entre comprobante y comprobante | `[x]` |
| 2 | Imágenes manuscritas con TrOCR local | `[x]` |
| 3 | Cantidades de productos sin OpenAI | `[x]` |
| 4 | Tipos y limpieza técnica | `[x]` |
