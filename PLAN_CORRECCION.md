# ✅ TODO Checklist — Correcciones Bot WhatsApp Luxury Gotti

**Estado global:** `⬜ NO INICIADO` · `🔄 EN PROGRESO` · `✅ COMPLETADO` · `❌ BLOQUEADO`

---

## Arquitectura Objetivo

```
IMAGEN LLEGA
  ├─ OCR local (Tesseract) — 0 tokens
  ├─ ¿Datos financieros?
  │   ├─ SÍ → OpenAI → Ingresos transacciones → SQLite → "✅ LG-XX"
  │   │        → Abre ventana activa ±60s → vacía buffer como contexto
  │   └─ NO → Descartada (0 tokens)
  └─ REPLY → asociar directo a transacción citada

TEXTO LLEGA
  ├─ REPLY → directo a transacción/imagen citada
  ├─ ¿Ventana activa? → asociar a esa transacción
  │   ├─ "venta X" → contexto vendedor
  │   ├─ nombre/producto → acumular para Ventas
  │   └─ otro → contexto genérico
  └─ No ventana → buffer (cola de revisión)

VENTANA ACTIVA: se abre al procesar imagen válida, se cierra al llegar
  la siguiente imagen de transacción. Duración ±60s.

HOJA VENTAS: se escribe cuando hay nombre de cliente + al menos un producto.
  Sin "imágenes de cliente" (se descartan si no son comprobantes).
```

---

## FASE 1 — Independientes (orden arbitrario)

| Estado | # | Tarea | Archivo | Estimado |
|--------|---|-------|---------|----------|
| `✅` | **3** | Ingresos clasificados como Egresos: cambiar default "Egreso" → "Ingreso" en Prompt A | `src/utils/prompts.ts` | 10 min |
| `✅` | **9** | Cantidad relojes/otros incorrecta: mejorar `extraerCantidad()` para no confundir precios (ej. "60.000") con cantidades | `src/utils/luxurygotti.data.ts` | 20 min |
| `✅` | **12** | Logger estructurado con niveles, contador acumulativo de tokens, resumen periódico | `src/utils/logger.ts` (CREAR) + `index.ts`, `whatsapp.service.ts` | 20 min |

---

## FASE 2 — Re-arquitectura Core (requiere FASE 1)

| Estado | # | Tarea | Archivo | Estimado |
|--------|---|-------|---------|----------|
| `✅` | **Core** | Reescribir `procesarMensajeEntrante()` y `iniciarCronometro()` — eliminar Caja, implementar nuevo flujo | `src/controllers/message.controller.ts` | 2-3 hrs |
| `✅` | └─ **6** | ~~Timer no distingue útil/ruido~~ → IRRELEVANTE (no hay timer) | message.controller.ts | — |
| `✅` | └─ **7** | ~~Asociación entre mensajes~~ → RESUELTO (ventana activa + buffer + reply) | message.controller.ts | — |
| `✅` | └─ **8** | ~~Flujo manual (orden imágenes→texto)~~ → RESUELTO (buffer acumula cualquier orden) | message.controller.ts | — |
| `✅` | └─ **10** | ~~Doble procesamiento de imágenes (tokens ×2)~~ → IRRELEVANTE (OCR local filtra antes de AI) | message.controller.ts | — |
| `✅` | └─ **1** | Reply en caliente: reply a imagen en ventana activa → asociación directa. Reply a imagen en DB → reply tardío | message.controller.ts | — |
| `✅` | └─ **4** | ~~Texto "Venta Evelin..." va a Ventas~~ → RESUELTO (ventana activa asocia como contexto de comprobante) | message.controller.ts | — |
| `✅` | └─ **5** | Transacciones duplicadas: verificar `referenciaDePago` en DB antes de escribir | `memory.service.ts` + `message.controller.ts` | — |
| `✅` | **2** | Fecha en Ventas: activa window closure usa fecha transacción. Reply tardío sigue con hoy (requiere guardar fecha en DB) | `message.controller.ts` | 10 min |
| `✅` | **—** | Módulo memoria: `buscarTransaccionPorReferencia()`, columna `referenciaPago` en DB | `src/services/memory.service.ts` | — |
| `✅` | **—** | Sheets: migrar console.log → logger, asegurar que recibe fecha correcta | `src/services/sheets.service.ts` | — |

---

## FASE 3 — Pruebas y Ajustes (requiere FASE 2)

| Estado | # | Tarea | Archivo | Estimado |
|--------|---|-------|---------|----------|
| `⬜` | **T1** | Prueba: imagen de comprobante sola → OCR → AI → Ingresos → confirmación | manual | — |
| `⬜` | **T2** | Prueba: texto antes + imagen → buffer vacía como contexto | manual | — |
| `⬜` | **T3** | Prueba: imagen + texto después (ventana activa) → texto asociado | manual | — |
| `⬜` | **T4** | Prueba: Texto + Imagen + Texto + Texto → asignación correcta | manual | — |
| `⬜` | **T5** | Prueba: múltiples imágenes sin textos → cada una independiente | manual | — |
| `⬜` | **T6** | Prueba: REPLY a imagen → asociación directa a transacción citada | manual | — |
| `⬜` | **T7** | Prueba: imagen no-financiera (catálogo) → OCR sin datos → descartada, 0 tokens | manual | — |
| `⬜` | **T8** | Prueba: misma referencia en dos imágenes → segunda detecta duplicado → salta | manual | — |
| `⬜` | **T9** | Prueba: texto fuera de ventana activa → buffer de revisión | manual | — |
| `⬜` | **T10** | Prueba: "Venta Evelin" dentro de ventana → vendedor correcto en Ingresos | manual | — |
| `⬜` | **—** | Ajustes finos: duración óptima de ventana activa, manejo de cola de revisión | message.controller.ts | 30 min |

---

## Archivos del Proyecto

### Crear
- [x] `src/utils/logger.ts`

### Reescribir
- [x] `src/controllers/message.controller.ts`

### Modificar
- [x] `src/utils/prompts.ts`
- [x] `src/utils/luxurygotti.data.ts`
- [x] `src/services/memory.service.ts`
- [x] `src/services/ai.service.ts`
- [x] `src/services/sheets.service.ts`
- [x] `src/index.ts`
- [x] `src/services/whatsapp.service.ts`

### Sin cambios
- `src/services/vision.service.ts`
- `src/utils/helpers.ts`
- `src/utils/colombia.data.ts`
