const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const basicAuth = require('basic-auth');
const config = require('./config');
const baseLegal = require('./baseLegal');
const audit = require('./audit');
const documentos = require('./documentos');

const DATA_DIR = path.join(__dirname, '..', 'data');
const CONVERSACIONES_FILE = path.join(DATA_DIR, 'conversaciones.json');

function leerConversaciones() {
  if (!fs.existsSync(CONVERSACIONES_FILE)) return {};
  try { return JSON.parse(fs.readFileSync(CONVERSACIONES_FILE, 'utf8')); } catch { return {}; }
}

function escapeHtml(s) {
  if (s == null) return '';
  if (typeof s !== 'string') s = String(s);
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function chatIdALegible(chatId) {
  return chatId.replace('@c.us', '').replace('@g.us', ' (grupo)');
}

function ultimoMensajeTexto(msg) {
  if (typeof msg?.content === 'string') return msg.content;
  if (Array.isArray(msg?.content)) {
    return msg.content.filter((b) => b.type === 'text').map((b) => b.text).join(' ') || '[contenido multimodal]';
  }
  return '';
}

const PAGE_CSS = `
<style>
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Segoe UI", system-ui, sans-serif; margin: 0; background: #f4f5f7; color: #1d1d1f; }
  header { background: #075e54; color: #fff; padding: 14px 24px; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 12px; }
  header h1 { margin: 0; font-size: 17px; }
  header nav a { color: #d1f5ed; text-decoration: none; margin-left: 16px; font-size: 14px; }
  header nav a.active { color: #fff; font-weight: 600; }
  main { max-width: 1200px; margin: 24px auto; padding: 0 16px; }
  .card { background: #fff; border-radius: 12px; box-shadow: 0 1px 3px rgba(0,0,0,0.08); margin-bottom: 16px; overflow: hidden; }
  .card-head { padding: 14px 18px; border-bottom: 1px solid #eee; font-weight: 600; display: flex; justify-content: space-between; align-items: center; }
  .chat-list, .doc-list, .log-list { list-style: none; margin: 0; padding: 0; }
  .chat-list li, .doc-list li, .log-list li { padding: 12px 18px; border-bottom: 1px solid #f0f0f0; }
  .chat-list li:last-child, .doc-list li:last-child, .log-list li:last-child { border-bottom: none; }
  .chat-list li { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
  .chat-list a, .doc-list a { color: #1d1d1f; text-decoration: none; font-weight: 500; }
  .preview { color: #6b6b6b; font-size: 13px; margin-top: 4px; max-width: 700px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .meta { font-size: 12px; color: #999; text-align: right; flex-shrink: 0; }
  .msg { padding: 8px 12px; margin: 4px 0; border-radius: 10px; max-width: 75%; }
  .msg.user { background: #dcf8c6; align-self: flex-end; margin-left: auto; }
  .msg.assistant { background: #fff; align-self: flex-start; border: 1px solid #eee; }
  .msgs { display: flex; flex-direction: column; padding: 14px; gap: 4px; background: #ece5dd; }
  .role-label { font-size: 11px; color: #555; margin-bottom: 2px; }
  .actions { padding: 14px 18px; display: flex; gap: 8px; background: #fafafa; border-top: 1px solid #eee; flex-wrap: wrap; }
  button, .btn { padding: 8px 14px; border-radius: 8px; border: none; cursor: pointer; font-size: 13px; background: #075e54; color: #fff; text-decoration: none; display: inline-block; }
  button.warn, .btn.warn { background: #c0392b; }
  button.ghost, .btn.ghost { background: #6b7280; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; background: #ffe5b4; color: #8a4b00; font-size: 11px; margin-left: 8px; }
  .badge.green { background: #c8f7c5; color: #1b5e20; }
  .badge.red { background: #ffd1d1; color: #8b1a1a; }
  .empty { padding: 32px; text-align: center; color: #888; }
  pre { white-space: pre-wrap; margin: 0; font-family: inherit; word-break: break-word; }
  .stats { display: flex; gap: 18px; padding: 14px 18px; font-size: 13px; color: #555; flex-wrap: wrap; }
  .stats .num { font-size: 18px; font-weight: 600; color: #1d1d1f; display: block; }
  table.t { width: 100%; border-collapse: collapse; font-size: 13px; }
  table.t th { text-align: left; padding: 10px 14px; background: #fafafa; border-bottom: 1px solid #eee; font-weight: 600; }
  table.t td { padding: 8px 14px; border-bottom: 1px solid #f4f4f4; vertical-align: top; }
  table.t tr:hover td { background: #fcfcfc; }
  .tag { display: inline-block; padding: 1px 6px; border-radius: 5px; background: #eef2ff; color: #3730a3; font-size: 11px; margin-right: 4px; }
  .doc-files a { margin-right: 10px; font-size: 12px; color: #075e54; }
  form.search { padding: 12px 18px; display: flex; gap: 8px; }
  form.search input[type=text] { flex: 1; padding: 8px 12px; border-radius: 8px; border: 1px solid #ddd; font-size: 13px; }
</style>`;

function navHtml(activo) {
  const items = [
    ['/', 'Chats'],
    ['/documentos', 'Documentos'],
    ['/registro', 'Registro'],
    ['/base-legal', 'Base legal'],
  ];
  return items.map(([h, t]) => `<a href="${h}" class="${activo === h ? 'active' : ''}">${t}</a>`).join('');
}

function pagina(titulo, activo, contenido) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(titulo)}</title>${PAGE_CSS}</head>
<body>
<header>
  <h1>${escapeHtml(config.despachoNombre)} — Panel WhatsApp</h1>
  <nav>${navHtml(activo)}</nav>
