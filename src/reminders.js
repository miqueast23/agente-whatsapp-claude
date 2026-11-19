const fs = require('fs');
const path = require('path');
const cron = require('node-cron');
const { google } = require('googleapis');
const config = require('./config');

const DATA_DIR = path.join(__dirname, '..', 'data');
const ENVIADOS_FILE = path.join(DATA_DIR, 'recordatorios-enviados.json');

let enviados = new Set();
if (fs.existsSync(ENVIADOS_FILE)) {
  try {
    enviados = new Set(JSON.parse(fs.readFileSync(ENVIADOS_FILE, 'utf8')));
  } catch (err) {
    console.warn('[recordatorios] No puedo leer índice de enviados:', err.message);
  }
}

function persistirEnviados() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(ENVIADOS_FILE, JSON.stringify([...enviados]), 'utf8');
}

function getCalendar() {
  if (!config.calendarioDisponible) return null;
  const oauth2 = new google.auth.OAuth2(config.google.clientId, config.google.clientSecret);
  oauth2.setCredentials({ refresh_token: config.google.refreshToken });
  return google.calendar({ version: 'v3', auth: oauth2 });
}

function extraerTelefonoDescripcion(descripcion) {
  if (!descripcion) return null;
  const m = descripcion.match(/Tel[eé]fono:\s*(\+?\d[\d\s.-]{6,})/i);
  if (!m) return null;
  return m[1].replace(/[\s.\-]/g, '').replace(/^\+/, '');
}

function extraerNombreDescripcion(descripcion) {
  if (!descripcion) return null;
  const m = descripcion.match(/Cliente:\s*([^\n]+)/i);
  return m ? m[1].trim() : null;
}

function formatearFecha(date) {
  return new Intl.DateTimeFormat('es-ES', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: config.timezone,
  }).format(date);
}

async function chequearYEnviar(whatsappClient) {
  const cal = getCalendar();
  if (!cal) return;

  const ahora = new Date();
  const horasAntes = config.recordatorios.horasAntes;
  const margenMin = 30;
  const desde = new Date(ahora.getTime() + (horasAntes * 60 - margenMin) * 60 * 1000);
  const hasta = new Date(ahora.getTime() + (horasAntes * 60 + margenMin) * 60 * 1000);

  let eventos;
  try {
    const resp = await cal.events.list({
      calendarId: config.google.calendarId,
      timeMin: desde.toISOString(),
      timeMax: hasta.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });
    eventos = resp.data.items || [];
  } catch (err) {
    console.error('[recordatorios] Error consultando calendario:', err.message);
    return;
  }

  for (const ev of eventos) {
    if (!ev.id || enviados.has(ev.id)) continue;
    if (!ev.start?.dateTime) continue;

    const telefono = extraerTelefonoDescripcion(ev.description);
    if (!telefono) {
      console.log(`[recordatorios] Evento ${ev.id} sin teléfono parseable, salto.`);
      continue;
    }
    const nombre = extraerNombreDescripcion(ev.description) || 'hola';
    const inicio = new Date(ev.start.dateTime);
    const cuando = formatearFecha(inicio);

    const mensaje =
      `Hola ${nombre}, te recordamos tu cita en ${config.despachoNombre} el ${cuando}. ` +
      `Si no puedes acudir, por favor avísanos respondiendo a este mensaje. ¡Te esperamos!`;

    const chatId = `${telefono}@c.us`;
    try {
      await whatsappClient.sendMessage(chatId, mensaje);
      enviados.add(ev.id);
      persistirEnviados();
      console.log(`[recordatorios] Enviado a ${telefono} para evento ${ev.id} (${cuando}).`);
    } catch (err) {
      console.error(`[recordatorios] Error enviando a ${telefono}: ${err.message}`);
    }
  }
}

function iniciar(whatsappClient) {
  if (!config.recordatorios.activados) {
    console.log('[recordatorios] Desactivados (RECORDATORIOS_ACTIVADOS=false).');
    return;
  }
  if (!config.calendarioDisponible) {
    console.log('[recordatorios] No se inician (calendar no configurado).');
    return;
  }
  if (!cron.validate(config.recordatorios.cron)) {
    console.error(`[recordatorios] Expresión cron inválida: ${config.recordatorios.cron}`);
    return;
  }

  // Mutex anti-overlap: si una ejecución tarda más de un tick (p.ej. Google
  // Calendar timeout), no arrancamos otra encima → evitamos recordatorios
  // duplicados al cliente por race en `enviados.add(ev.id)`.
  let ejecutandose = false;
  cron.schedule(config.recordatorios.cron, () => {
    if (ejecutandose) {
      console.log('[recordatorios] Skip: ejecución anterior aún en curso.');
      return;
    }
    ejecutandose = true;
    chequearYEnviar(whatsappClient)
      .catch((err) => console.error('[recordatorios] Excepción no controlada:', err))
      .finally(() => { ejecutandose = false; });
  });

  console.log(`[recordatorios] Activados. Cron: "${config.recordatorios.cron}", ${config.recordatorios.horasAntes}h antes.`);
  setTimeout(() => chequearYEnviar(whatsappClient).catch(() => {}), 30 * 1000);
}

module.exports = { iniciar };
