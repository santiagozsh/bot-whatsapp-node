/**
 * Known business destination accounts categorized as regular income.
 */
export const INCOME_ACCOUNTS: readonly string[] = [
    '3143527475',
    '3224442154',
    '3212267474',
    '3217115717',
    '20675640140',
    '91210979391',
    '51103777724',
    '3108303127',
];

/**
 * Designated accounts for reservation or advance installment payments (Abonos).
 */
export const ADVANCE_ACCOUNTS: readonly string[] = [
    '3106131751',
    '3013818248',
    '3175385982',
    '3103455869',
    '03759053996',
];

/**
 * Accounts specifically designated for warehouse/supplier restocking (Nequi bodega).
 */
export const BODEGA_ACCOUNTS: readonly string[] = [
    '3106131751',
    '3013818248',
    '3175385982',
];

/**
 * Known customer or recipient keywords indicating advance payments.
 */
export const ADVANCE_NAMES: readonly string[] = [
    'yenci',
    'yenny',
    'yazmin',
    'ramirez',
];

/**
 * Canonical recognized vendor identifiers in strict uppercase.
 */
export const KNOWN_VENDORS: readonly string[] = [
    'JHON',
    'EVELIN',
    'KAROL',
    'DAVID',
];

export const DEFAULT_VENDOR = 'JHON';

/**
 * Common nicknames, diminutives, and conversational variations mapped to canonical vendors.
 */
export const VENDOR_ALIASES: Readonly<Record<string, string>> = {
    // EVELIN
    'eve': 'EVELIN',
    'evelyn': 'EVELIN',
    'evy': 'EVELIN',
    'evi': 'EVELIN',
    'evelina': 'EVELIN',
    'evelincita': 'EVELIN',
    'evelinsita': 'EVELIN',
    'evelin la mejor': 'EVELIN',
    'eve la mejor': 'EVELIN',

    // JHON
    'jhoncito': 'JHON',
    'jhonsito': 'JHON',
    'jon': 'JHON',
    'john': 'JHON',
    'joncito': 'JHON',
    'jhonny': 'JHON',
    'jhony': 'JHON',

    // KAROL
    'karolsita': 'KAROL',
    'karolcita': 'KAROL',
    'carol': 'KAROL',
    'carito': 'KAROL',
    'carolcita': 'KAROL',
    'carolsita': 'KAROL',

    // DAVID
    'davidcito': 'DAVID',
    'davidsito': 'DAVID',
    'davo': 'DAVID',
    'deivid': 'DAVID',
};

// ── Backward-Compatible Aliases ───────────────────────────────
export const CUENTAS_INGRESO = INCOME_ACCOUNTS;
export const CUENTAS_ABONO = ADVANCE_ACCOUNTS;
export const CUENTAS_BODEGA = BODEGA_ACCOUNTS;
export const NOMBRES_ABONO = ADVANCE_NAMES;
export const VENDEDORES_CONOCIDOS = KNOWN_VENDORS;
