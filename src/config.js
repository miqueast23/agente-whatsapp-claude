require('dotenv').config();

const config = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6',

  despachoNombre: process.env.DESPACHO_NOMBRE || 'el despacho',
  abogadoTelefono: process.env.ABOGADO_TELEFONO || '',
  abogadoNombre: process.env.ABOGADO_NOMBRE || 'el abogado',

  historialMaxMensajes: parseInt(process.env.HISTORIAL_MAX_MENSAJES || '20', 10),
  soloPrivados: (process.env.SOLO_PRIVADOS || 'true').toLowerCase() === 'true',

  openaiApiKey: process.env.OPENAI_API_KEY || '',
  whisperModelo: process.env.WHISPER_MODELO || 'whisper-1',

  google: {
    clientId: process.env.GOOGLE_CLIENT_ID || '',
    clientSecret: process.env.GOOGLE_CLIENT_SECRET || '',
    refreshToken: process.env.GOOGLE_REFRESH_TOKEN || '',
    calendarId: process.env.GOOGLE_CALENDAR_ID || 'primary',
  },
  timezone: process.env.DESPACHO_TIMEZONE || 'Europe/Madrid',
  horarioInicio: process.env.DESPACHO_HORARIO_INICIO || '10:00',
  horarioFin: process.env.DESPACHO_HORARIO_FIN || '19:00',
  duracionCitaMinutos: parseInt(process.env.DURACION_CITA_MINUTOS || '45', 10),

  recordatorios: {
    activados: (process.env.RECORDATORIOS_ACTIVADOS || 'true').toLowerCase() === 'true',
    horasAntes: parseInt(process.env.RECORDATORIOS_HORAS_ANTES || '24', 10),
    cron: process.env.RECORDATORIOS_CRON || '*/30 * * * *',
  },

  slackWebhook: process.env.SLACK_WEBHOOK_URL || '',
  smtp: {
    host: process.env.SMTP_HOST || '',
    port: parseInt(process.env.SMTP_PORT || '587', 10),
    secure: (process.env.SMTP_SECURE || 'false').toLowerCase() === 'true',
    user: process.env.SMTP_USER || '',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '',
    to: process.env.EMAIL_ABOGADO || '',
  },

  baseLegal: {
    path: process.env.BASE_LEGAL_PATH || '',
    maxCharsPorDoc: parseInt(process.env.BASE_LEGAL_MAX_CHARS_POR_DOC || '80000', 10),
  },

  webPanel: {
    activado: (process.env.WEB_PANEL_ACTIVADO || 'true').toLowerCase() === 'true',
    port: parseInt(process.env.WEB_PORT || '3000', 10),
    bind: process.env.WEB_BIND || '127.0.0.1', // SEGURIDAD: por defecto solo loopback
    user: process.env.WEB_USER || 'admin',
    pass: process.env.WEB_PASS || '',
  },

  retencion: {
    chatsDias: parseInt(process.env.RETENCION_CHATS_DIAS || '90', 10),
    auditDias: parseInt(process.env.RETENCION_AUDIT_DIAS || '730', 10),
    cron: process.env.RETENCION_CRON || '0 3 * * *', // 03:00 diario
  },

  media: {
    maxBytes: parseInt(process.env.MEDIA_MAX_BYTES || '20971520', 10), // 20 MB
  },

  puppeteerExecutablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
};

config.transcripcionDisponible = Boolean(config.openaiApiKey);
config.calendarioDisponible = Boolean(
  config.google.clientId && config.google.clientSecret && config.google.refreshToken
);
config.slackDisponible = Boolean(config.slackWebhook);
config.emailDisponible = Boolean(
  config.smtp.host && config.smtp.user && config.smtp.pass && config.smtp.from && config.smtp.to
);
config.baseLegalDisponible = Boolean(config.baseLegal.path);

if (!config.anthropicApiKey) {
  console.error('[config] Falta ANTHROPIC_API_KEY en .env');
  process.exit(1);
}

module.exports = config;
