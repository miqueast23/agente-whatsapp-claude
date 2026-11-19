const { google } = require('googleapis');
const config = require('./config');

let calendarClient = null;

function getCalendar() {
  if (!config.calendarioDisponible) return null;
  if (calendarClient) return calendarClient;

  const oauth2 = new google.auth.OAuth2(config.google.clientId, config.google.clientSecret);
  oauth2.setCredentials({ refresh_token: config.google.refreshToken });
  calendarClient = google.calendar({ version: 'v3', auth: oauth2 });
  return calendarClient;
}

function parsearHora(hhmm) {
  const [h, m] = hhmm.split(':').map((n) => parseInt(n, 10));
  return { h, m };
}

function dentroDeHorario(date) {
  const inicio = parsearHora(config.horarioInicio);
  const fin = parsearHora(config.horarioFin);
  const minutos = date.getHours() * 60 + date.getMinutes();
  return minutos >= inicio.h * 60 + inicio.m && minutos + config.duracionCitaMinutos <= fin.h * 60 + fin.m;
}

function esLaborable(date) {
  const dia = date.getDay();
  return dia >= 1 && dia <= 5;
}

async function listarHuecos({ desde, hasta }) {
  const cal = getCalendar();
  if (!cal) {
    return { ok: false, error: 'Calendario no configurado.' };
  }

  const desdeFecha = desde ? new Date(desde) : new Date();
  const hastaFecha = hasta ? new Date(hasta) : new Date(desdeFecha.getTime() + 7 * 24 * 60 * 60 * 1000);

  let eventos;
  try {
    const resp = await cal.events.list({
      calendarId: config.google.calendarId,
      timeMin: desdeFecha.toISOString(),
      timeMax: hastaFecha.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
      maxResults: 250,
    });
    eventos = resp.data.items || [];
  } catch (err) {
    return { ok: false, error: `Error consultando calendario: ${err.message}` };
  }

  const ocupados = eventos
    .filter((e) => e.start && (e.start.dateTime || e.start.date))
    .map((e) => ({
      inicio: new Date(e.start.dateTime || e.start.date).getTime(),
      fin: new Date(e.end.dateTime || e.end.date).getTime(),
    }));

  const huecos = [];
  const cursor = new Date(desdeFecha);
  cursor.setSeconds(0, 0);
  if (cursor.getMinutes() % 15 !== 0) {
    cursor.setMinutes(cursor.getMinutes() + (15 - (cursor.getMinutes() % 15)));
  }

  const duracionMs = config.duracionCitaMinutos * 60 * 1000;

  while (cursor < hastaFecha && huecos.length < 12) {
    if (esLaborable(cursor) && dentroDeHorario(cursor)) {
      const inicio = cursor.getTime();
      const fin = inicio + duracionMs;
      const colisiona = ocupados.some((o) => !(fin <= o.inicio || inicio >= o.fin));
      if (!colisiona && inicio > Date.now()) {
        huecos.push({
          inicio: new Date(inicio).toISOString(),
          fin: new Date(fin).toISOString(),
        });
      }
    }
    cursor.setMinutes(cursor.getMinutes() + 30);
  }

  return { ok: true, huecos, timezone: config.timezone };
}

async function crearCita({ inicio, duracionMinutos, nombreCliente, telefono, asunto }) {
  const cal = getCalendar();
  if (!cal) {
    return { ok: false, error: 'Calendario no configurado.' };
  }

  const inicioDate = new Date(inicio);
  if (isNaN(inicioDate.getTime())) {
    return { ok: false, error: 'Fecha inválida.' };
  }
  const duracion = duracionMinutos || config.duracionCitaMinutos;
  const finDate = new Date(inicioDate.getTime() + duracion * 60 * 1000);

  try {
    const evento = await cal.events.insert({
      calendarId: config.google.calendarId,
      requestBody: {
        summary: `Consulta: ${nombreCliente || 'cliente WhatsApp'} — ${asunto || 'sin asunto'}`,
        description: [
          `Cliente: ${nombreCliente || '(no facilitado)'}`,
          `Teléfono: ${telefono || '(no facilitado)'}`,
          `Asunto: ${asunto || '(no facilitado)'}`,
          '',
          'Cita generada automáticamente por el asistente de WhatsApp.',
        ].join('\n'),
        start: { dateTime: inicioDate.toISOString(), timeZone: config.timezone },
        end: { dateTime: finDate.toISOString(), timeZone: config.timezone },
      },
    });

    return {
      ok: true,
      id: evento.data.id,
      htmlLink: evento.data.htmlLink,
      inicio: inicioDate.toISOString(),
      fin: finDate.toISOString(),
    };
  } catch (err) {
    return { ok: false, error: `Error creando evento: ${err.message}` };
  }
}

module.exports = { listarHuecos, crearCita };
