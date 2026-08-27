import { describe, it, expect } from 'vitest';
import {
    extractMessageBody,
    calculateReconnectDelay,
    parseVersionNumber,
    describeDisconnectReason,
    _resetReconnectAttemptsForTesting,
} from '../../src/services/whatsapp.service';
import type { WAMessage } from '@whiskeysockets/baileys';

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

        it('returns empty string when message payload is missing or media-only', () => {
            expect(extractMessageBody({} as WAMessage)).toBe('');
            expect(extractMessageBody({ message: {} } as WAMessage)).toBe('');
        });
    });

    describe('calculateReconnectDelay', () => {
        it('calculates exponential backoff up to 32000ms max ceiling', () => {
            _resetReconnectAttemptsForTesting();

            expect(calculateReconnectDelay()).toBe(2000);  // 2s * 2^0
            expect(calculateReconnectDelay()).toBe(4000);  // 2s * 2^1
            expect(calculateReconnectDelay()).toBe(8000);  // 2s * 2^2
            expect(calculateReconnectDelay()).toBe(16000); // 2s * 2^3
            expect(calculateReconnectDelay()).toBe(32000); // 2s * 2^4
            expect(calculateReconnectDelay()).toBe(32000); // Capped at 32s
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
