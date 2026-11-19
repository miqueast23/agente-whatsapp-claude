// Retención RGPD — purga automática diaria.
// Política configurable en .env:
//   RETENCION_CHATS_DIAS=90   conversaciones sin actividad > N días
//   RETENCION_AUDIT_DIAS=730  eventos del registro > N días
//   RETENCION_CRON='0 3 * * *'  diario a las 03:00
//
// Justificación legal: art. 5.1.e RGPD (limitación del plazo de conservación)
// y art. 32 (medidas de seguridad). El RAT del despacho debe documentar
// los plazos elegidos por finalidad de tratamiento.

const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const config = require('./config');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONVERSACIONES_FILE = path.join(DATA_DIR, 'conversaciones.json');
const LOG_FILE = path.join(DATA_DIR, 'registro-consultas.jsonl');

function purgarConversaciones() {
  if (!fs.existsSync(CONVERSACIONES_FILE)) return { antes: 0, despues: 0 };
  const limite = Date.now() - config.retencion.chatsDias * 24 * 60 * 60 * 1000;
  let data;
  try {
    data = JSON.parse(fs.readFileSync(CONVERSACIONES_FILE, 'utf8'));
  } catch (err) {
    console.error('[retention] No puedo leer conversaciones:', err.message);
    return { antes: 0, despues: 0 };
  }
  const ids = Object.keys(data);
  const antes = ids.length;
  for (const id of ids) {
    const tsStr = data[id].actualizado || data[id].creado;
    const ts = tsStr ? Date.parse(tsStr) : 0;
    if (!ts || ts < limite) delete data[id];
  }
  const despues = Object.keys(data).length;
  if (antes !== despues) {
    const tmp = CONVERSACIONES_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(tmp, CONVERSACIONES_FILE);
  }
  return { antes, despues, eliminadas: antes - despues };
}

function purgarAudit() {
  if (!fs.existsSync(LOG_FILE)) return { antes: 0, despues: 0 };
  const limite = Date.now() - config.retencion.auditDias * 24 * 60 * 60 * 1000;
  const lineas = fs.readFileSync(LOG_FILE, 'utf8').split('\n');
  const conservadas = [];
  let antes = 0;
  for (const linea of lineas) {
    if (!linea.trim()) continue;
    antes++;
    try {
      const ev = JSON.parse(linea);
      const ts = ev.ts ? Date.parse(ev.ts) : 0;
      if (ts && ts >= limite) conservadas.push(linea);
    } catch (_) {
      // Líneas malformadas: las conservamos por trazabilidad.
      conservadas.push(linea);
    }
  }
  const despues = conservadas.length;
  if (antes !== despues) {
    const tmp = LOG_FILE + '.tmp';
    fs.writeFileSync(tmp, conservadas.join('\n') + (conservadas.length ? '\n' : ''), 'utf8');
    fs.renameSync(tmp, LOG_FILE);
  }
  return { antes, despues, eliminadas: antes - despues };
}

function ejecutarPurga() {
  console.log('[retention] Iniciando purga RGPD…');
  try {
    const c = purgarConversaciones();
    console.log(`[retention] Chats: ${c.antes} → ${c.despues} (eliminadas ${c.eliminadas || 0}, > ${config.retencion.chatsDias} días)`);
  } catch (err) {
    console.error('[retention] Error purgando chats:', err.message);
  }
  try {
    const a = purgarAudit();
    console.log(`[retention] Audit: ${a.antes} → ${a.despues} (eliminadas ${a.eliminadas || 0}, > ${config.retencion.auditDias} días)`);
  } catch (err) {
    console.error('[retention] Error purgando audit:', err.message);
  }
}

function iniciar() {
  if (!cron.validate(config.retencion.cron)) {
    console.error(`[retention] Cron inválido: ${config.retencion.cron}, desactivado.`);
    return;
  }
  cron.schedule(config.retencion.cron, ejecutarPurga);
  console.log(`[retention] Activado. Cron "${config.retencion.cron}" — chats ${config.retencion.chatsDias}d / audit ${config.retencion.auditDias}d.`);
}

module.exports = { iniciar, ejecutarPurga, purgarConversaciones, purgarAudit };
