# WhatsApp Bot Architecture — Luxury Gotti V3.0

> This document explains how the whole bot works, written for the project owner
> (who did not write the code). If anything is unclear, the source code is the final reference.
> (Spanish original for personal use: `docs/internal/arquitectura.es.md`, gitignored.)

---

## 1. What the bot does, in one sentence

Listens to a WhatsApp group; when someone sends a **bank transfer receipt**, it extracts the data
with OCR + AI and records it in **Google Sheets**. Between receipts, it accumulates the group's
text messages (customer/product data) and associates them with the active transaction. It also
classifies each order as "wholesale" or "retail".

The business is **Luxury Gotti**: watch and accessory sales (brand replicas), wholesale and
retail, in Colombia. Orders are identified with a sequential number `LG-XXX`.

---

## 2. The data model (the two Google Sheets tabs)

All business information lives in one Google Spreadsheet with (at least) two tabs:

### Tab `Ingresos transacciones` (9 columns, A–I)

| Col | Field | Source | Example |
|-----|-------|--------|---------|
| A | N.Pedido | Local SQLite sequence | `LG-001` |
| B | Fecha | OpenAI (Prompt A), formatted | `1-Ene-2026` |
| C | Tipo | Local classification: `Ingreso` / `Abono` | `Ingreso` |
| D | Descripción | OpenAI → later **overwritten by the classifier** | `Pedido al por menor` |
| E | Precio compra | OpenAI | `165000` |
| F | Medio de pago | Bank detected by color, or OpenAI | `Nequi` |
| G | Referencia de pago | OpenAI | `N° 88391247` |
| H | Cuenta destino | OpenAI, formatted `XXX XXX XXXX` | `314 352 7475` |
| I | Vendedor | Local regex over context (default `JHON`) | `KAROL` |

### Tab `Ventas` (10 columns, A–J, name configurable via `SHEETS_VENTAS_NOMBRE`)

| Col | Field | Source | Example |
|-----|-------|--------|---------|
| A | N.Pedido | Same `LG-XXX` as the income row | `LG-001` |
| B | Fecha | Transaction date | `1-Ene-2026` |
| C | Nombre cliente | OpenAI (Prompt B) | `Yenci Perez` |
| D | Email | OpenAI (Prompt B) | `N/A` |
| E | Teléfono | OpenAI (Prompt B) | `3106131751` |
| F | Municipio | OpenAI (Prompt B) | `Armenia` |
| G | Departamento | Local lookup (`colombia.data.ts`) | `QUINDÍO` |
| H | Producto | Local parser (`luxurygotti.data.ts`) | `CASIO x2, PERFUME x1` |
| I | Cant. relojes | Local parser | `2` |
| J | Cant. otros | Local parser | `1` |

**Key business rule:** every `N.Pedido` (LG-XXX) must appear exactly once in Ingresos and once
in Ventas.

---

## 3. Architecture diagram

```
┌────────────────────────────────────────────────────────────────────┐
│ src/index.ts — startup, cron jobs, shutdown                        │
└───────────────┬────────────────────────────────────────────────────┘
                │
┌───────────────▼────────────────────────────────────────────────────┐
│ whatsapp.service.ts — Baileys connection (WebSocket)               │
│  · QR / auth in ./auth_info (Multi-Device folder)                  │
│  · reconnection with backoff (2s → 32s) and 30s timeout            │
│  · listens ONLY to authorized groups (GRUPO_AUTORIZADO)            │
│  · downloads images → base64 → builds MensajeEntrante              │
└───────────────┬────────────────────────────────────────────────────┘
                │ MensajeEntrante
┌───────────────▼────────────────────────────────────────────────────┐
│ message.controller.ts — the "brain" (orchestrates everything)      │
│  · per-chat queue (messages in one chat process serially)          │
│  · per-chat context (conversation memory, 4h TTL)                  │
│  · pending transaction per chat + closing timer (4h)               │
└──────┬───────────────┬──────────────────┬──────────────┬───────────┘
       │               │                  │              │
┌──────▼──────┐ ┌──────▼──────┐  ┌────────▼───────┐  ┌───▼────────────┐
│ ai.service  │ │ vision.svc  │  │ sheets.service │  │ memory.service │
│ · sharp     │ │ · tesseract │  │ · write        │  │ · SQLite       │
│ · Prompt A  │ │ · TrOCR     │  │ · merge        │  │ · history      │
│ · Prompt B  │ │   fallback  │  │ · read         │  │ · LG sequence  │
└─────────────┘ └─────────────┘  └───────┬────────┘  └───┬────────────┘
                                         │               │
                           Google Sheets API          bot_memory.db
                           (source of truth)           (local memory)
```

