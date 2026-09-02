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
 * Recognized vendor nicknames used for normalized attribution.
 */
export const KNOWN_VENDORS: readonly string[] = [
    'evelin',
    'alejandra',
    'aleja',
    'karol',
    'david',
];

// ── Backward-Compatible Aliases ───────────────────────────────
export const CUENTAS_INGRESO = INCOME_ACCOUNTS;
export const CUENTAS_ABONO = ADVANCE_ACCOUNTS;
export const CUENTAS_BODEGA = BODEGA_ACCOUNTS;
export const NOMBRES_ABONO = ADVANCE_NAMES;
export const VENDEDORES_CONOCIDOS = KNOWN_VENDORS;
