import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as http from 'node:http';
import type { AddressInfo } from 'node:net';
import {
    register,
    createMetricsServer,
    setWhatsAppConnectionMetric,
    getWhatsAppConnectionState,
    recordSheetsOperation,
    recordMessageProcessed,
    recordOpenAiTokens,
    startOpenAiTimer,
    startMetricsServer,
    stopMetricsServer,
} from '../../src/services/metrics.service';

describe('metrics.service.ts (Prometheus Metrics & Health Server)', () => {
    let server: http.Server;

    beforeEach(async () => {
        setWhatsAppConnectionMetric(0);
    });

    afterEach(async () => {
        if (server) {
            server.closeAllConnections?.();
            await new Promise<void>((resolve) => server.close(() => resolve()));
        }
        await stopMetricsServer();
    });

    it('updates WhatsApp connection gauge and getter', () => {
        expect(getWhatsAppConnectionState()).toBe(0);

        setWhatsAppConnectionMetric(1);
        expect(getWhatsAppConnectionState()).toBe(1);

        setWhatsAppConnectionMetric(-1);
        expect(getWhatsAppConnectionState()).toBe(-1);
    });

    it('records Sheets and Message metrics without errors', async () => {
        recordSheetsOperation('append_income', 'success');
        recordSheetsOperation('append_sales', 'error');
        recordMessageProcessed('receipt', 'processed');
        recordMessageProcessed('reply', 'ignored');
        recordOpenAiTokens(150, 50);

        const stopTimer = startOpenAiTimer('PromptA');
        stopTimer();

        const metricsOutput = await register.metrics();
        expect(metricsOutput).toContain('bot_sheets_operations_total');
        expect(metricsOutput).toContain('bot_messages_processed_total');
        expect(metricsOutput).toContain('bot_openai_tokens_total');
        expect(metricsOutput).toContain('bot_openai_duration_seconds');
    });

    it('responds with Prometheus metrics on GET /metrics', async () => {
        server = createMetricsServer();
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const port = (server.address() as AddressInfo).port;

        const response = await fetch(`http://127.0.0.1:${port}/metrics`);
        expect(response.status).toBe(200);
        expect(response.headers.get('content-type')).toContain('text/plain');

        const body = await response.text();
        expect(body).toContain('bot_whatsapp_connection_state');
    });

    it('responds with JSON health status on GET /health', async () => {
        server = createMetricsServer();
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const port = (server.address() as AddressInfo).port;

        setWhatsAppConnectionMetric(1);
        const resOk = await fetch(`http://127.0.0.1:${port}/health`);
        expect(resOk.status).toBe(200);
        const bodyOk = await resOk.json();
        expect(bodyOk.status).toBe('ok');
        expect(bodyOk.whatsappConnectionState).toBe(1);

        setWhatsAppConnectionMetric(-1);
        const resDegraded = await fetch(`http://127.0.0.1:${port}/health`);
        expect(resDegraded.status).toBe(503);
        const bodyDegraded = await resDegraded.json();
        expect(bodyDegraded.status).toBe('degraded');
    });

    it('returns 404 for unknown routes', async () => {
        server = createMetricsServer();
        await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', () => resolve()));
        const port = (server.address() as AddressInfo).port;

        const res = await fetch(`http://127.0.0.1:${port}/unknown`);
        expect(res.status).toBe(404);
    });

    it('manages singleton lifecycle with startMetricsServer and stopMetricsServer', async () => {
        const started = await startMetricsServer(0);
        expect(started).toBeDefined();

        await stopMetricsServer();
    });
});
