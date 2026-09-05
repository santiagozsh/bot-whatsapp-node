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

**Cash-on-Delivery Collection (`Recaudo Contraentrega` / `PAGOS CONTRAENTREGA`)**:
A plain-text cash inflow reported by sellers or delivery couriers reflecting collected cash from deliveries. Recorded as a standalone financial movement in `Ingresos transacciones` (`Tipo: Ingreso`, `Descripción: PAGOS CONTRAENTREGA`, `Medio de Pago: Efectivo`), without opening a chat context window or creating a row in `Ventas`.
_Avoid_: Cash sale, delivery invoice, physical receipt

**Cash-on-Delivery Clarification (`Aclaración Contraentrega`)**:
A textual indicator (via reply or active order context) specifying that an existing open or quoted order was dispatched under cash-on-delivery terms, updating its description in `Ingresos transacciones` to `PAGOS CONTRAENTREGA`.
_Avoid_: Order update, payment change

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
An automated business rule classifying an order as wholesale (`Pedido mayorista`) if total quantity ≥ 3 items or total price > $250,000 COP; otherwise retail (`Pedido al por menor`). Orders recorded or clarified as `PAGOS CONTRAENTREGA` are strictly inviolable and are never overwritten by this rule.
_Avoid_: Bulk order, regular sale, al por mayor

**Canonical Vendor (`Vendedor Canónico`)**:
A sales team member attributed to an Income record in strict uppercase (`JHON`, `EVELIN`, `KAROL`, `DAVID`), with `JHON` as the default fallback. Conversational diminutives and variations (e.g. `Eve`, `Jhoncito`, `Karolsita`, `Davidcito`, `VENTA-KAROL`) are deterministically normalized to their canonical uppercase names, while unrecognized names are preserved in uppercase.
_Avoid_: Lowercase vendor names, unmapped nicknames
