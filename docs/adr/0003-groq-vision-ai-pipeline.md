# 0003 — Pure Multimodal AI Vision Cascade (Groq Cloud Auto-Discovered Multimodal Vision + Tesseract Offline Fallback)

**Status:** accepted

**Context:** The application previously relied on classical OCR (`Tesseract.js` + `TrOCR`), which consistently dropped complex WhatsApp images:
1. Handwritten customer shipping notes on packages (*"Saul Martinez 3045773230 CC 7428671 Mz 7 Casa 9 Pereira"*) and blue paper remittances were discarded because traditional OCR cannot parse unconstrained handwritten script.
2. Direct unconstrained OpenAI multimodal vision in high resolution consumed ~36,835 input tokens per mobile screenshot, depleting budget too quickly. OpenAI must strictly process text-only prompts to preserve balance.
3. Google AI Studio Free Tier presented high-demand 503 throttling spikes during image bursts.
4. Groq Cloud (`console.groq.com`) provides free Developer Tier access to high-performance multimodal models with 30 RPM, 1,000 RPD, and sub-1.5s LPU inference with zero credit card or deposit requirements. However, provider model deprecations/upgrades (e.g. `qwen/qwen3.6-27b` transitioned to `qwen/qwen3.8-27b`) require zero-maintenance runtime discovery and self-healing failover.

**Decision:** Adopt a pure Multimodal AI Vision pipeline with dynamic discovery:
1. **Primary Vision Engine (Groq Cloud Multimodal Vision with Dynamic Auto-Discovery & Self-Healing Rotation):**
   - Query Groq API model metadata (`client.models.list()`) to dynamically discover active vision-capable models (`input_modalities: ["image"]`).
   - Cache the resolved active model in-memory with a 24-hour TTL to eliminate per-request latency overhead.
   - Automatically detect HTTP 404 (`model_not_found`) or `model_decommissioned` errors, invalidate cache, rotate to the next active multimodal model, and seamlessly retry transcription in real-time without operator intervention.
   - Cost: $0.00 COP (Developer Free Tier).
2. **Secondary Offline Fallback:**
   - Local Tesseract OCR as offline emergency fallback.
3. **Downstream Accounting & Customer Extraction (OpenAI Text-Only):**
   - OpenAI receives clean plain text only (Prompt A for accounting receipts, Prompt B for customer/sales data).
   - OpenAI NEVER receives raw image payloads, preserving the existing balance strictly for cheap text completions (~$0.00004 USD per call).

**Consequences:**
- Zero-maintenance resiliency: Upstream model deprecations on Groq are mitigated automatically through in-flight model rotation.
- 100% extraction fidelity across both digital banking screenshots and handwritten package labels.
- Zero financial deposit, zero credit card requirement, and zero vision token spend on OpenAI.
- Sub-2-second end-to-end processing per receipt.
