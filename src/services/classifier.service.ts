import { readIncomeRows, readSalesRows, updateIncomeRow } from './sheets.service';
import { logger } from '../utils/logger';
import type { IncomeRow, SalesRow } from './sheets.service';

const SPANISH_MONTHS = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

/**
 * Returns a date string formatted as "D-Mes-YYYY" matching the Google Sheets date schema.
 * 
 * @param date - Optional date instance (defaults to current system time).
 */
export const getFormattedTodayDate = (date: Date = new Date()): string => {
    const day = date.getDate();
    const month = SPANISH_MONTHS[date.getMonth()];
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
};

// Backward-compatible alias
export const formatearFechaHoy = getFormattedTodayDate;

/**
 * Parses numeric price integers from currency strings (e.g. "$165.000" -> 165000).
 * 
 * @param priceString - Raw price string from income record.
 */
export const parseNumericPrice = (priceString: string): number => {
    const cleanNumber = priceString.replace(/[^0-9]/g, '');
    return parseInt(cleanNumber, 10) || 0;
};

// Backward-compatible alias
export const parsearPrecio = parseNumericPrice;

const WHOLESALE_QUANTITY_THRESHOLD = 3;
const WHOLESALE_PRICE_THRESHOLD = 250000;

/**
 * Determines whether an order is wholesale ("Pedido al por mayor") or retail ("Pedido al por menor").
 * Evaluates total unit quantity (watches + accessories >= 3) if sales row is populated.
 * Falls back to price threshold (>= $250,000 COP) if sales row is missing.
 * 
 * @param incomeRecord - The income transaction record.
 * @param salesRecord - Optional linked sales row record.
 */
export function determineOrderClassification(
    incomeRecord: IncomeRow,
    salesRecord?: SalesRow
): 'Pedido al por mayor' | 'Pedido al por menor' {
    if (salesRecord) {
        const totalUnits = salesRecord.cantidadRelojes + salesRecord.cantidadOtros;
        return totalUnits >= WHOLESALE_QUANTITY_THRESHOLD
            ? 'Pedido al por mayor'
            : 'Pedido al por menor';
    }

    const price = parseNumericPrice(incomeRecord.precioCompra);
    return price >= WHOLESALE_PRICE_THRESHOLD
        ? 'Pedido al por mayor'
        : 'Pedido al por menor';
}

/**
 * Nightly cron worker that inspects all income transactions recorded for the current day,
 * evaluates wholesale vs retail eligibility, and idempotently updates Column D (Descripción)
 * in Google Sheets if the classification differs from the default.
 */
export const classifyDailyOrders = async (): Promise<void> => {
    logger.info('CLASSIFIER', 'Starting daily order classification worker...');

    const [incomeRows, salesRows] = await Promise.all([readIncomeRows(), readSalesRows()]);

    const salesByOrderId = new Map<string, SalesRow>();
    for (const sale of salesRows) {
        if (sale.nPedido) {
            salesByOrderId.set(sale.nPedido, sale);
        }
    }

    const todayDateString = getFormattedTodayDate();
    const todayOrders = incomeRows.filter((ing) => ing.fecha === todayDateString);

    logger.info('CLASSIFIER', `${todayOrders.length} order(s) found for today (${todayDateString}) to review`);

    let updatedCount = 0;

    for (const income of todayOrders) {
        const salesRecord = salesByOrderId.get(income.nPedido);
        const classification = determineOrderClassification(income, salesRecord);

        if (income.descripcion !== classification) {
            await updateIncomeRow(income.fila, { descripcion: classification });
            logger.info('CLASSIFIER', `${income.nPedido}: "${income.descripcion}" → "${classification}"`);
            updatedCount++;
        }
    }

    logger.info('CLASSIFIER', `Daily classification completed: ${updatedCount} order(s) updated.`);
};

// Backward-compatible alias
export const clasificarPedidosDelDia = classifyDailyOrders;