</header>
<main>${contenido}</main>
</body></html>`;
}

// Comparación constante en tiempo: protege contra timing attacks que
// podrían recuperar la contraseña carácter a carácter midiendo latencias.
function safeEq(a, b) {
  const ba = Buffer.from(String(a || ''), 'utf8');
  const bb = Buffer.from(String(b || ''), 'utf8');
  // timingSafeEqual exige misma longitud → padea al máximo común y compara
  // también la longitud para que no se filtre por el length.
  const len = Math.max(ba.length, bb.length, 1);
  const pa = Buffer.alloc(len); ba.copy(pa);
  const pb = Buffer.alloc(len); bb.copy(pb);
  return crypto.timingSafeEqual(pa, pb) && ba.length === bb.length;
}

function autenticar(req, res, next) {
  const c = basicAuth(req);
  const okUser = c && safeEq(c.name, config.webPanel.user);
  const okPass = c && safeEq(c.pass, config.webPanel.pass);
  if (!okUser || !okPass) {
    res.set('WWW-Authenticate', 'Basic realm="Panel WhatsApp"');
    return res.status(401).send('Auth required');
  }
  next();
}

function iniciar({ chatsPausados }) {
  if (!config.webPanel.activado) {
    console.log('[panel] Desactivado.');
    return;
  }
  if (!config.webPanel.pass || config.webPanel.pass === 'cambia-esto') {
    console.warn('[panel] AVISO: WEB_PASS por defecto. Cambia la contraseña en .env.');
  }
  if (config.webPanel.pass && config.webPanel.pass.length < 12) {
    console.warn('[panel] AVISO: WEB_PASS débil (<12 caracteres). Considera reforzarla.');
  }

  const app = express();
  app.disable('x-powered-by'); // No filtrar versión de Express
  app.use(autenticar);
  app.use(express.urlencoded({ extended: false }));

  // CSRF mínimo para POST: exigir cabecera X-Requested-With o referer del propio panel.
  app.use((req, res, next) => {
    if (req.method !== 'POST') return next();
    const ref = req.get('referer') || '';
    const xhr = req.get('x-requested-with') || '';
    const host = req.get('host') || '';
    if (xhr === 'XMLHttpRequest' || ref.includes(host)) return next();
    return res.status(403).send('Forbidden (CSRF)');
  });

  // ── Chats ────────────────────────────────────────────────────────────────
  app.get('/', (req, res) => {
    const conversaciones = leerConversaciones();
    const entries = Object.entries(conversaciones).sort((a, b) => {
      const ta = a[1].actualizado || a[1].creado || '';
      const tb = b[1].actualizado || b[1].creado || '';
      return tb.localeCompare(ta);
    });

    const items = entries.map(([chatId, conv]) => {
      const ultimo = conv.mensajes?.at(-1);
      const preview = ultimoMensajeTexto(ultimo).slice(0, 120);
      const pausa = chatsPausados.has(chatId) ? '<span class="badge">pausado</span>' : '';
      return `<li>
        <div>
          <a href="/chat/${encodeURIComponent(chatId)}">${escapeHtml(chatIdALegible(chatId))}</a>${pausa}
          <div class="preview">${escapeHtml(preview)}</div>
        </div>
        <div class="meta">${escapeHtml((conv.actualizado || '').slice(0, 16).replace('T', ' '))}<br>${conv.mensajes?.length || 0} msgs</div>
      </li>`;
    }).join('');

    const stats = baseLegal.estadoIndice();
    const docs = documentos.listarDocumentos({ max: 1 });
    const logCount = audit.leerUltimos({ max: 99999 }).length;

    const html = `
      <div class="card">
        <div class="stats">
          <div><span class="num">${entries.length}</span> conversaciones</div>
          <div><span class="num">${docs.total}</span> documentos creados</div>
          <div><span class="num">${stats.documentos}</span> docs base legal</div>
          <div><span class="num">${logCount}</span> eventos registrados</div>
          <div><span class="num">${config.transcripcionDisponible ? 'sí' : 'no'}</span> transcripción</div>
          <div><span class="num">${config.calendarioDisponible ? 'sí' : 'no'}</span> calendario</div>
        </div>
      </div>
      <div class="card">
        <div class="card-head">Conversaciones</div>
        ${items ? `<ul class="chat-list">${items}</ul>` : '<div class="empty">Aún no hay conversaciones.</div>'}
      </div>`;
    res.send(pagina('Chats', '/', html));
  });

  app.get('/chat/:id', (req, res) => {
    const chatId = req.params.id;
    const conversaciones = leerConversaciones();
    const conv = conversaciones[chatId];
    if (!conv) return res.status(404).send(pagina('Chat', '/', '<div class="empty">Conversación no encontrada.</div>'));

    const pausa = chatsPausados.has(chatId);
    const msgs = (conv.mensajes || []).map((m) => {
      const texto = ultimoMensajeTexto(m);
      return `<div class="msg ${m.role}">
        <div class="role-label">${m.role === 'user' ? 'Cliente' : 'Asistente'}</div>
        <pre>${escapeHtml(texto)}</pre>
      </div>`;
    }).join('');

    const html = `
      <div class="card">
        <div class="card-head">
          ${escapeHtml(chatIdALegible(chatId))}
          ${pausa ? '<span class="badge">pausado</span>' : ''}
        </div>
        <div class="msgs">${msgs || '<div class="empty">Sin mensajes.</div>'}</div>
        <div class="actions">
          <form method="post" action="/chat/${encodeURIComponent(chatId)}/${pausa ? 'reanudar' : 'pausar'}">
            <button class="ghost">${pausa ? 'Reanudar' : 'Pausar'}</button>
          </form>
          <form method="post" action="/chat/${encodeURIComponent(chatId)}/reset" onsubmit="return confirm('¿Reiniciar conversación? Se borra el historial.');">
            <button class="warn">Reiniciar</button>
          </form>
          <a class="btn ghost" href="/">Volver</a>
        </div>
      </div>`;
    res.send(pagina('Chat', '/', html));
  });

  app.post('/chat/:id/pausar', (req, res) => { chatsPausados.add(req.params.id); res.redirect(`/chat/${encodeURIComponent(req.params.id)}`); });
  app.post('/chat/:id/reanudar', (req, res) => { chatsPausados.delete(req.params.id); res.redirect(`/chat/${encodeURIComponent(req.params.id)}`); });
  app.post('/chat/:id/reset', (req, res) => {
    const { reiniciarChat } = require('./storage');
    reiniciarChat(req.params.id);
    res.redirect('/');
  });

  // ── Documentos creados ───────────────────────────────────────────────────
  app.get('/documentos', (req, res) => {
    const filtroTel = (req.query.tel || '').trim();
    const lista = documentos.listarDocumentos({
      cliente_telefono: filtroTel || undefined,
      max: 200,
    });

    const items = lista.documentos.map((d) => {
      const archivos = (d.archivos || []).map((a) =>
        `<a href="/documentos/archivo/${encodeURIComponent(d.documento_id)}/${encodeURIComponent(a)}">${a}</a>`
      ).join(' ');
      const pdf = d.pdf_exportado ? '<span class="badge green">PDF</span>' : '<span class="badge">sólo Word</span>';
      return `<li>
        <div style="display:flex; justify-content:space-between; gap:16px; align-items:flex-start;">
          <div>
            <div><strong>${escapeHtml(d.titulo)}</strong> ${pdf}</div>
            <div class="preview">tipo: ${escapeHtml(d.tipo || '-')} · cliente: ${escapeHtml(d.cliente_nombre || '-')}${d.cliente_telefono ? ' · +' + escapeHtml(d.cliente_telefono) : ''} · origen: ${escapeHtml(d.origen || '-')}</div>
            <div class="doc-files">${archivos}</div>
          </div>
          <div class="meta">${escapeHtml((d.creado || '').slice(0,19).replace('T',' '))}</div>
        </div>
      </li>`;
    }).join('');

    const html = `
      <div class="card">
        <div class="card-head">
          Documentos creados por el agente
          <span class="meta">${lista.total} en total</span>
        </div>
        <form class="search" method="get">
          <input type="text" name="tel" placeholder="Filtrar por teléfono…" value="${escapeHtml(filtroTel)}">
          <button type="submit">Filtrar</button>
          ${filtroTel ? '<a class="btn ghost" href="/documentos">Limpiar</a>' : ''}
        </form>
        ${items ? `<ul class="doc-list">${items}</ul>` : '<div class="empty">No hay documentos creados todavía.</div>'}
      </div>`;
    res.send(pagina('Documentos', '/documentos', html));
  });

  app.get('/documentos/archivo/:id/:nombre', (req, res) => {
    const ruta = documentos.getDocumentoArchivo(req.params.id, req.params.nombre);
    if (!ruta || !fs.existsSync(ruta)) return res.status(404).send('No encontrado');
    res.download(ruta);
  });

  // ── Registro / Auditoría ─────────────────────────────────────────────────
  app.get('/registro', (req, res) => {
    const tel = (req.query.tel || '').trim();
    const q = (req.query.q || '').trim();

    const stats = audit.estadisticasPorTelefono();
    const eventos = audit.leerUltimos({ max: 300, filtroTel: tel, filtroTexto: q });

    const filasUsuarios = stats.slice(0, 50).map((p) => `
      <tr>
        <td><a href="/registro?tel=${encodeURIComponent(p.tel)}">+${escapeHtml(p.tel)}</a></td>
        <td>${escapeHtml(p.nombre || '-')}</td>
        <td>${p.mensajes}</td>
        <td>${p.documentos}</td>
        <td>${p.derivado ? '<span class="badge red">derivado</span>' : ''}</td>
        <td>${(p.tools || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</td>
        <td class="meta">${escapeHtml(p.ultimo_contacto.slice(0,19).replace('T',' '))}</td>
      </tr>`).join('');

    const filasEventos = eventos.slice(0, 200).map((e) => `
      <tr>
        <td class="meta">${escapeHtml((e.ts || '').slice(0,19).replace('T',' '))}</td>
        <td>${escapeHtml(e.tipo || '')}</td>
        <td>${e.tel ? '+' + escapeHtml(e.tel) : ''}</td>
        <td>${escapeHtml(e.nombre || '')}</td>
        <td><pre style="max-width: 400px;">${escapeHtml((e.contenido || e.motivo || e.titulo || '').slice(0, 200))}</pre></td>
        <td><pre style="max-width: 400px; color: #555;">${escapeHtml((e.respuesta || e.resumen || '').slice(0, 200))}</pre></td>
        <td>${(e.tools || []).map((t) => `<span class="tag">${escapeHtml(t)}</span>`).join('')}</td>
      </tr>`).join('');

    const html = `
      <div class="card">
        <div class="card-head">
          Quién ha consultado al agente
          <a class="btn ghost" href="/registro/exportar.csv">Descargar CSV</a>
        </div>
        <form class="search" method="get">
          <input type="text" name="tel" placeholder="Filtrar por teléfono…" value="${escapeHtml(tel)}">
          <input type="text" name="q" placeholder="Buscar en mensajes…" value="${escapeHtml(q)}">
          <button type="submit">Filtrar</button>
          ${tel || q ? '<a class="btn ghost" href="/registro">Limpiar</a>' : ''}
        </form>
        <table class="t">
          <thead><tr><th>Teléfono</th><th>Nombre</th><th>Msgs</th><th>Docs</th><th></th><th>Tools usadas</th><th>Último contacto</th></tr></thead>
          <tbody>${filasUsuarios || '<tr><td colspan="7" class="empty">Sin actividad registrada.</td></tr>'}</tbody>
        </table>
      </div>
      <div class="card">
        <div class="card-head">Últimos eventos${tel ? ' — +' + escapeHtml(tel) : ''}${q ? ' — “' + escapeHtml(q) + '”' : ''}</div>
        <table class="t">
          <thead><tr><th>Fecha</th><th>Tipo</th><th>Teléfono</th><th>Nombre</th><th>Mensaje / motivo</th><th>Respuesta / resumen</th><th>Tools</th></tr></thead>
          <tbody>${filasEventos || '<tr><td colspan="7" class="empty">Sin eventos.</td></tr>'}</tbody>
        </table>
      </div>`;
    res.send(pagina('Registro', '/registro', html));
  });

  app.get('/registro/exportar.csv', (req, res) => {
    const csv = audit.exportarCsv();
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="registro-consultas.csv"');
    res.send('﻿' + csv); // BOM para Excel
  });

  // ── Base legal ───────────────────────────────────────────────────────────
  app.get('/base-legal', (req, res) => {
    const q = (req.query.q || '').trim();
    const stats = baseLegal.estadoIndice();
    let resultados = '';
    if (q) {
      const matches = baseLegal.buscarDocumentos(q, 20);
      resultados = matches.length
        ? matches.map((m) => `<li>
            <div><strong>${escapeHtml(m.nombre)}</strong> <span class="meta">${escapeHtml(m.carpeta || '/')} · score ${m.score}</span></div>
            <div class="preview">${escapeHtml(m.extracto)}</div>
          </li>`).join('')
        : '<div class="empty">Sin resultados para esa búsqueda.</div>';
    }

    const html = `
      <div class="card">
        <div class="card-head">Base documental legal</div>
        <div class="stats">
          <div><span class="num">${stats.documentos}</span> documentos</div>
          <div>Ruta: <code>${escapeHtml(stats.ruta || '(sin configurar)')}</code></div>
          <div>${stats.indexando ? 'Indexando…' : `Última: ${escapeHtml((stats.actualizado || '').slice(0,19).replace('T',' '))}`}</div>
        </div>
        <form class="search" method="get">
          <input type="text" name="q" value="${escapeHtml(q)}" placeholder="Busca un término…">
          <button type="submit">Buscar</button>
        </form>
        ${resultados ? `<ul class="chat-list">${resultados}</ul>` : ''}
      </div>`;
    res.send(pagina('Base legal', '/base-legal', html));
  });

  app.listen(config.webPanel.port, config.webPanel.bind, () => {
    const dirAccesible = config.webPanel.bind === '127.0.0.1' || config.webPanel.bind === 'localhost'
      ? 'solo localhost'
      : `expuesto en ${config.webPanel.bind}`;
    console.log(
      `[panel] http://${config.webPanel.bind}:${config.webPanel.port} (user: ${config.webPanel.user}, ${dirAccesible})`
    );
    if (config.webPanel.bind === '0.0.0.0') {
      console.warn('[panel] AVISO: WEB_BIND=0.0.0.0 → panel accesible desde la red. Asegúrate de tener reverse proxy con TLS.');
    }
  });
}

module.exports = { iniciar };
