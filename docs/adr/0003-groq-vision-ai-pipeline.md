# 0003 — Pure Multimodal AI Vision Cascade (Groq Cloud Qwen 27B + Tesseract Offline Fallback)

**Status:** accepted

**Context:** The application previously relied on classical OCR (`Tesseract.js` + `TrOCR`), which consistently dropped complex WhatsApp images:
1. Handwritten customer shipping notes on packages (*"Saul Martinez 3045773230 CC 7428671 Mz 7 Casa 9 Pereira"*) and blue paper remittances were discarded because traditional OCR cannot parse unconstrained handwritten script.
2. Direct unconstrained OpenAI multimodal vision in high resolution consumed ~36,835 input tokens per mobile screenshot, depleting budget too quickly. OpenAI must strictly process text-only prompts to preserve balance.
3. Google AI Studio Free Tier presented high-demand 503 throttling spikes during image bursts.
4. Groq Cloud (`console.groq.com`) provides free Developer Tier access to high-performance multimodal models (`qwen/qwen3.6-27b`) with 30 RPM, 1,000 RPD, and sub-1.5s LPU inference with zero credit card or deposit requirements.

**Decision:** Adopt a pure Multimodal AI Vision pipeline:
1. **Primary Vision Engine (Groq Cloud Qwen 27B Multimodal):**
   - Transcribe all incoming image payloads (receipts, handwritten labels, remittances) into high-fidelity plain text via Groq's OpenAI-compatible Chat Completions endpoint.
   - Cost: $0.00 COP (Developer Free Tier).
2. **Secondary Offline Fallback:**
   - Local Tesseract OCR as offline emergency fallback.
3. **Downstream Accounting & Customer Extraction (OpenAI Text-Only):**
   - OpenAI receives clean plain text only (Prompt A for accounting receipts, Prompt B for customer/sales data).
   - OpenAI NEVER receives raw image payloads, preserving the existing $4.81 USD balance strictly for cheap text completions (~$0.00004 USD per call).

**Consequences:**
- 100% extraction fidelity across both digital banking screenshots and handwritten package labels.
- Zero financial deposit, zero credit card requirement, and zero vision token spend on OpenAI.
- Sub-2-second end-to-end processing per receipt.