---

## 4. End-to-end flow: the journey of a receipt

### Step 0 — Startup (`index.ts`)

1. Opens `bot_memory.db` (SQLite) and creates tables if missing
2. Queries Google Sheets for the latest `LG-XXX` and syncs the local sequence (avoids duplicates)
3. Connects WhatsApp (Baileys). No session → shows QR in console
4. Schedules background jobs (see §7)

### Step 1 — A message arrives in the group (`whatsapp.service.ts`)

Filters applied before processing:
- Only **new** messages (`type === 'notify'`), only **groups** (`@g.us`), only groups named in `GRUPO_AUTORIZADO`
- Images are downloaded (stickers/webp excluded) and converted to **base64**
- Builds `MensajeEntrante` (id, chat, text, has image, reply info) and hands it to the controller

### Step 2 — The controller decides what it is (`message.controller.ts`)

Every message enters a **per-chat queue** (one chat processes one message at a time — avoids races).

**If it's an image:**
1. `preprocesarImagen`: compress with sharp (1200px, grayscale, quality 85) → OCR with tesseract (`spa+eng`). If tesseract yields fewer than 10 chars → tries TrOCR (local handwriting model)
2. `textoContieneDatosFinancieros(texto)`: keyword search (nequi, bancolombia, comprobante, pago, valor...)
   - **NO match** → it's a data image (e.g., a handwritten order sheet). OCR text accumulates into the **chat context** (if it passes the `esTextoUtil` anti-garbage filter)
   - **Match** → it's a receipt → step 3

**If plain text (no reply):** accumulates into the chat context. This is where the magic lives:
context is what makes association possible.

**If text replying to another message:** see §6.

### Step 3 — Process the receipt (Prompt A)

1. **`finalizarTransaccionAnterior`**: if there's an open transaction (from the previous receipt),
   close it first (step 5). **This is the association rule**: everything discussed since the last
   receipt belongs to that last receipt.
2. Take the accumulated context (truncated to 300 characters) and send it to OpenAI with
   **Prompt A** (accounting): `{esComprobanteValido, fecha, descripcion, precioCompra, medioDePago, referenciaDePago, cuentaDestino}`
3. Enriched **without AI**, deterministically and free:
   - `tipo` = `Ingreso` or `Abono`, based on destination account against lists in `config.data.ts`
   - `vendedor` = regex `venta <nombre>` over the context (default `JHON`)
   - `medioDePago` = bank detected from the image's **dominant color** (yellow/black → Bancolombia, pink → Nequi, red → Davivienda/Daviplata)
4. Validations:
   - `esComprobanteValido: false`? → discard (spends nothing more)
   - Payment reference already in SQLite? → **duplicate, discard**

### Step 4 — Record the income

1. `generarSiguienteNPedido()`: SQLite increments the sequence and returns `LG-XXX` (zero-padded to 3 digits: `LG-007`)
2. Append to `Ingresos transacciones!A:I` with retry (4 attempts, backoff 1s→4s, only on 429/5xx)
3. `guardarTransaccion` in SQLite: `messageId ↔ nPedido, filaIngreso, referenciaPago`
4. Transaction stays **open** in memory (`transaccionActualPorChat`)
5. A **4h fallback timer** is scheduled: if no other receipt arrives within 4h, close the transaction anyway

### Step 5 — Closing the transaction (sales)

Happens when the **next receipt arrives** (or the 4h timer, or a reply):
1. Takes all accumulated context from the chat
2. `extraerDatosCliente` → OpenAI **Prompt B** (name, email, phone, municipality, vendor) + **local parser** for products (`luxurygotti.data.ts`: watch brands, combos, quantities like `x2`)
3. If the transaction has no Ventas row yet → `escribirFilaVenta` (append)
4. If it does → `mergeFilaVenta`: reads the current row and fills only empty fields (never overwrites existing data)
5. Context is cleared and the transaction marked closed

**Real example of a day in the group:**

