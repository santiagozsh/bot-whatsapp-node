# Plan de Implementación — V2.0 Bot Luxury Gotti
> Actualizado: 24 de junio de 2026 — v5. Arquitectura "Caja Dual" (sin ventana secundaria).

---

## Resumen ejecutivo

La caja actual ya resuelve el problema de secuencia: **el timer se reinicia con cada
mensaje nuevo**. Mientras sigan llegando mensajes, la caja permanece abierta.
Cuando hay silencio, cierra y procesa todo.

V2.0 **no agrega un segundo reloj**. Solo evoluciona la caja existente para que al
cerrar procese **dos hojas en paralelo**:

1. **Ingresos transacciones** → cada imagen de comprobante
2. **Ventas** → datos del cliente asociados a la **última imagen** (LIFO)

El Reply + SQLite sigue existiendo como mecanismo de corrección tardía (para cuando
los datos del cliente llegan después de que la caja ya cerró).

---

## 1. El problema que resuelve la Caja Dual

### Secuencias reales que debe manejar

```
CASO A — Lo normal:
[pago]  [datos cliente]  [compra]  — silencio → cierra → procesa todo ✅

CASO B — Varias transacciones seguidas:
[pago1] [pago2]  [datos cliente + compra]  — silencio → cierra
→ pago1 → Ingresos transacciones
→ pago2 → Ingresos transacciones
→ datos cliente → Ventas (asociados a pago2, el último) ✅

CASO C — Datos antes que el pago:
[datos cliente] [compra] [pago]  — silencio → cierra
→ pago → Ingresos transacciones
→ datos + compra (sala de espera) → Ventas (asociados al único pago) ✅

CASO D — Datos tardíos (caja ya cerró):
[pago] → caja cierra y procesa
... 20 minutos después ...
[Reply a la foto del pago con datos del cliente]
→ SQLite lookup → merge en Ventas ✅
```

---

## 2. La Caja Evolucionada

### Timer: de 15 seg a configurable (default 5 min)

El timer se reinicia con **cada mensaje nuevo** (imagen o texto).
La caja cierra cuando hay **silencio** durante el tiempo configurado.

```env
TIEMPO_ESPERA_CAJA=300000   # 5 minutos en milisegundos (ajustable)
```

> [!NOTE]
> 5 minutos cubre la mayoría de casos reales donde el cliente manda el comprobante
> y un rato después manda los datos del cliente. Para datos que llegan 20-30 min
> después, el mecanismo de Reply (§4) resuelve el caso sin problema.

### Estructura de la caja (evolución de la actual)

```typescript
interface ImagenCaja {
    id: string;            // messageId del comprobante
    base64: string;
    mimeType: string;
    textosEspecificos: string[];   // textos asociados por Reply o LIFO
    imagenesCliente: string[];     // imágenes adicionales (datos de cliente por OCR)
}

interface CajaRecoleccion {
    imagenes: ImagenCaja[];         // comprobantes de pago
    textosPrevios: string[];        // sala de espera (textos antes de cualquier imagen)
    imagenesPrevias: string[];      // imágenes de cliente que llegan antes del comprobante
    cronometro: NodeJS.Timeout;
}
```

### Regla de asociación (LIFO extendida)

| Qué llega | Cuándo | Va a... |
|---|---|---|
| Imagen JPG/PNG | Siempre | Portero evalúa: ¿es comprobante? → `imagenes[]` |
| Texto | Antes de cualquier imagen | `textosPrevios[]` (sala de espera) |
| Texto | Después de al menos una imagen | Último elemento de `imagenes[]` (LIFO) |
| Imagen adicional (no comprobante) | Después de imágenes | `imagenesCliente[]` del último pago (LIFO) |

> El "portero" ya descarta stickers/video/audio/webp antes de evaluar nada.

---

## 3. Flujo al cierre de la caja

Cuando el timer expira (silencio durante `TIEMPO_ESPERA_CAJA`):

