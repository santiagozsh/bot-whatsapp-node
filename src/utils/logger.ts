export enum LogLevel {
    ERROR = 0,
    WARN = 1,
    INFO = 2,
    DEBUG = 3,
}

export type LogLevelName = 'ERROR' | 'WARN' | 'INFO' | 'DEBUG' | 'error' | 'warn' | 'info' | 'debug';

function parseLogLevel(levelName?: string): LogLevel {
    const normalized = levelName?.toUpperCase();
    if (normalized === 'ERROR') return LogLevel.ERROR;
    if (normalized === 'WARN') return LogLevel.WARN;
    if (normalized === 'INFO') return LogLevel.INFO;
    if (normalized === 'DEBUG') return LogLevel.DEBUG;
    return LogLevel.INFO;
}

let activeLogLevel: LogLevel = parseLogLevel(process.env.LOG_LEVEL);

let totalPromptTokens = 0;
let totalCompletionTokens = 0;
let totalLlmCalls = 0;

function timestamp(): string {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export const logger = {
    error: (tag: string, msg: string, ...args: unknown[]) => {
        if (activeLogLevel >= LogLevel.ERROR) {
            console.error(`❌ [${timestamp()}] [${tag}] ${msg}`, ...args);
        }
    },
    warn: (tag: string, msg: string, ...args: unknown[]) => {
        if (activeLogLevel >= LogLevel.WARN) {
            console.warn(`⚠️ [${timestamp()}] [${tag}] ${msg}`, ...args);
        }
    },
    info: (tag: string, msg: string, ...args: unknown[]) => {
        if (activeLogLevel >= LogLevel.INFO) {
            console.log(`[${timestamp()}] [${tag}] ${msg}`, ...args);
        }
    },
    debug: (tag: string, msg: string, ...args: unknown[]) => {
        if (activeLogLevel >= LogLevel.DEBUG) {
            console.log(`🔍 [${timestamp()}] [${tag}] ${msg}`, ...args);
        }
    },
    tokenUsage: (promptTokens: number, completionTokens: number) => {
        totalPromptTokens += promptTokens;
        totalCompletionTokens += completionTokens;
        totalLlmCalls++;
        if (activeLogLevel >= LogLevel.DEBUG) {
            console.log(`📊 [${timestamp()}] [TOKENS] Call: ${promptTokens + completionTokens} (prompt: ${promptTokens} | completion: ${completionTokens}) | Cumulative: ${totalPromptTokens + totalCompletionTokens} in ${totalLlmCalls} calls`);
        }
    },
    summary: () => {
        return {
            totalLlmCalls,
            totalTokens: totalPromptTokens + totalCompletionTokens,
            totalPromptTokens,
            totalCompletionTokens,
        };
    },
};

/**
 * Creates a silent logger object compatible with Baileys to eliminate WebSocket packet spam.
 */
export function createSilentBaileysLogger() {
    const noop = () => {};
    const silentLogger: any = {
        level: 'silent',
        trace: noop,
        debug: noop,
        info: noop,
        warn: noop,
        error: noop,
        fatal: noop,
        child: () => silentLogger,
    };
    return silentLogger;
}

// Backward-compatible alias
export const createChildLogger = createSilentBaileysLogger;

export function setLogLevel(level: LogLevelName) {
    activeLogLevel = parseLogLevel(level);
}

export function getLogLevel(): LogLevel {
    return activeLogLevel;
}