```
10:00 [photo Nequi receipt $420.000]     → LG-001 created in Ingresos. LG-001 left OPEN
10:01 "vendido por Karol"                → context: [vendido por Karol]
10:05 [photo handwritten order sheet]    → context: [vendido por Karol, Yenci Perez... 3 CASIO]
12:30 [photo Bancolombia receipt]        → 1) CLOSES LG-001: writes Ventas row
                                            (customer Yenci, 3 watches, vendor KAROL)
                                         → 2) Processes new receipt → LG-002 left OPEN
```

---

## 5. Chat context (the most important concept)

- An **in-memory Map**: `chatId → list of {texto, timestamp}`
- Default TTL **4 hours** (`TIEMPO_TTL_CONTEXTO`). Old items pruned on read
- Receives: texts without reply, OCR text of non-receipt images
- Consumed: when closing a transaction (Prompt B) and as Prompt A context (truncated to 300 chars)
- **Lost on bot restart** (RAM, not disk)

---

## 6. Replies: corrections and late data

The bot lets you "talk to" a receipt by replying to it:

| Case | Behavior |
|------|----------|
| Reply to the **open** receipt's message | Text accumulates into context + immediate attempt to write/merge the sale |
| Reply with `tipo: X` or `vendedor: X` | Direct correction of the Ingresos row (columns C or I) |
| Late reply to an already-closed receipt | Looks up SQLite by `messageId` → writes/merges the sale anyway (nothing lost) |
| Any other reply | Accumulates into context |

---

## 7. Background jobs

| When | What | Where |
|------|------|-------|
| Every 1h | Log summary of OpenAI token usage | `index.ts` |
| Midnight + every 24h | `clasificarPedidosDelDia`: reviews TODAY's income rows and decides whether each order is *wholesale* (≥3 units or ≥$250.000) or *retail*, overwriting column D in Sheets | `classifier.service.ts` |
| Startup | Checks npm for a newer Baileys version (logs only) | `whatsapp.service.ts` |
| Per transaction | Fallback closing timer (4h inactivity) | `message.controller.ts` |

**Classifier detail:** if the order already has a Ventas row, it uses summed quantities
(`relojes + otros`); otherwise the price. Only updates if the value changed (to avoid rewriting
Sheets unnecessarily).

---

## 8. Where every piece of state lives

| State | Place | Persistent | Lost on restart |
|-------|-------|------------|-----------------|
| Chat context | RAM (`Map` in controller) | No | **Yes** |
| Open transaction per chat | RAM | No | **Yes** |
| Per-chat queues / 4h timers | RAM | No | **Yes** |
| History `messageId → nPedido, filaVenta` | SQLite `bot_memory.db` (`historial_transacciones`, FIFO max 300) | Yes | No |
| LG order sequence | SQLite (`secuencia_pedidos`) | Yes | No |
| Ingresos & Ventas | **Google Sheets** (source of truth) | Yes | No |
| WhatsApp session | `./auth_info` folder (Multi-Device files) | Yes | No |

**Important consequence of RAM state:** if the bot restarts with an open transaction, the
accumulated context is lost and the transaction becomes orphaned (row in Ingresos without a row
in Ventas — until a late reply rescues it or the nightly classifier reclassifies it by price).

---

## 9. File map

| File | Lines | Role |
|------|-------|------|
| `src/index.ts` | 84 | Startup, sequence sync, cron jobs, graceful shutdown |
| `src/services/whatsapp.service.ts` | 320 | Baileys connection, QR, backoff reconnection, group filter, image download |
| `src/controllers/message.controller.ts` | 400 | **The brain**: queues, context, transactions, full pipeline |
| `src/services/sheets.service.ts` | 340 | All Google Sheets access (append, merge, update, reads) |
| `src/services/memory.service.ts` | 154 | SQLite: transaction history + LG sequence |
| `src/services/ai.service.ts` | 148 | OpenAI calls (Prompts A and B) + sharp optimization |
| `src/services/vision.service.ts` | 138 | OCR: tesseract (local) → TrOCR fallback (handwriting) |
| `src/services/classifier.service.ts` | 59 | Nightly wholesale/retail classification |
| `src/utils/helpers.ts` | 208 | Pure functions: dates, retry, vendor regex, garbage filter, bank-by-color |
| `src/utils/prompts.ts` | 42 | The two OpenAI prompts (accounting and customer) |
| `src/utils/luxurygotti.data.ts` | 171 | Local product parser: watch brands, combos, quantities |
| `src/utils/colombia.data.ts` | 1128 | Municipality → department dictionary (~1120 municipalities) |
| `src/utils/config.data.ts` | 4 | **Business config**: income/abono accounts, known vendors |
| `src/utils/logger.ts` | 54 | Leveled logger + token counter |
| `src/types.ts` | 57 | Shared types |
| `spec.md` | 540 | Original project spec (design source of truth, Spanish) |
| `docs/adr/0001-migrar-a-baileys.md` | — | Decision: why we migrated from whatsapp-web.js to Baileys |
| `docs/adr/0002-language-policy.md` | — | Decision: English public / Spanish private language split |

