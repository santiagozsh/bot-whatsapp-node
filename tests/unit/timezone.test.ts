import { describe, it, expect } from 'vitest';
import {
    getBogotaTodayDateString,
    getBogotaFormattedDate,
    getMsUntilBogotaMidnight,
} from '../../src/utils/helpers';

describe('timezone helpers (America/Bogota, UTC-5)', () => {
    describe('getBogotaTodayDateString', () => {
        it('returns correct Colombia date before UTC midnight', () => {
            // 2026-09-27 18:30 in Colombia is 2026-09-27 23:30 UTC
            const date = new Date('2026-09-27T23:30:00Z');
            expect(getBogotaTodayDateString(date)).toBe('27/09/2026');
        });

        it('preserves Colombia date after UTC midnight (e.g. 20:30 COT = 01:30 UTC next day)', () => {
            // 2026-09-27 20:30 in Colombia is 2026-09-28 01:30 UTC
            const date = new Date('2026-09-28T01:30:00Z');
            expect(getBogotaTodayDateString(date)).toBe('27/09/2026');
        });

        it('transitions date only when midnight in Colombia is reached (05:00 UTC)', () => {
            // 2026-09-28 00:05 in Colombia is 2026-09-28 05:05 UTC
            const date = new Date('2026-09-28T05:05:00Z');
            expect(getBogotaTodayDateString(date)).toBe('28/09/2026');
        });
    });

    describe('getBogotaFormattedDate', () => {
        it('formats date into D-Mes-YYYY matching Google Sheets schema', () => {
            const date = new Date('2026-09-28T02:00:00Z'); // 21:00 COT on Sep 27
            expect(getBogotaFormattedDate(date)).toBe('27-Sep-2026');
        });

        it('correctly transitions month in Colombian time', () => {
            // 2026-09-30 23:30 in Colombia is 2026-10-01 04:30 UTC
            const lateNight = new Date('2026-10-01T04:30:00Z');
            expect(getBogotaFormattedDate(lateNight)).toBe('30-Sep-2026');

            // 2026-10-01 00:15 in Colombia is 2026-10-01 05:15 UTC
            const nextDay = new Date('2026-10-01T05:15:00Z');
            expect(getBogotaFormattedDate(nextDay)).toBe('1-Oct-2026');
        });
    });

    describe('getMsUntilBogotaMidnight', () => {
        it('calculates remaining milliseconds until 00:00 COT', () => {
            // 20:00 COT is 01:00 UTC (4 hours until midnight = 14,400,000 ms)
            const date = new Date('2026-09-28T01:00:00Z');
            const ms = getMsUntilBogotaMidnight(date);
            expect(ms).toBe(4 * 60 * 60 * 1000);
        });

        it('calculates remaining time just before midnight COT', () => {
            // 23:59:50 COT is 04:59:50 UTC (10 seconds until midnight = 10,000 ms)
            const date = new Date('2026-09-28T04:59:50Z');
            const ms = getMsUntilBogotaMidnight(date);
            expect(ms).toBe(10 * 1000);
        });

        it('schedules next midnight (24h) when exactly at midnight COT', () => {
            // 00:00:00 COT is 05:00:00 UTC
            const date = new Date('2026-09-28T05:00:00Z');
            const ms = getMsUntilBogotaMidnight(date);
            expect(ms).toBe(24 * 60 * 60 * 1000);
        });
    });
});
