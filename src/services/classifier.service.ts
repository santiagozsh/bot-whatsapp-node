import { readIncomeRows, readSalesRows, updateIncomeRow } from './sheets.service';
import { logger } from '../utils/logger';
import { classifyOrderDescription, WHOLESALE_QUANTITY_THRESHOLD, WHOLESALE_PRICE_THRESHOLD } from '../utils/helpers';
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

/**
 * Determines whether an order is wholesale ("Pedido mayorista") or retail ("Pedido al por menor"),
 * preserving "PAGOS CONTRAENTREGA" as inviolable.
 * Evaluates whether total unit quantity >= 3 OR price > $250,000 COP.
 * 
 * @param incomeRecord - The income transaction record.
 * @param salesRecord - Optional linked sales row record.
 */
export function determineOrderClassification(
    incomeRecord: IncomeRow,
    salesRecord?: SalesRow
): 'Pedido mayorista' | 'Pedido al por menor' | 'PAGOS CONTRAENTREGA' {
    if (incomeRecord.descripcion === 'PAGOS CONTRAENTREGA') {
        return 'PAGOS CONTRAENTREGA';
    }

    const totalUnits = salesRecord
        ? (salesRecord.cantidadRelojes + salesRecord.cantidadOtros)
        : 0;

    return classifyOrderDescription(incomeRecord.precioCompra, totalUnits);
}

/**
 * Nightly cron worker that inspects all income transactions recorded for the current day,
 * evaluates wholesale vs retail eligibility, and idempotently updates Column D (Descripción)
 * in Google Sheets if the classification differs from the default.
 * Rows marked as "PAGOS CONTRAENTREGA" are strictly preserved.
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
        if (income.descripcion === 'PAGOS CONTRAENTREGA') {
            continue;
        }

        const salesRecord = salesByOrderId.get(income.nPedido);
        const classification = determineOrderClassification(income, salesRecord);

        if (classification !== 'PAGOS CONTRAENTREGA' && income.descripcion !== classification) {
            await updateIncomeRow(income.fila, { descripcion: classification });
            logger.info('CLASSIFIER', `${income.nPedido}: "${income.descripcion}" → "${classification}"`);
            updatedCount++;
        }
    }

    logger.info('CLASSIFIER', `Daily classification completed: ${updatedCount} order(s) updated.`);
};

// Backward-compatible alias
export const clasificarPedidosDelDia = classifyDailyOrders;
