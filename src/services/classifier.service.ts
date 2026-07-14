import { leerIngresosTransacciones, leerVentas, actualizarFilaIngreso } from './sheets.service';
import { logger } from '../utils/logger';
import type { FilaVenta } from './sheets.service';

const MESES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];

const formatearFechaHoy = (): string => {
    const hoy = new Date();
    const dia = hoy.getDate();
    const mes = MESES[hoy.getMonth()];
    const anio = hoy.getFullYear();
    return `${dia}-${mes}-${anio}`;
};

const parsearPrecio = (precio: string): number => {
    const limpio = precio.replace(/[^0-9]/g, '');
    return parseInt(limpio, 10) || 0;
};

export const clasificarPedidosDelDia = async (): Promise<void> => {
    logger.info('CLASSIFIER', 'Iniciando clasificación diaria...');

    const [ingresos, ventas] = await Promise.all([leerIngresosTransacciones(), leerVentas()]);

    const ventasPorPedido = new Map<string, FilaVenta>();
    for (const venta of ventas) {
        if (venta.nPedido) {
            ventasPorPedido.set(venta.nPedido, venta);
        }
    }

    const fechaHoy = formatearFechaHoy();
    const pedidosHoy = ingresos.filter((ing) => ing.fecha === fechaHoy);

    logger.info('CLASSIFIER', `${pedidosHoy.length} pedidos del día (${fechaHoy}) a revisar`);

    let actualizados = 0;

    for (const ingreso of pedidosHoy) {
        const venta = ventasPorPedido.get(ingreso.nPedido);
        let clasificacion: string;

        if (venta) {
            const total = venta.cantidadRelojes + venta.cantidadOtros;
            clasificacion = total >= 3 ? 'Pedido al por mayor' : 'Pedido al por menor';
        } else {
            const precio = parsearPrecio(ingreso.precioCompra);
            clasificacion = precio >= 250000 ? 'Pedido al por mayor' : 'Pedido al por menor';
        }

        if (ingreso.descripcion !== clasificacion) {
            await actualizarFilaIngreso(ingreso.fila, { descripcion: clasificacion });
            logger.info('CLASSIFIER', `${ingreso.nPedido}: "${ingreso.descripcion}" → "${clasificacion}"`);
            actualizados++;
        }
    }

    logger.info('CLASSIFIER', `Clasificación diaria completada. ${actualizados} pedidos actualizados.`);
};
