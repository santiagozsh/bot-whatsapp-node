import { initializeWhatsApp } from './services/whatsapp.service';
import { inicializarDB } from './services/memory.service';

console.log('Iniciando el servidor...');
inicializarDB();
initializeWhatsApp();


// // Monitor de Recursos Interno (Se ejecuta cada 1 minuto)
// setInterval(() => {
//     const memoria = process.memoryUsage();
//     // rss (Resident Set Size) es la memoria RAM total que está usando Node.js
//     const ramEnMB = (memoria.rss / 1024 / 1024).toFixed(2);
//     console.log(`📊 [MONITOR] Uso de RAM actual: ${ramEnMB} MB`);
// }, 60000); // 60000 milisegundos = 1 minuto
