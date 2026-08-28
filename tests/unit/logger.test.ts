import { describe, it, expect, vi, beforeEach } from 'vitest';
import { logger, createSilentBaileysLogger, setLogLevel, getLogLevel, LogLevel } from '../../src/utils/logger';

describe('logger.ts (Native Clean Logger)', () => {
    beforeEach(() => {
        vi.restoreAllMocks();
        setLogLevel('INFO');
    });

    it('exports standard logging methods', () => {
        expect(typeof logger.info).toBe('function');
        expect(typeof logger.warn).toBe('function');
        expect(typeof logger.error).toBe('function');
        expect(typeof logger.debug).toBe('function');
        expect(typeof logger.tokenUsage).toBe('function');
        expect(typeof logger.summary).toBe('function');
    });

    it('creates silent logger for Baileys socket', () => {
        const silent = createSilentBaileysLogger();
        expect(silent.level).toBe('silent');
        expect(typeof silent.info).toBe('function');
        expect(typeof silent.warn).toBe('function');
        expect(typeof silent.error).toBe('function');
        expect(typeof silent.child).toBe('function');
        expect(silent.child()).toBe(silent);
    });

    it('tracks token usage and generates summary', () => {
        logger.tokenUsage(100, 50);
        logger.tokenUsage(20, 10);
        const summary = logger.summary();
        expect(summary.totalTokens).toBeGreaterThanOrEqual(180);
        expect(summary.totalLlmCalls).toBeGreaterThanOrEqual(2);
    });

    it('supports setting and getting log levels', () => {
        setLogLevel('DEBUG');
        expect(getLogLevel()).toBe(LogLevel.DEBUG);

        setLogLevel('ERROR');
        expect(getLogLevel()).toBe(LogLevel.ERROR);

        setLogLevel('WARN');
        expect(getLogLevel()).toBe(LogLevel.WARN);

        setLogLevel('INFO');
        expect(getLogLevel()).toBe(LogLevel.INFO);
    });

    it('filters out debug logs when level is INFO', () => {
        const spyConsole = vi.spyOn(console, 'log');
        setLogLevel('INFO');
        logger.debug('TEST', 'This should not appear');
        expect(spyConsole).not.toHaveBeenCalled();
    });

    it('emits info and error logs when level is INFO', () => {
        const spyLog = vi.spyOn(console, 'log');
        const spyError = vi.spyOn(console, 'error');
        setLogLevel('INFO');

        logger.info('TEST', 'Hello info');
        logger.error('TEST', 'Hello error');

        expect(spyLog).toHaveBeenCalledWith(expect.stringContaining('[TEST] Hello info'));
        expect(spyError).toHaveBeenCalledWith(expect.stringContaining('[TEST] Hello error'));
    });
});
