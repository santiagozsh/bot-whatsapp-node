enum LogLevel {
    ERROR = 0,
    WARN = 1,
    INFO = 2,
    DEBUG = 3,
}

const NIVEL = (() => {
    const env = process.env.LOG_LEVEL?.toUpperCase();
    if (env === 'ERROR') return LogLevel.ERROR;
    if (env === 'WARN') return LogLevel.WARN;
    if (env === 'INFO') return LogLevel.INFO;
    if (env === 'DEBUG') return LogLevel.DEBUG;
    return LogLevel.INFO;
})();

let totalPromptTokens = 0;
let totalCompletionTokens = 0;
let totalLlmCalls = 0;

function timestamp(): string {
    const d = new Date();
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}:${String(d.getSeconds()).padStart(2, '0')}`;
}

export const logger = {
    error: (tag: string, msg: string, ...args: unknown[]) => {
        if (NIVEL >= LogLevel.ERROR) console.error(`❌ [${timestamp()}] [${tag}] ${msg}`, ...args);
    },
    warn: (tag: string, msg: string, ...args: unknown[]) => {
        if (NIVEL >= LogLevel.WARN) console.warn(`⚠️ [${timestamp()}] [${tag}] ${msg}`, ...args);
    },
    info: (tag: string, msg: string, ...args: unknown[]) => {
        if (NIVEL >= LogLevel.INFO) console.log(`[${timestamp()}] [${tag}] ${msg}`, ...args);
    },
    debug: (tag: string, msg: string, ...args: unknown[]) => {
        if (NIVEL >= LogLevel.DEBUG) console.log(`🔍 [${timestamp()}] [${tag}] ${msg}`, ...args);
    },
    tokenUsage: (promptTokens: number, completionTokens: number) => {
        totalPromptTokens += promptTokens;
        totalCompletionTokens += completionTokens;
        totalLlmCalls++;
        console.log(`📊 [TOKENS] Esta llamada: ${promptTokens + completionTokens} (prompt: ${promptTokens} | completion: ${completionTokens}) | Total acumulado: ${totalPromptTokens + totalCompletionTokens} en ${totalLlmCalls} llamadas`);
    },
    summary: () => {
        console.log(`\n═══════════════════════════════════════`);
        console.log(`   RESUMEN DE CONSUMO (esta sesión)`);
        console.log(`   Llamadas a IA:  ${totalLlmCalls}`);
        console.log(`   Tokens totales: ${totalPromptTokens + totalCompletionTokens}`);
        console.log(`   Prompt:         ${totalPromptTokens}`);
        console.log(`   Completion:     ${totalCompletionTokens}`);
        console.log(`═══════════════════════════════════════\n`);
    },
};
