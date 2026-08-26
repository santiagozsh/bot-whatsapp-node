# Luxury Gotti — WhatsApp Accounting Automation Bot

[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-blue.svg)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-20+-green.svg)](https://nodejs.org/)
[![Baileys](https://img.shields.io/badge/WhatsApp-Baileys%20v7-25D366.svg)](https://github.com/WhiskeySockets/Baileys)
[![OpenAI](https://img.shields.io/badge/AI-OpenAI%20GPT--4o--mini-412991.svg)](https://openai.com/)
[![SQLite](https://img.shields.io/badge/Database-better--sqlite3-003B57.svg)](https://github.com/WiseLibs/better-sqlite3)
[![Docker](https://img.shields.io/badge/Container-Docker-2496ED.svg)](https://www.docker.com/)

> **Production Case Study & Systems Showcase**  
> An event-driven automation bot that reconciles Colombian bank transfer receipts and unstructured customer order data from WhatsApp groups into Google Sheets in real time.

---

## 1. Executive Summary & Business Context

**Luxury Gotti** is a Colombian e-commerce and retail business specializing in brand-replica watches and accessories. Sales operations occur inside authorized WhatsApp groups where vendors continuously post:
1. Screenshots of bank transfer receipts (Nequi, Bancolombia, Daviplata, Davivienda).
2. Unstructured conversational messages with customer names, delivery addresses, phone numbers, and watch models.
3. Photos of handwritten order slips.

### The Operational Bottleneck
- **Manual Bookkeeping Lag:** Accounting staff had to manually inspect payment screenshots, verify amounts, assign sequential order numbers (`LG-XXX`), and transcribe customer delivery information across multiple spreadsheets.
- **Race Conditions & Data Detachment:** Payment confirmations and customer details rarely arrive in the same message. Information is fragmented across minutes or hours.
- **Financial Risk:** Duplicate payments and unlinked sales caused inventory discrepancies and reconciliation errors.

This project automates the entire ingestion, parsing, correlation, and persistence pipeline with zero human intervention.

---

## 2. System Architecture & Event Pipeline

The system is built as a single-process event loop running on Node.js/TypeScript, leveraging WebSocket connections, deterministic pre-filtering, OCR, multimodal LLMs, and multi-tier persistence.

```
                      ┌───────────────────────────────────────────────┐
                      │          WhatsApp Group Event Stream          │
                      └──────────────────────┬────────────────────────┘
                                             │
                                   [ Baileys WebSocket ]
                                             │
                                    ( Filter & Validate )
                                             │
                      ┌──────────────────────▼────────────────────────┐
                      │        Per-Chat Serial Async Queue            │
                      └──────────────────────┬────────────────────────┘
                                             │
               ┌─────────────────────────────┴─────────────────────────────┐
               │                                                           │
        [ Image Event ]                                             [ Text Event ]
               │                                                           │
    ( Sharp Preprocessing )                                                │
               │                                                           │
    ( Tesseract / TrOCR )                                                  │
               │                                                           │
   { Financial Keywords? }                                                 │
      ├── NO  ──► [ Accumulate OCR Text in Chat Context ] ◄────────────────┘
      └── YES ──► [ Process Bank Receipt ]
                        │
                        ├─► 1. Close Pending Previous Transaction (Prompt B)
                        │      └─► Populate Sales Tab (`Ventas`)
                        │
                        ├─► 2. Extract Receipt Data via Prompt A + Color Detection
                        │
                        ├─► 3. Generate Sequential `LG-XXX` Order ID (SQLite)
                        │
                        ├─► 4. Append to Income Tab (`Ingresos`) with Backoff Retry
                        │
                        └─► 5. Open New Active Transaction State (4h TTL Timer)
```

### End-to-End Pipeline Stages

1. **Ingestion & Filtering (`whatsapp.service.ts`):** Listens over raw WebSocket via `@whiskeysockets/baileys` v7. Filters out non-group events, unapproved group JIDs, self-messages, and unsupported media (stickers/webp).
2. **Per-Chat Serialization (`message.controller.ts`):** Incoming messages are routed into per-chat asynchronous promise chains to eliminate race conditions during concurrent message bursts.
3. **Deterministic Vision & OCR (`vision.service.ts`, `helpers.ts`):** Images are normalized and compressed via `sharp` (grayscale, 1200px), then evaluated by `tesseract.js` (`spa+eng`). If text density is low, a local Transformer fallback (`TrOCR`) processes handwritten text.
4. **Context Association Rule:** Text messages and non-financial data images arriving between receipt $N$ and receipt $N+1$ belong to receipt $N$.
5. **Deterministic & AI Enrichment (`ai.service.ts`, `luxurygotti.data.ts`, `colombia.data.ts`):**
   - **Bank Detection by Color:** Analyzes dominant pixel clusters (e.g., yellow/black $\rightarrow$ Bancolombia, magenta/purple $\rightarrow$ Nequi, red $\rightarrow$ Davivienda) to guarantee accuracy without relying on LLM vision tokens.
   - **Prompt A (Accounting Extraction):** Extracts amount, payment reference, and transaction date into structured JSON.
   - **Prompt B (Customer Extraction):** Extracts customer name, phone number, and municipality (mapped to Colombian departments via local dictionary).
   - **Product Parser:** Deterministically parses watch brand models, quantity multipliers (e.g., `x2`), and accessory combos locally.
6. **Dual Persistence (`sheets.service.ts`, `memory.service.ts`):**
   - **Google Sheets API:** The single source of truth for business reporting (`Ingresos transacciones` and `Ventas` sheets).
   - **SQLite (`bot_memory.db`):** Local state engine maintaining the global sequential counter (`LG-XXX`), idempotency deduplication indexes (`referenciaPago`), and message-to-row lookup maps.

---

## 3. Engineering Decisions & Failure Mode Mitigations

| Failure Mode / Challenge | Architectural Mitigation |
|--------------------------|--------------------------|
| **WhatsApp `@lid` Protocol Shift** | Migrated from Puppeteer/Chromium (`whatsapp-web.js`) to native WebSocket (`Baileys` v7), reducing memory footprint by ~300 MB and eliminating headless browser crashes (see [ADR 0001](docs/adr/0001-migrar-a-baileys.md)). |
| **Race Conditions on Message Bursts** | In-memory per-chat promise queues ensure sequential FIFO execution for every message in a given conversation. |
| **API Rate Limits (Google Sheets / OpenAI)** | Exponential backoff with jitter on Sheets API mutations (4 attempts, 1s $\rightarrow$ 4s delay). Read operations cache metadata locally. |
| **Duplicate Payment Submissions** | Strict SQLite unique index lookup on `referenciaDePago` prior to Google Sheets insertion. |
| **Late Customer Information Arrival** | WhatsApp quoted message (reply) handlers inspect SQLite history to perform non-destructive **Sales Enrichment** (`mergeFilaVenta`) on closed transactions. |
| **Graceful Process Termination** | `SIGINT` / `SIGTERM` handlers safely disconnect Baileys sockets, flush pending database writes, and close SQLite connections with a 5-second forced exit timeout. |

---

## 4. Platform & Operations (SRE Roadmap)

This repository serves as a live platform engineering showcase. Operational improvements are tracked systematically via GitHub Issues under the `platform:*` workstream:

- **Phase 0 — Containerization & Process Hygiene:** Multi-stage `Dockerfile`, `docker-compose.yml`, non-root container user, volume persistence for `auth_info/` and SQLite databases.
- **Phase 1 — CI/CD Automation:** GitHub Actions workflows executing typechecking, unit test suites for pure parsers ([Issue #24](https://github.com/santiagozsh/bot-whatsapp-node/issues/24)), and automated deployment scripts ([Issue #25](https://github.com/santiagozsh/bot-whatsapp-node/issues/25)).
- **Phase 2 — Observability & Alerting:** Automated daily backups with documented restore drills ([Issue #26](https://github.com/santiagozsh/bot-whatsapp-node/issues/26)), dead man's switch heartbeat monitoring ([Issue #27](https://github.com/santiagozsh/bot-whatsapp-node/issues/27)), and PM2/container log rotation ([Issue #28](https://github.com/santiagozsh/bot-whatsapp-node/issues/28)).
- **Phase 3 — Cloud & Infrastructure as Code:** Terraform-managed deployment on budget cloud VPS with automated snapshot routines.
- **Phase 4 & 5 — Lightweight Kubernetes & SRE Practices:** K3s deployment with GitOps, structured runbooks, and documented incident postmortems.

See [docs/roadmap.md](docs/roadmap.md) for full milestone details.

---

## 5. Technology Stack

- **Runtime & Language:** Node.js 20+ LTS, TypeScript 5.x (`commonjs` target)
- **WhatsApp Gateway:** `@whiskeysockets/baileys` v7 (WebSocket Multi-Device connection)
- **AI & Computer Vision:** OpenAI API (`gpt-4o-mini`), `tesseract.js` v7 (OCR), `@xenova/transformers` (TrOCR handwriting fallback), `sharp` (image processing)
- **State & Database:** `better-sqlite3` (synchronous, WAL-mode SQLite), Google Sheets API v4 via `googleapis`
- **Infrastructure:** Docker, Docker Compose, PM2 process supervisor

---

## 6. Repository Layout & Documentation Index

```
.
├── CONTEXT.md               # Ubiquitous domain language & business definitions
├── AGENTS.md                # Agent guidelines, safety rules & learning loop
├── Dockerfile               # Production container image definition
├── docker-compose.yml       # Container orchestration & persistent volume mapping
├── docs/
│   ├── architecture.md      # Comprehensive systems architecture & data flow
│   ├── roadmap.md           # Platform & SRE evolution roadmap (Phases 0–5)
│   ├── adr/                 # Architectural Decision Records (ADR 0001, ADR 0002)
│   └── internal/            # Private owner documentation (Spanish, gitignored)
├── src/
│   ├── index.ts             # Server entry point, cron jobs & graceful shutdown
│   ├── types.ts             # Shared domain & message interfaces
│   ├── controllers/
│   │   └── message.controller.ts  # Central event orchestrator & queue manager
│   ├── services/
│   │   ├── whatsapp.service.ts    # Baileys WebSocket client & auth state
│   │   ├── ai.service.ts          # OpenAI structured extraction (Prompts A & B)
│   │   ├── vision.service.ts      # Tesseract OCR & TrOCR fallback
│   │   ├── sheets.service.ts      # Google Sheets API client (CRUD & retries)
│   │   ├── memory.service.ts      # SQLite persistence (history & sequence)
│   │   └── classifier.service.ts  # Nightly wholesale/retail classifier
│   └── utils/
│       ├── helpers.ts             # Pure utility functions (regex, dates, colors)
│       ├── logger.ts              # Leveled logger with token tracking
│       ├── prompts.ts             # OpenAI system prompts (Spanish domain text)
│       ├── luxurygotti.data.ts    # Product catalog & quantity regex parser
│       └── colombia.data.ts       # Colombian municipalities dictionary
```

---

## 7. Configuration Reference

Environment configuration is managed through `.env`:

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | _required_ | OpenAI API Key for structured extraction |
| `OPENAI_MODEL` | `gpt-4o-mini` | LLM model used for receipt and customer extraction |
| `GOOGLE_SHEETS_ID` | _required_ | Target Google Spreadsheet ID |
| `SHEETS_VENTAS_NOMBRE` | `Ventas` | Name of the sales tab in the spreadsheet |
| `GRUPO_AUTORIZADO` | `Contabilidad` | Comma-separated list of authorized WhatsApp group names |
| `TIEMPO_TTL_CONTEXTO` | `14400000` (4h) | Ephemeral chat context item lifetime in milliseconds |
| `TIEMPO_CIERRE_RESPALDO` | `14400000` (4h) | Fallback transaction timeout before automatic closure |
| `LOG_LEVEL` | `INFO` | Logging verbosity (`DEBUG`, `INFO`, `WARN`, `ERROR`) |

---

## 8. License & Operational Notice

This software is custom production software engineered specifically for **Luxury Gotti**. Internal domain structures, prompts, and product catalogs reflect proprietary business workflows in Colombia.

Architectural decisions and platform practices are documented in the [`docs/`](docs/) directory.
