import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
    initDatabase,
    closeDatabase,
    saveTransaction,
    findTransactionByMessageId,
    findTransactionByOrderNumber,
    findTransactionByPaymentReference,
    updateSalesRowIndex,
    generateNextOrderNumber,
    getSequenceValue,
    setSequenceValue,
    registerSequenceSyncCallback,
    _resetSyncAttemptForTesting,
} from '../../src/services/memory.service';

describe('memory.service.ts (SQLite Layer)', () => {
    beforeEach(() => {
        initDatabase(':memory:');
    });

    afterEach(() => {
        closeDatabase();
    });

    describe('Transaction Storage and Lookups', () => {
        it('saves and retrieves a transaction by messageId', () => {
            saveTransaction('msg_001', 'LG-001', 5, 'REF12345');

            const result = findTransactionByMessageId('msg_001');
            expect(result).not.toBeNull();
            expect(result?.messageId).toBe('msg_001');
            expect(result?.nPedido).toBe('LG-001');
            expect(result?.filaIngreso).toBe(5);
            expect(result?.filaVenta).toBeNull();
            expect(result?.referenciaPago).toBe('REF12345');
        });

        it('retrieves a transaction by orderNumber (LG-XXX)', () => {
            saveTransaction('msg_002', 'LG-002', 6, 'REF99999');

            const result = findTransactionByOrderNumber('LG-002');
            expect(result).not.toBeNull();
            expect(result?.messageId).toBe('msg_002');
        });

        it('retrieves a transaction by payment reference for deduplication', () => {
            saveTransaction('msg_003', 'LG-003', 7, 'NEQUI_PAY_777');

            const found = findTransactionByPaymentReference('NEQUI_PAY_777');
            expect(found).not.toBeNull();
            expect(found?.nPedido).toBe('LG-003');

            const notFound = findTransactionByPaymentReference('NON_EXISTENT');
            expect(notFound).toBeNull();

            const naResult = findTransactionByPaymentReference('N/A');
            expect(naResult).toBeNull();
        });

        it('updates the sales row index on an existing transaction', () => {
            saveTransaction('msg_004', 'LG-004', 8, null);

            updateSalesRowIndex('msg_004', 12);

            const updated = findTransactionByMessageId('msg_004');
            expect(updated?.filaVenta).toBe(12);
        });

        it('replaces existing transaction if same messageId is inserted', () => {
            saveTransaction('msg_dup', 'LG-005', 9, 'REF_A');
            saveTransaction('msg_dup', 'LG-005', 10, 'REF_B');

            const result = findTransactionByMessageId('msg_dup');
            expect(result?.filaIngreso).toBe(10);
            expect(result?.referenciaPago).toBe('REF_B');
        });
    });

    describe('Order Sequence Generator', () => {
        it('generates zero-padded sequential order IDs (LG-001, LG-002, etc.)', async () => {
            const id1 = await generateNextOrderNumber();
            const id2 = await generateNextOrderNumber();
            const id3 = await generateNextOrderNumber();

            expect(id1).toBe('LG-001');
            expect(id2).toBe('LG-002');
            expect(id3).toBe('LG-003');
        });

        it('allows getting and setting the sequence counter manually', () => {
            setSequenceValue(150);
            expect(getSequenceValue()).toBe(150);
        });

        it('syncs sequence from external callback if callback value is higher', async () => {
            _resetSyncAttemptForTesting();
            const mockSync = vi.fn().mockResolvedValue(45);
            registerSequenceSyncCallback(mockSync);

            const nextId = await generateNextOrderNumber();
            expect(mockSync).toHaveBeenCalledTimes(1);
            expect(nextId).toBe('LG-046');
        });
    });

    describe('FIFO Eviction Policy', () => {
        it('prunes oldest records when total count exceeds 300', () => {
            for (let i = 1; i <= 305; i++) {
                saveTransaction(`msg_${i}`, `LG-${i}`, i, `REF_${i}`);
            }

            // msg_1 through msg_5 should have been evicted
            expect(findTransactionByMessageId('msg_1')).toBeNull();
            expect(findTransactionByMessageId('msg_5')).toBeNull();
            // msg_6 through msg_305 should remain
            expect(findTransactionByMessageId('msg_6')).not.toBeNull();
            expect(findTransactionByMessageId('msg_305')).not.toBeNull();
        });
    });
});
