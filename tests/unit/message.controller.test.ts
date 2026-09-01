import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    processIncomingMessage,
    _clearControllerStateForTesting,
    _getChatContextForTesting,
    _getActiveTransactionForTesting,
} from '../../src/controllers/message.controller';
import * as aiService from '../../src/services/ai.service';
import * as sheetsService from '../../src/services/sheets.service';
import * as memoryService from '../../src/services/memory.service';
import * as visionService from '../../src/services/vision.service';
import type { IncomingMessage } from '../../src/controllers/message.controller';

describe('message.controller.ts (Core Message Orchestrator)', () => {
    const CHAT_ID = '120363012345678901@g.us';
    const CHAT_NAME = 'Contabilidad';

    beforeEach(() => {
        _clearControllerStateForTesting();
        vi.restoreAllMocks();
    });

    describe('Plain text accumulation', () => {
        it('accumulates plain text messages into the chat context', async () => {
            const message: IncomingMessage = {
                messageId: 'msg_01',
                chatId: CHAT_ID,
                chatName: CHAT_NAME,
                body: 'venta Karol 2 casio retro',
                hasMedia: false,
                hasQuotedMsg: false,
            };

            await processIncomingMessage(message);

            const context = _getChatContextForTesting(CHAT_ID);
            expect(context).toContain('venta Karol 2 casio retro');
        });
    });

    describe('Non-receipt image handling', () => {
        it('extracts OCR text and accumulates it into context when no financial keywords are present', async () => {
            vi.spyOn(aiService, 'optimizeImageForOcr').mockResolvedValue('optimized_base64');
            vi.spyOn(visionService, 'extractTextWithVisionEnhanced').mockResolvedValue('Yenci Perez 3106131751 Armenia 2 CASIO');

            const message: IncomingMessage = {
                messageId: 'msg_img_01',
                chatId: CHAT_ID,
                chatName: CHAT_NAME,
                body: '',
                hasMedia: true,
                hasQuotedMsg: false,
                media: { data: 'raw_base64', mimetype: 'image/jpeg' },
            };

            await processIncomingMessage(message);

            const context = _getChatContextForTesting(CHAT_ID);
            expect(context).toContain('Yenci Perez 3106131751 Armenia 2 CASIO');
        });
    });

    describe('Bank receipt handling & Transaction Lifecycle', () => {
        it('records income, opens active transaction, and closes previous transaction when next receipt arrives', async () => {
            vi.spyOn(aiService, 'optimizeImageForOcr').mockResolvedValue('optimized_base64');
            vi.spyOn(visionService, 'extractTextWithVisionEnhanced')
                .mockResolvedValueOnce('Comprobante Nequi $165.000 M111111') // Receipt 1
                .mockResolvedValueOnce('Comprobante Bancolombia $320.000 B222222'); // Receipt 2

            vi.spyOn(memoryService, 'findTransactionByPaymentReference').mockReturnValue(null);

            const saveTxSpy = vi.spyOn(memoryService, 'saveTransaction').mockImplementation(() => {});
            const appendIncomeSpy = vi.spyOn(sheetsService, 'appendIncomeRow')
                .mockResolvedValueOnce({ nPedido: 'LG-001', filaIngreso: 5 })
                .mockResolvedValueOnce({ nPedido: 'LG-002', filaIngreso: 6 });

            const extractAiSpy = vi.spyOn(aiService, 'extractAccountingDataFromOcr')
                .mockResolvedValueOnce({
                    esComprobanteValido: true,
                    fecha: '05/08/2026',
                    tipo: 'Ingreso',
                    descripcion: 'Pedido al por menor',
                    precioCompra: '165000',
                    medioDePago: 'Nequi',
                    referenciaDePago: 'M111111',
                    cuentaDestino: '3143527475',
                    vendedor: 'Karol',
                })
                .mockResolvedValueOnce({
                    esComprobanteValido: true,
                    fecha: '05/08/2026',
                    tipo: 'Ingreso',
                    descripcion: 'Pedido al por mayor',
                    precioCompra: '320000',
                    medioDePago: 'Bancolombia',
                    referenciaDePago: 'B222222',
                    cuentaDestino: '3143527475',
                    vendedor: 'JHON',
                });

            const extractCustomerSpy = vi.spyOn(aiService, 'extractCustomerDataFromText').mockResolvedValue({
                nombreCliente: 'Yenci Perez',
                email: 'N/A',
                telefono: '3106131751',
                municipio: 'Armenia',
                vendedor: 'Karol',
                producto: 'CASIO retro x2',
                cantidadRelojes: 2,
                cantidadOtros: 0,
            });

            vi.spyOn(memoryService, 'findTransactionByMessageId').mockReturnValue({
                messageId: 'msg_receipt_1',
                nPedido: 'LG-001',
                filaIngreso: 5,
                filaVenta: null,
                fechaRegistro: '2026-08-05T10:00:00Z',
                referenciaPago: 'M111111',
            });

            const appendSalesSpy = vi.spyOn(sheetsService, 'appendSalesRow').mockResolvedValue(10);
            const updateSalesRowSpy = vi.spyOn(memoryService, 'updateSalesRowIndex').mockImplementation(() => {});

            // Step 1: Receipt 1 arrives -> LG-001 created
            await processIncomingMessage({
                messageId: 'msg_receipt_1',
                chatId: CHAT_ID,
                chatName: CHAT_NAME,
                body: '',
                hasMedia: true,
                hasQuotedMsg: false,
                media: { data: 'img1', mimetype: 'image/jpeg' },
            });

            expect(appendIncomeSpy).toHaveBeenCalledTimes(1);
            expect(saveTxSpy).toHaveBeenCalledWith('msg_receipt_1', 'LG-001', 5, 'M111111');
            expect(_getActiveTransactionForTesting(CHAT_ID)?.nPedido).toBe('LG-001');

            // Step 2: Customer text arrives between receipts
            await processIncomingMessage({
                messageId: 'msg_text_customer',
                chatId: CHAT_ID,
                chatName: CHAT_NAME,
                body: 'Yenci Perez 3106131751 Armenia 2 CASIO',
                hasMedia: false,
                hasQuotedMsg: false,
            });

            // Step 3: Receipt 2 arrives -> Should close LG-001 sales first, then register LG-002
            await processIncomingMessage({
                messageId: 'msg_receipt_2',
                chatId: CHAT_ID,
                chatName: CHAT_NAME,
                body: '',
                hasMedia: true,
                hasQuotedMsg: false,
                media: { data: 'img2', mimetype: 'image/jpeg' },
            });

            expect(extractCustomerSpy).toHaveBeenCalledTimes(1);
            expect(appendSalesSpy).toHaveBeenCalledWith(
                expect.objectContaining({ nombreCliente: 'Yenci Perez' }),
                'LG-001',
                '5-Ago-2026'
            );
            expect(updateSalesRowSpy).toHaveBeenCalledWith('msg_receipt_1', 10);
            expect(_getActiveTransactionForTesting(CHAT_ID)?.nPedido).toBe('LG-002');
        });

        it('discards duplicate receipts when payment reference already exists in SQLite', async () => {
            vi.spyOn(aiService, 'optimizeImageForOcr').mockResolvedValue('optimized_base64');
            vi.spyOn(visionService, 'extractTextWithVisionEnhanced').mockResolvedValue('Comprobante Nequi $165.000 M111111');

            vi.spyOn(aiService, 'extractAccountingDataFromOcr').mockResolvedValue({
                esComprobanteValido: true,
                fecha: '05/08/2026',
                tipo: 'Ingreso',
                descripcion: 'Pedido al por menor',
                precioCompra: '165000',
                medioDePago: 'Nequi',
                referenciaDePago: 'M111111',
                cuentaDestino: '3143527475',
                vendedor: 'Karol',
            });

            // Mock that M111111 is already in memory
            vi.spyOn(memoryService, 'findTransactionByPaymentReference').mockReturnValue({
                messageId: 'old_msg',
                nPedido: 'LG-001',
                filaIngreso: 5,
                filaVenta: 10,
                fechaRegistro: '2026-08-05T10:00:00Z',
                referenciaPago: 'M111111',
            });

            const appendIncomeSpy = vi.spyOn(sheetsService, 'appendIncomeRow');

            await processIncomingMessage({
                messageId: 'msg_dup_receipt',
                chatId: CHAT_ID,
                chatName: CHAT_NAME,
                body: '',
                hasMedia: true,
                hasQuotedMsg: false,
                media: { data: 'img_dup', mimetype: 'image/jpeg' },
            });

            expect(appendIncomeSpy).not.toHaveBeenCalled();
        });

        it('does not reject receipts with "No identificado" or "N/A" as duplicates', async () => {
            vi.spyOn(visionService, 'extractTextWithVisionEnhanced').mockResolvedValue('Comprobante DaviPlata $222.000');

            vi.spyOn(aiService, 'extractAccountingDataFromOcr').mockResolvedValue({
                esComprobanteValido: true,
                fecha: '05/08/2026',
                tipo: 'Ingreso',
                descripcion: 'Pedido al por menor',
                precioCompra: '222000',
                medioDePago: 'DaviPlata',
                referenciaDePago: 'No identificado',
                cuentaDestino: '3217115717',
                vendedor: 'JHON',
            });

            const duplicateCheckSpy = vi.spyOn(memoryService, 'findTransactionByPaymentReference');
            const appendIncomeSpy = vi.spyOn(sheetsService, 'appendIncomeRow').mockResolvedValue({
                nPedido: 'LG-006',
                filaIngreso: 7,
            });
            vi.spyOn(memoryService, 'saveTransaction').mockImplementation(() => {});

            await processIncomingMessage({
                messageId: 'msg_no_ref_receipt',
                chatId: CHAT_ID,
                chatName: CHAT_NAME,
                body: '',
                hasMedia: true,
                hasQuotedMsg: false,
                media: { data: 'img_no_ref', mimetype: 'image/jpeg' },
            });

            expect(duplicateCheckSpy).not.toHaveBeenCalled();
            expect(appendIncomeSpy).toHaveBeenCalledTimes(1);
        });
    });

    describe('Quoted replies & Field corrections', () => {
        it('applies direct field correction on reply (e.g., "tipo: Abono" or "vendedor: Karol")', async () => {
            vi.spyOn(memoryService, 'findTransactionByOrderNumber').mockReturnValue({
                messageId: 'msg_target',
                nPedido: 'LG-007',
                filaIngreso: 12,
                filaVenta: null,
                fechaRegistro: '2026-08-05T10:00:00Z',
                referenciaPago: null,
            });

            const updateIncomeSpy = vi.spyOn(sheetsService, 'updateIncomeRow').mockResolvedValue();

            await processIncomingMessage({
                messageId: 'msg_correction',
                chatId: CHAT_ID,
                chatName: CHAT_NAME,
                body: 'tipo: Abono',
                hasMedia: false,
                hasQuotedMsg: true,
                quotedMsgId: 'msg_target',
                quotedBody: '✅ LG-007 registrado',
            });

            expect(updateIncomeSpy).toHaveBeenCalledWith(12, { tipo: 'Abono' });
        });
    });
});