```
══════════════════════════════════════════════════════════════
PROCESAMIENTO AL CIERRE
══════════════════════════════════════════════════════════════

Para CADA imagen de comprobante en cajaCerrada.imagenes[]:

    PASO 1 — Sharp: comprime
    PASO 2 — Tesseract OCR: extrae texto
    PASO 3 — OpenAI [Prompt Pago]:
              texto OCR + textosEspecificos[] de ESA imagen
              → JSON: { esComprobanteValido, fecha, tipo, precio,
                        medioDePago, referencia, cuentaDestino, vendedor }
    PASO 4 — ¿esComprobanteValido? No → descarta esta imagen
    PASO 5 — Escribe fila en "Ingresos transacciones"
    PASO 6 — Guarda en SQLite: { messageId → nPedido, filaIngreso }
    PASO 7 — Espera 4 seg (escudo anti-rate-limit) si quedan más imágenes

──────────────────────────────────────────────────────────────
DESPUÉS de procesar todos los comprobantes:

¿Hay textosPrevios[] O la última imagen tiene textosEspecificos[] con datos de cliente?

    → Tomar la ÚLTIMA imagen válida de la caja (LIFO)
    → Recopilar:
        - Sus textosEspecificos[]
        - Sus imagenesCliente[] (cada una pasa por OCR)
        - cajaCerrada.textosPrevios[] (sala de espera)
    → Unir todo en un bloque de texto
    → OpenAI [Prompt Cliente]: extrae JSON del cliente
    → Diccionario Colombia: municipio → departamento (local, sin IA)
    → Escribe fila en "Ventas" con el N.Pedido de la última transacción
    → Actualiza SQLite: { filaVenta }

══════════════════════════════════════════════════════════════
En Sandbox:
    ✅ LG-26 | $165.000 Nequi | Karol
    👤 LG-26 | Mateo Bedoya | Armenia, Quindío
══════════════════════════════════════════════════════════════
```

---

## 4. Reply como mecanismo de corrección tardía

Para cuando los datos llegan **después de que la caja ya cerró**:

```
[Reply a la foto del comprobante]
    → ¿quotedMessageId en SQLite? No → ignora silenciosamente
    → Sí → busca N.Pedido y filaIngreso
        → ¿Es imagen? → OCR primero
        → OpenAI [Prompt Cliente] con el texto del Reply
        → MERGE en Ventas (solo llena campos que están en "N/A" o 0)
        → En Sandbox: "🔄 LG-26 actualizado"
```

**Merge:** Nunca se pisan datos ya correctos. Solo se rellenan campos vacíos.

---

## 5. Reconocimiento de imagen de cliente vs. comprobante de pago

Cuando llega una imagen adicional dentro de la caja (después de que ya hay un
comprobante), el portero necesita decidir si es otro comprobante o datos del cliente.

**Estrategia:** OCR primero, luego el Prompt de Pago decide con `esComprobanteValido`.

- Si `esComprobanteValido: true` → nueva entrada en `imagenes[]`
- Si `esComprobanteValido: false` → va a `imagenesCliente[]` del último pago

Esto reutiliza el pipeline existente sin agregar un clasificador nuevo.

---

## 6. Hoja "Ventas" — Estructura

| Col | Campo | Regla |
|---|---|---|
| A | N.Pedido | Vínculo con Ingresos transacciones |
| B | Fecha | Copiada de la transacción |
| C | Nombre cliente | Extraído del bloque acumulado |
| D | Email | Extraído del bloque acumulado |
| E | Teléfono | Extraído del bloque acumulado |
| F | Ubicación Municipio | Extraído o deducido de dirección |
| G | Departamento | Diccionario local Colombia (sin IA) |
| H | Producto | Texto libre de lo que se vendió |
| I | Cantidad Relojes | Entero. `0` si no aparece |
| J | Otros | Entero de no-relojes. `0` si no aparece |

- Campos de texto no encontrados → `"N/A"`
- Campos de cantidad no encontrados → `0`
- Hoja nueva vacía cada mes (nombre configurable por env var `SHEETS_VENTAS_NOMBRE`)

---

## 7. SQLite — Solo para Reply

```sql
CREATE TABLE historial_transacciones (
    messageId    TEXT PRIMARY KEY,
    nPedido      TEXT NOT NULL,
    filaIngreso  INTEGER NOT NULL,
    filaVenta    INTEGER,           -- NULL hasta que se registre en Ventas
    fechaRegistro TEXT NOT NULL
);
```

