const nodemailer = require('nodemailer');
const config = require('./config');

let transporter = null;
function getTransporter() {
  if (!config.emailDisponible) return null;
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: config.smtp.host,
    port: config.smtp.port,
    secure: config.smtp.secure,
    auth: { user: config.smtp.user, pass: config.smtp.pass },
  });
  return transporter;
}

async function notificarSlack(texto) {
  if (!config.slackDisponible) return { ok: false, motivo: 'slack no configurado' };
  try {
    const resp = await fetch(config.slackWebhook, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: texto }),
    });
    if (!resp.ok) {
      return { ok: false, motivo: `slack respondió ${resp.status}` };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, motivo: err.message };
  }
}

async function notificarEmail({ asunto, texto }) {
  const t = getTransporter();
  if (!t) return { ok: false, motivo: 'email no configurado' };
  try {
    await t.sendMail({
      from: config.smtp.from,
      to: config.smtp.to,
      subject: asunto,
      text: texto,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, motivo: err.message };
  }
}

async function notificarDerivacion({ motivo, resumen, urgencia, telefono, nombreCliente, chatId }) {
  const urgenciaIcon = urgencia === 'alta' ? '🔴' : urgencia === 'media' ? '🟡' : '🟢';
  const asunto = `${urgenciaIcon} Derivación WhatsApp — ${motivo}`;

  const cuerpoLineas = [
    `Urgencia: ${urgencia || 'no especificada'}`,
    `Motivo: ${motivo}`,
    `Cliente: ${nombreCliente || 'no facilitado'}`,
    `Teléfono: ${telefono || 'no facilitado'}`,
    `Chat ID: ${chatId || ''}`,
    '',
    'Resumen del caso:',
    resumen || '(sin resumen)',
    '',
    `Para retomar la conversación, abre WhatsApp y busca el contacto, o pausa al bot escribiendo /pausa desde ese chat (también desde el panel web).`,
  ];
  const cuerpo = cuerpoLineas.join('\n');

  const resultados = await Promise.allSettled([
    notificarSlack(`*${asunto}*\n\`\`\`${cuerpo}\`\`\``),
    notificarEmail({ asunto, texto: cuerpo }),
  ]);

  // I19: si Slack o email fallaron, mostrar el motivo real (antes solo status).
  const slackInfo = resultados[0].status === 'rejected'
    ? `rechazado: ${resultados[0].reason?.message || resultados[0].reason}`
    : (resultados[0].value?.ok ? 'ok' : `no enviado (${resultados[0].value?.motivo})`);
  const emailInfo = resultados[1].status === 'rejected'
    ? `rechazado: ${resultados[1].reason?.message || resultados[1].reason}`
    : (resultados[1].value?.ok ? 'ok' : `no enviado (${resultados[1].value?.motivo})`);
  console.log(`[notif] Derivación → slack=${slackInfo} | email=${emailInfo} | motivo="${motivo}"`);

  return {
    slack: resultados[0].value || { ok: false, motivo: 'no enviado' },
    email: resultados[1].value || { ok: false, motivo: 'no enviado' },
  };
}

module.exports = { notificarSlack, notificarEmail, notificarDerivacion };
