# Luxury Gotti WhatsApp Accounting Bot

An automated event-driven bookkeeping bridge that captures bank payment receipts from WhatsApp, extracts financial and customer data via OCR/multimodal LLMs, and records two-way reconciled income and sales entries into Google Sheets.

## Language

### Financial Transactions

**Receipt (`Comprobante`)**:
A digital image or screenshot of a Colombian bank transfer (Nequi, Bancolombia, Davivienda, Daviplata) representing an incoming payment.
_Avoid_: Invoice, bill, check, voucher

**Income Entry (`Ingreso`)**:
A confirmed financial credit to Luxury Gotti's primary business accounts, categorized as regular revenue.
_Avoid_: Revenue, earning, deposit

**Advance Payment (`Abono`)**:
An installment, down payment, or reservation transfer made to designated advance accounts.
_Avoid_: Down payment, credit, partial refund

**Order Identifier (`N.Pedido` / `LG-XXX`)**:
The canonical sequential identifier (e.g., `LG-001`) assigned to each financial transaction, creating a strict 1-to-1 link between an Income record and a Sales record.
_Avoid_: Tracking number, invoice ID, reference code

### Chat & Processing State

**Chat Context (`Contexto`)**:
The ephemeral accumulation of plain text messages and non-financial OCR data (customer name, phone, city, watch models, quantities) sent between receipts.
_Avoid_: Chat history, message log, buffer

**Open Transaction (`Transacción Abierta`)**:
An Income entry registered in the system that is actively holding state in memory while awaiting associated customer and product details before closing.
_Avoid_: Pending order, unfinished sale

**Sales Enrichment (`Completar Venta` / `Rellenar Campos`)**:
The non-destructive operation of populating blank customer and product cells in an existing sales record as late data arrives, without overwriting previously confirmed fields.
_Avoid_: Sales merge, overwrite, replace, upsert

**Order Classification (`Mayor vs. Menor`)**:
An automated business rule classifying an order as wholesale (`al por mayor`) if total quantity ≥ 3 items or total price ≥ $250,000 COP; otherwise retail (`al por menor`).
_Avoid_: Bulk order, regular sale
