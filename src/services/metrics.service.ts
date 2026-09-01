import * as http from 'node:http';
import { Registry, collectDefaultMetrics, Gauge, Counter, Histogram } from 'prom-client';
import { logger } from '../utils/logger';

export const register = new Registry();

// Collect standard Node.js runtime metrics (heap, cpu, event loop lag, gc)
collectDefaultMetrics({ register, prefix: 'bot_' });

// ── Custom Business Metrics ──────────────────────────────────

/**
 * WhatsApp WebSocket connection state:
 *  1 = Connected & listening (Open)
 *  0 = Disconnected / Reconnecting / Handshake
 * -1 = Session Revoked / Requires QR Code Re-scan
 */
export const whatsappConnectionGauge = new Gauge({
    name: 'bot_whatsapp_connection_state',
    help: 'State of WhatsApp Baileys connection: 1=connected, 0=disconnected, -1=session revoked/needs QR',
    registers: [register],
});
whatsappConnectionGauge.set(0);

/**
 * Google Sheets read/write operations and error counters.
 */
export const sheetsOperationsCounter = new Counter({
    name: 'bot_sheets_operations_total',
    help: 'Total count of Google Sheets API operations',
    labelNames: ['operation', 'status'],
    registers: [register],
});

/**
 * Processed WhatsApp message counter by message category and outcome.
 */
export const messagesProcessedCounter = new Counter({
    name: 'bot_messages_processed_total',
    help: 'Total messages processed by the message controller',
    labelNames: ['type', 'status'],
    registers: [register],
});

/**
 * OpenAI token usage counter.
 */
export const openaiTokensCounter = new Counter({
    name: 'bot_openai_tokens_total',
    help: 'Total OpenAI tokens consumed by prompt and completion',
    labelNames: ['type'],
    registers: [register],
});

/**
 * OpenAI API response latency histogram.
 */
export const openaiDurationHistogram = new Histogram({
    name: 'bot_openai_duration_seconds',
    help: 'Duration of OpenAI API completion requests in seconds',
    labelNames: ['prompt_type'],
    buckets: [0.2, 0.5, 1, 2, 5, 10, 20],
    registers: [register],
});

// ── Metric Helper Functions ──────────────────────────────────

let currentWhatsAppState: number = 0;

export function setWhatsAppConnectionMetric(state: 1 | 0 | -1): void {
    currentWhatsAppState = state;
    whatsappConnectionGauge.set(state);
}

export function getWhatsAppConnectionState(): number {
    return currentWhatsAppState;
}

export function recordSheetsOperation(operation: string, status: 'success' | 'error'): void {
    sheetsOperationsCounter.inc({ operation, status });
}

export function recordMessageProcessed(type: 'receipt' | 'text' | 'reply' | 'other', status: 'processed' | 'ignored' | 'duplicate' | 'error'): void {
    messagesProcessedCounter.inc({ type, status });
}

export function recordOpenAiTokens(promptTokens: number, completionTokens: number): void {
    if (promptTokens > 0) openaiTokensCounter.inc({ type: 'prompt' }, promptTokens);
    if (completionTokens > 0) openaiTokensCounter.inc({ type: 'completion' }, completionTokens);
}

export function startOpenAiTimer(promptType: 'PromptA' | 'PromptB' | 'Classifier'): () => void {
    const end = openaiDurationHistogram.startTimer({ prompt_type: promptType });
    return end;
}

// ── HTTP Metrics & Health Server ──────────────────────────────

let metricsServer: http.Server | null = null;

export function createMetricsServer(): http.Server {
    return http.createServer(async (req, res) => {
        const url = req.url?.split('?')[0];

        if (req.method === 'GET' && url === '/metrics') {
            try {
                const metrics = await register.metrics();
                res.writeHead(200, { 'Content-Type': register.contentType });
                res.end(metrics);
            } catch (err) {
                res.writeHead(500, { 'Content-Type': 'text/plain' });
                res.end('Error generating Prometheus metrics');
            }
            return;
        }

        if (req.method === 'GET' && (url === '/health' || url === '/healthz')) {
            const isHealthy = currentWhatsAppState !== -1;
            const payload = {
                status: isHealthy ? 'ok' : 'degraded',
                uptimeSeconds: Math.floor(process.uptime()),
                whatsappConnectionState: currentWhatsAppState,
                timestamp: new Date().toISOString(),
            };
            res.writeHead(isHealthy ? 200 : 503, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(payload));
            return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not Found');
    });
}

export function startMetricsServer(port?: number): Promise<http.Server> {
    const targetPort = port !== undefined ? port : (Number(process.env.METRICS_PORT) || 9090);

    return new Promise((resolve) => {
        if (metricsServer) {
            resolve(metricsServer);
            return;
        }

        const server = createMetricsServer();
        server.listen(targetPort, () => {
            logger.info('METRICS', `Metrics & Health HTTP server listening on port ${targetPort} (/metrics, /health)`);
            metricsServer = server;
            resolve(server);
        });
    });
}

export function stopMetricsServer(): Promise<void> {
    return new Promise((resolve) => {
        if (!metricsServer) {
            resolve();
            return;
        }

        metricsServer.close(() => {
            logger.info('METRICS', 'Metrics HTTP server closed');
            metricsServer = null;
            resolve();
        });
    });
}