- **FIFO:** máximo 300 registros (~8-9 días con 35 tx/día)
- **Sin columna extra en Sheets** — el mapping vive solo en SQLite
- **Consulta manual:** `sqlite3 bot_memory.db "SELECT * FROM historial_transacciones ORDER BY fechaRegistro DESC LIMIT 10;"`

---

## 8. Prompts — Dos especializados

**Prompt A — Extractor de pago** (igual a V1.0, refinado)
- Input: texto OCR + textos específicos de esa imagen
- Output: `{ esComprobanteValido, fecha, tipo, precioCompra, medioDePago, referenciaDePago, cuentaDestino, vendedor }`
- ~400-600 tokens

**Prompt B — Extractor de cliente** (nuevo)
- Input: bloque unificado de todo lo acumulado para la última transacción
- Output: `{ nombreCliente, email, telefono, municipio, producto, cantidadRelojes, cantidadOtros }`
- ~300-500 tokens
- El departamento lo deduce el diccionario local, no la IA

### Tokens por transacción completa

| Evento | Tokens aprox. |
|---|---|
| Comprobante de pago | 400-600 |
| Datos de cliente (bloque al cierre) | 300-500 |
| Reply de corrección | 200-350 |
| **Transacción completa sin corrección** | **700-1.100** |
| Mensajes que no tienen caja abierta | **0** |

---

## 9. Diccionario Colombia — Local, sin IA

```typescript
// src/utils/colombia.data.ts
export function obtenerDepartamento(municipio: string): string {
    const clave = municipio.toUpperCase()
        .normalize("NFD").replace(/[\u0300-\u036f]/g, "");
    return MUNICIPIOS_COLOMBIA[clave] ?? "N/A";
}
```

~1120 municipios. Búsqueda determinística, cero tokens, cero latencia.

---

## 10. Respuestas del bot

| Grupo | Responde |
|---|---|
| `Contabilidad\| Empresa Luxury Gotti` (producción) | ❌ Nunca |
| `Contabilidad` (sandbox) | ✅ Sí |

Mensajes en Sandbox:
- `✅ LG-26 | $165.000 Nequi | Karol` — comprobante registrado
- `👤 LG-26 | Mateo Bedoya | Armenia, Quindío` — cliente registrado
- `⚠️ Imagen no reconocida como comprobante` — cuando OCR no detecta pago
- `🔄 LG-26 actualizado` — Reply tardío procesado

---

## 11. Archivos afectados

```
src/
├── controllers/
│   └── message.controller.ts     [MODIFICAR] — Caja Dual: timer extendido, LIFO para cliente,
│                                               Reply tardío, cierre con doble procesamiento
├── services/
│   ├── ai.service.ts             [MODIFICAR] — extraerDatosConIA() + nuevas extraerDatosCliente()
│   ├── sheets.service.ts         [MODIFICAR] — escribirFilaVenta() + mergeFilaVenta()
│   ├── whatsapp.service.ts       [MODIFICAR] — enviarMensaje() solo para sandbox
│   ├── vision.service.ts         [sin cambios]
│   └── memory.service.ts         [NUEVO] — SQLite wrapper, FIFO 300 registros
├── utils/
│   ├── prompts.ts                [MODIFICAR] — Prompt A (pago, refinado) + Prompt B (cliente)
│   ├── helpers.ts                [MODIFICAR] — normalizarTexto() para diccionario
│   └── colombia.data.ts          [NUEVO] — Diccionario nacional ~1120 municipios
```

**Nueva dependencia:**
```bash
npm install better-sqlite3
npm install @types/better-sqlite3 --save-dev
```

**Variable de entorno nueva:**
```env
TIEMPO_ESPERA_CAJA=300000        # 5 minutos (ajustable)
SHEETS_VENTAS_NOMBRE=Ventas      # Nombre de la pestaña activa
```

---

## 12. Lo que NO cambia de V1.0

- Portero: stickers, videos, audios, webp → descartados inmediatamente
- Sharp para compresión de imágenes
- Tesseract.js OCR (español + inglés)
- `gpt-4o-mini` como modelo
- Whitelist de grupos autorizados (hardcoded)
- Sistema de ID `LG-XX` autoincremental
- Escudo de 4 seg entre peticiones múltiples a APIs
- Monitor de RAM cada 60 seg