---

## 10. Configuration (`.env`)

| Variable | Default | Meaning |
|----------|---------|---------|
| `OPENAI_API_KEY` | — | OpenAI key |
| `OPENAI_MODEL` | `gpt-4o-mini` | Model for Prompts A and B |
| `GOOGLE_SHEETS_ID` | — | Spreadsheet ID |
| `SHEETS_VENTAS_NOMBRE` | `Ventas` | Sales tab name |
| `GRUPO_AUTORIZADO` | `Contabilidad` | Authorized group name(s), comma-separated |
| `TIEMPO_TTL_CONTEXTO` | `14400000` (4h) | Context item lifetime, ms |
| `TIEMPO_CIERRE_RESPALDO` | `14400000` (4h) | Max inactivity before closing a transaction, ms |
| `LOG_LEVEL` | `INFO` | `ERROR`/`WARN`/`INFO`/`DEBUG` |
| `LOG_BAILEYS` | — | `info` to see internal Baileys logs |

---

## 11. Known weak points and technical debt

1. **Volatile RAM state** — context and open transactions are lost on restart (§8). If the bot
   dies with open transactions, those sales never get written except via late reply.
2. **Double write without transaction** — `generarSiguienteNPedido()` increments SQLite *before*
   the Sheets append. If the append ultimately fails, the LG number is burned (sequence gap).
3. **Retry without idempotency** — if the Sheets append responds late but did insert, the retry
   can create a duplicate row.
4. **Receipt validation depends on OpenAI** — a false positive from `esComprobanteValido` writes
   an Ingresos row nobody reviews (no deletion, no alert).
5. **Limited duplicate detection** — exact `referenciaPago` match only; different formatting
   (spaces, dashes) slips through.
6. **`colombia.data.ts` hardcoded** (1128 lines) — any new municipality requires a code change.
7. **`config.data.ts` holds real business accounts** — changing bank accounts requires editing
   code (no external config).
8. **Classifier overwrites column D** — if OpenAI wrote a custom description, midnight erases it.
9. **Zero tests** — `npm test` doesn't exist. All pure logic (helpers, classifiers, product
   parser) is testable and isn't.
10. **Mixed-language identifiers/comments** — cosmetic but harder to read.

---

## 12. Glossary

| Term | Meaning |
|------|---------|
| **N.Pedido / LG-XXX** | Sequential order identifier. `LG-` + zero-padded 3-digit number |
| **Comprobante** | Photo of a transfer receipt (Nequi, Bancolombia, Davivienda, Daviplata) |
| **Prompt A** | OpenAI call extracting receipt data (accounting) |
| **Prompt B** | OpenAI call extracting customer data (sales) |
| **Contexto (context)** | In-memory record of what was said in the chat (4h TTL) |
| **Open/pending transaction** | Order recorded in Ingresos still awaiting its sales data |
| **Closing** | Moment when accumulated context becomes a Ventas row |
| **Sales merge** | Fill only empty fields of an existing Ventas row |
| **Abono** | Transfer to abono accounts (`CUENTAS_ABONO`) — partial payments |
| **Ingreso** | Transfer to income accounts (`CUENTAS_INGRESO`) |
| **Fallback closing** | 4h timer that closes a transaction if no other receipt arrives |
| **Late reply** | Reply to an old receipt; resolved via SQLite |
| **Classifier** | Nightly job marking each daily order wholesale/retail |
| **TrOCR** | Local handwriting OCR model (tesseract fallback) |
| **FIFO 300** | SQLite history deletes oldest records beyond 300 entries |
