// Borrado RGPD — art. 17 (derecho de supresión / derecho al olvido).
// Uso:  npm run borrar-cliente -- +34600123456
//
// Elimina TODO rastro del cliente del bot:
//   1. data/conversaciones.json          → entrada con su chatId
//   2. data/registro-consultas.jsonl     → todas las líneas con su tel
//   3. data/chats-pausados.json          → su chatId si está
//   4. data/recordatorios-enviados.json  → ids que apunten a su tel (mejor esfuerzo)
//   5. data/creado-por-whatsapp/{TEL}*/  → carpeta de documentos generados
//
// NO toca audit en backup externo (eso es responsabilidad de tu infra).
// Genera un certificado de borrado en data/borrados-rgpd/.

const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONVERSACIONES_FILE = path.join(DATA_DIR, 'conversaciones.json');
const AUDIT_FILE = path.join(DATA_DIR, 'registro-consultas.jsonl');
const PAUSADOS_FILE = path.join(DATA_DIR, 'chats-pausados.json');
const RECORDATORIOS_FILE = path.join(DATA_DIR, 'recordatorios-enviados.json');
const DOCS_ROOT = path.join(DATA_DIR, 'creado-por-whatsapp');
const CERT_DIR = path.join(DATA_DIR, 'borrados-rgpd');

function leerJsonSeguro(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return fallback; }
}

function escribirAtomico(file, contenido) {
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, contenido, 'utf8');
  fs.renameSync(tmp, file);
}

function normalizarTel(input) {
  // Quita +, espacios, guiones, paréntesis, puntos.
  return String(input || '').replace(/[\s+\-().]/g, '');
}

function borrarConversaciones(tel) {
  const data = leerJsonSeguro(CONVERSACIONES_FILE, {});
  const chatId = `${tel}@c.us`;
  let borradas = 0;
  if (data[chatId]) { delete data[chatId]; borradas++; }
  // También buscar variantes (@g.us no aplica, pero por si acaso)
  for (const id of Object.keys(data)) {
    if (id.startsWith(tel + '@')) { delete data[id]; borradas++; }
  }
  if (borradas) escribirAtomico(CONVERSACIONES_FILE, JSON.stringify(data, null, 2));
  return borradas;
}

function borrarAudit(tel) {
  if (!fs.existsSync(AUDIT_FILE)) return 0;
  const lineas = fs.readFileSync(AUDIT_FILE, 'utf8').split('\n');
  const conservadas = [];
  let borradas = 0;
  for (const linea of lineas) {
    if (!linea.trim()) continue;
    try {
      const ev = JSON.parse(linea);
      if (ev.tel === tel) { borradas++; continue; }
    } catch (_) {}
    conservadas.push(linea);
  }
  escribirAtomico(AUDIT_FILE, conservadas.join('\n') + (conservadas.length ? '\n' : ''));
  return borradas;
}

function borrarPausados(tel) {
  const arr = leerJsonSeguro(PAUSADOS_FILE, []);
  const chatId = `${tel}@c.us`;
  const nueva = arr.filter((id) => id !== chatId && !id.startsWith(tel + '@'));
  if (nueva.length !== arr.length) escribirAtomico(PAUSADOS_FILE, JSON.stringify(nueva));
  return arr.length - nueva.length;
}

function borrarRecordatorios(tel) {
  // El índice guarda IDs de eventos de Google Calendar, no teléfonos. No
  // podemos asociar sin re-consultar Calendar → lo dejamos. Solo informativo.
  // Si reciclas el ID del evento puede haber falso positivo (envío repetido).
  return 0;
}

function borrarDocumentos(tel) {
  if (!fs.existsSync(DOCS_ROOT)) return 0;
  let borradas = 0;
  for (const sub of fs.readdirSync(DOCS_ROOT)) {
    if (sub.startsWith(tel)) {
      try {
        fs.rmSync(path.join(DOCS_ROOT, sub), { recursive: true, force: true });
        borradas++;
      } catch (err) {
        console.error(`[borrar] No puedo borrar ${sub}: ${err.message}`);
      }
    }
  }
  return borradas;
}

function emitirCertificado(tel, resultado) {
  fs.mkdirSync(CERT_DIR, { recursive: true });
  const ts = new Date().toISOString();
  const slug = ts.replace(/[:.]/g, '-').slice(0, 19);
  const file = path.join(CERT_DIR, `${slug}__${tel}.json`);
  const cert = {
    cliente_telefono: tel,
    fecha_solicitud: ts,
    base_legal: 'RGPD art. 17 — derecho de supresión',
    resultado,
    operador: process.env.USER || process.env.USERNAME || 'admin',
  };
  fs.writeFileSync(file, JSON.stringify(cert, null, 2));
  return file;
}

function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error('Uso: npm run borrar-cliente -- +34600123456');
    console.error('     (o también: node scripts/borrar-cliente.js +34600123456)');
    process.exit(1);
  }
  const tel = normalizarTel(arg);
  if (!/^\d{8,15}$/.test(tel)) {
    console.error(`Teléfono inválido tras normalizar: "${tel}" (esperaba 8-15 dígitos).`);
    process.exit(1);
  }

  console.log(`\n=== Borrado RGPD del cliente +${tel} ===\n`);
  const r = {
    conversaciones: borrarConversaciones(tel),
    audit: borrarAudit(tel),
    pausados: borrarPausados(tel),
    documentos: borrarDocumentos(tel),
    recordatorios_nota: 'No tocados (índice por id de evento, no por tel; ver borrar-cliente.js).',
  };

  console.log(`Conversaciones borradas:          ${r.conversaciones}`);
  console.log(`Eventos de audit borrados:        ${r.audit}`);
  console.log(`Entradas chats-pausados:          ${r.pausados}`);
  console.log(`Carpetas de documentos:           ${r.documentos}`);
  console.log(`\nRecordatorios-enviados:           ${r.recordatorios_nota}`);

  const certFile = emitirCertificado(tel, r);
  console.log(`\n✓ Certificado de borrado emitido: ${certFile}`);
  console.log('\nIMPORTANTE: este script NO borra datos en backups externos. Si tienes copias');
  console.log('en cloud, NAS o equipo del abogado, hay que purgar allí también (es tu obligación');
  console.log('como responsable del tratamiento).\n');
}

main();
