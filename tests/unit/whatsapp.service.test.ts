import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
    extractMessageBody,
    calculateReconnectDelay,
    parseVersionNumber,
    describeDisconnectReason,
    _resetReconnectAttemptsForTesting,
    createInMemoryCacheStore,
    resolveAuthorizedGroupName,
    handleMessagesUpsert,
} from '../../src/services/whatsapp.service';
import type { WAMessage } from '@whiskeysockets/baileys';
import * as messageController from '../../src/controllers/message.controller';

describe('whatsapp.service.ts (WhatsApp Gateway & Protocol Layer)', () => {
    describe('extractMessageBody', () => {
        it('extracts plain conversation string', () => {
            const msg = {
                message: {
                    conversation: 'venta Karol 2 casio retro',
                },
            } as WAMessage;

            expect(extractMessageBody(msg)).toBe('venta Karol 2 casio retro');
        });

        it('extracts extended text message string', () => {
            const msg = {
                message: {
                    extendedTextMessage: {
                        text: 'tipo: Abono',
                    },
                },
            } as WAMessage;

            expect(extractMessageBody(msg)).toBe('tipo: Abono');
        });

        it('extracts text from wrapped ephemeral message structure', () => {
            const msg = {
                message: {
                    ephemeralMessage: {
                        message: {
                            conversation: 'mensaje efímero de prueba',
                        },
                    },
                },
            } as unknown as WAMessage;

            expect(extractMessageBody(msg)).toBe('mensaje efímero de prueba');
        });

        it('returns empty string when message payload is missing or media-only', () => {
            expect(extractMessageBody({} as WAMessage)).toBe('');
            expect(extractMessageBody({ message: {} } as WAMessage)).toBe('');
        });
    });

    describe('calculateReconnectDelay', () => {
        it('calculates exponential backoff up to 32000ms max ceiling for standard disconnects', () => {
            _resetReconnectAttemptsForTesting();

            expect(calculateReconnectDelay()).toBe(2000);  // 2s * 2^0
            expect(calculateReconnectDelay()).toBe(4000);  // 2s * 2^1
            expect(calculateReconnectDelay()).toBe(8000);  // 2s * 2^2
            expect(calculateReconnectDelay()).toBe(16000); // 2s * 2^3
            expect(calculateReconnectDelay()).toBe(32000); // 2s * 2^4
            expect(calculateReconnectDelay()).toBe(32000); // Capped at 32s
        });

        it('fast-tracks reconnection to 1000ms for transient 428 (connectionClosed) and 515 (restartRequired)', () => {
            _resetReconnectAttemptsForTesting();

            expect(calculateReconnectDelay(428)).toBe(1000);
            expect(calculateReconnectDelay(515)).toBe(1000);
        });
    });

    describe('createInMemoryCacheStore', () => {
        it('implements CacheStore interface for message retry tracking', () => {
            const cache = createInMemoryCacheStore();

            expect(cache.get('msg_1')).toBeUndefined();
            cache.set('msg_1', 1);
            expect(cache.get('msg_1')).toBe(1);

            cache.del('msg_1');
            expect(cache.get('msg_1')).toBeUndefined();

            cache.set('msg_2', 2);
            cache.flushAll();
            expect(cache.get('msg_2')).toBeUndefined();
        });
    });

    describe('resolveAuthorizedGroupName', () => {
        it('resolves authorized group via fallback sock.groupMetadata if not cached', async () => {
            const mockSock = {
                groupMetadata: vi.fn().mockResolvedValue({
                    id: '120363099999999999@g.us',
                    subject: 'Contabilidad',
                }),
            };

            const name = await resolveAuthorizedGroupName(mockSock as any, '120363099999999999@g.us');
            expect(name).toBe('Contabilidad');
            expect(mockSock.groupMetadata).toHaveBeenCalledWith('120363099999999999@g.us');
        });

        it('returns null if group subject is not in authorized list', async () => {
            const mockSock = {
                groupMetadata: vi.fn().mockResolvedValue({
                    id: '120363088888888888@g.us',
                    subject: 'Amigos Random',
                }),
            };

            const name = await resolveAuthorizedGroupName(mockSock as any, '120363088888888888@g.us');
            expect(name).toBeNull();
        });
    });

    describe('handleMessagesUpsert (Batch Processing & Missed Transactions Fix)', () => {
        beforeEach(() => {
            vi.restoreAllMocks();
        });

        it('processes EVERY message in the batch when m.messages contains multiple items', async () => {
            const processSpy = vi.spyOn(messageController, 'processIncomingMessage').mockResolvedValue();

            const mockSock = {
                groupMetadata: vi.fn().mockResolvedValue({
                    id: '120363011111111111@g.us',
                    subject: 'Contabilidad',
                }),
            };

            const messagesPayload = {
                type: 'notify' as const,
                messages: [
                    {
                        key: { remoteJid: '120363011111111111@g.us', id: 'msg_01' },
                        message: { conversation: 'comprobante 1' },
                    },
                    {
                        key: { remoteJid: '120363011111111111@g.us', id: 'msg_02' },
                        message: { conversation: 'comprobante 2' },
                    },
                    {
                        key: { remoteJid: '120363011111111111@g.us', id: 'msg_03' },
                        message: { conversation: 'comprobante 3' },
                    },
                ] as WAMessage[],
            };

            await handleMessagesUpsert(mockSock as any, messagesPayload);

            // Verifies that all 3 messages are processed sequentially and NONE are dropped
            expect(processSpy).toHaveBeenCalledTimes(3);
            expect(processSpy).toHaveBeenNthCalledWith(1, expect.objectContaining({ messageId: 'msg_01' }));
            expect(processSpy).toHaveBeenNthCalledWith(2, expect.objectContaining({ messageId: 'msg_02' }));
            expect(processSpy).toHaveBeenNthCalledWith(3, expect.objectContaining({ messageId: 'msg_03' }));
        });
    });

    describe('parseVersionNumber', () => {
        it('parses version numbers and correctly compares semver and release candidates', () => {
            const v13 = parseVersionNumber('7.0.0-rc13');
            const v14 = parseVersionNumber('7.0.0-rc14');
            const v7 = parseVersionNumber('7.0.0');

            expect(v14).toBeGreaterThan(v13);
            expect(parseVersionNumber('7.0.1')).toBeGreaterThan(parseVersionNumber('7.0.0'));
        });
    });

    describe('describeDisconnectReason', () => {
        it('formats disconnect reasons with readable descriptions', () => {
            const errorLoggedOut = { output: { statusCode: 401 } };
            const desc = describeDisconnectReason(errorLoggedOut);

            expect(desc).toContain('401');
            expect(desc).toContain('SESIÓN REVOCADA');
        });

        it('handles null error as normal closure', () => {
            expect(describeDisconnectReason(null)).toBe('sin error (cierre normal)');
        });
    });
});
