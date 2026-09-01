// Copy this file as config.data.ts and replace with real account numbers
export const INCOME_ACCOUNTS: readonly string[] = ['INCOME_ACCOUNT_1'];
export const ADVANCE_ACCOUNTS: readonly string[] = ['ADVANCE_ACCOUNT_1', 'ADVANCE_ACCOUNT_2'];
export const BODEGA_ACCOUNTS: readonly string[] = ['BODEGA_ACCOUNT_1'];
export const ADVANCE_NAMES: readonly string[] = ['ADVANCE_NAME_1'];
export const KNOWN_VENDORS: readonly string[] = ['VENDOR_1'];

// Backward-compatible aliases
export const CUENTAS_INGRESO = INCOME_ACCOUNTS;
export const CUENTAS_ABONO = ADVANCE_ACCOUNTS;
export const CUENTAS_BODEGA = BODEGA_ACCOUNTS;
export const NOMBRES_ABONO = ADVANCE_NAMES;
export const VENDEDORES_CONOCIDOS = KNOWN_VENDORS;
