# Agente IA WhatsApp — Asistente Legal

Asistente IA para WhatsApp orientado a despacho de abogados. Conecta WhatsApp Web (vía QR) con la Claude API. Atiende consultas iniciales, lee documentos enviados por el cliente, escucha notas de voz, **consulta la base documental archivada del despacho**, agenda citas en Google Calendar, **envía recordatorios automáticos 24 h antes** y **notifica al abogado por Slack/email** cuando deriva un caso. Incluye **panel web** para revisar las conversaciones.

## Capacidades

| Capacidad | Estado | Cómo activarla |
|---|---|---|
| Conversación en texto | ✅ siempre | nada extra |
| Notas de voz (Whisper) | opcional | `OPENAI_API_KEY` |
| Imágenes y PDFs (visión Claude) | ✅ siempre | nada extra |
| **Redactar Word + exportar PDF** | ✅ siempre | nada extra |
| **Registro de consultas (audit log)** | ✅ siempre | nada extra |
| Memoria persistente por chat | ✅ siempre | `data/conversaciones.json` |
| Agendar citas (Google Calendar) | opcional | OAuth Google + `npm run calendario:auth` |
| Recordatorios automáticos 24 h antes | opcional | requiere Google Calendar |
| Notificación al abogado al derivar | opcional | `SLACK_WEBHOOK_URL` y/o SMTP |
| Base documental legal (PDF/DOCX/TXT) | opcional | `BASE_LEGAL_PATH` |
| Panel web | ✅ por defecto | `WEB_USER` / `WEB_PASS` |
| Comandos `/reset` `/pausa` `/reanudar` | ✅ siempre | nada extra |

## Stack

- **Node.js ≥18.17**
- **whatsapp-web.js** — WhatsApp Web por QR (no oficial)
- **@anthropic-ai/sdk** — Claude API (por defecto **Claude Sonnet 4.6** con prompt caching)
- **openai** — Whisper para transcripción
- **googleapis** — Google Calendar
- **express + basic-auth** — panel web
- **node-cron** — recordatorios
- **nodemailer** — notificaciones email
- **pdf-parse + mammoth** — extracción de texto de PDFs y DOCX
- **marked + html-to-docx + puppeteer** — generación de Word y PDF de los documentos creados por el agente

## Aviso `whatsapp-web.js`

Librería **no oficial**. Usa un número dedicado del despacho. No envíes mensajes en masa. Para producción seria a medio plazo, migra a la **WhatsApp Cloud API** (oficial Meta).

## Instalación local

```powershell
cd "d:\agente whatsapp claude"
npm install
copy .env.example .env
# edita .env con tus claves
npm start
```

La primera vez sale un QR en la terminal:

> Ajustes → Dispositivos vinculados → Vincular un dispositivo → Escanear.

## Instalación con Docker

```powershell
cd "d:\agente whatsapp claude"
copy .env.example .env
# edita .env (importante: BASE_LEGAL_PATH=/base-legal si quieres usar el volumen)
docker compose up --build
```

Escanea el QR. Cuando veas `Cliente listo`, Ctrl+C y arranca en background:

```powershell
docker compose up -d
docker compose logs -f bot
```

El panel web queda en http://localhost:3000.

## Configuración paso a paso

### 1. Mínimo viable

En `.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
DESPACHO_NOMBRE=Vea Legal
ABOGADO_NOMBRE=Oscar
ABOGADO_TELEFONO=+34600000000
WEB_PASS=algo-secreto
```

Sólo con esto ya tienes: bot de texto, lectura de PDFs/imágenes y panel web.

### 2. Notas de voz

Saca una API key en [platform.openai.com](https://platform.openai.com/api-keys) y ponla en `OPENAI_API_KEY`.

### 3. Google Calendar + recordatorios

1. [Google Cloud Console](https://console.cloud.google.com/) → nuevo proyecto.
2. Habilita **Google Calendar API**.
3. *APIs & Services → Credentials* → crea **OAuth 2.0 client ID** tipo **"Desktop app"**.
4. Copia `client_id` y `client_secret` a `.env`.
5. `npm run calendario:auth`, abre el enlace, autoriza, pega el código, copia el `refresh_token` resultante a `GOOGLE_REFRESH_TOKEN`.
6. Ajusta `GOOGLE_CALENDAR_ID`, `DESPACHO_TIMEZONE`, horario y `DURACION_CITA_MINUTOS`.

Los recordatorios se activan solos en cuanto haya calendar y `RECORDATORIOS_ACTIVADOS=true`. Cron por defecto `*/30 * * * *` (cada 30 min comprueba citas a 24 h ± 30 min y manda el aviso una vez).

### 4. Notificaciones al abogado

Cuando el agente decide derivar el caso (llama a la tool `derivar_al_abogado`), notifica por:

**Slack** — Crea un *Incoming Webhook* en tu workspace (https://api.slack.com/messaging/webhooks). Pega la URL en `SLACK_WEBHOOK_URL`.

**Email** — Rellena `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (remitente) y `EMAIL_ABOGADO` (destinatario). Para Gmail necesitas una *App Password*.

Si dejas ambos vacíos, las derivaciones se loguean en consola pero no se envían.

### 5. Base documental legal

Pon en `BASE_LEGAL_PATH` la ruta a la carpeta con tus archivos. Por defecto:
```
BASE_LEGAL_PATH=D:\Base de datos Legal\oscar
```

En Docker, el `docker-compose.yml` monta `D:/Base de datos Legal` en `/base-legal` (sólo lectura). En ese caso pon `BASE_LEGAL_PATH=/base-legal` en `.env`.

Soporta `.pdf`, `.docx`, `.txt`, `.md` de forma recursiva. La indexación arranca automáticamente cuando el bot está listo. Re-indexación manual:
```powershell
npm run indexar
```

El índice se guarda en `data/base-legal-index.json`. Sólo re-procesa archivos cuyo `mtime` o tamaño han cambiado, así que la segunda vez es rápida.

El agente busca en la base con la tool `buscar_en_base_legal` (BM25) y lee documentos concretos con `leer_documento_base_legal`. Puedes probar la búsqueda manualmente desde el panel web → "Base legal".

## Crear documentos por WhatsApp (Word + PDF)

Cuando un cliente pida un documento legal por WhatsApp — por texto, por nota de voz o adjuntando una foto/PDF como referencia — el agente:

1. Pregunta los datos que falten (partes, importe, fecha, objeto…).
2. Redacta el documento completo (cabeceras, EXPONE, ESTIPULACIONES, firmas) en formato legal español.
3. Guarda automáticamente un **Word editable** (`.docx`) en:
   ```
   data/creado-por-whatsapp/<telefono_nombre>/<timestamp>__<titulo>/documento.docx
   ```
   Junto al `.docx` queda el `.md` (fuente Markdown) y el `.html` (preview).
4. Si el cliente dice *"pásalo a pdf"* / *"exporta pdf"*, el agente genera la **versión final en PDF** (`documento.pdf`) en la misma carpeta.
5. Si el cliente lo pide, el agente le **manda el archivo** (docx o pdf) por WhatsApp.

Todos los documentos están listados y descargables desde el panel web → pestaña **Documentos**.

En documentos sensibles (demandas, recursos, contratos con cuantía), el agente recuerda al cliente que el documento debe ser revisado y firmado por el abogado antes de presentarlo o entregarlo, y si toca lo deriva.

## Registro de consultas (audit log)

Cada mensaje entrante, comando, derivación, documento creado/exportado/enviado y llamada a herramienta queda registrado en:

```
data/registro-consultas.jsonl
```

Formato JSON-lines: una línea por evento, fácil de procesar. Campos típicos: `ts`, `tipo`, `tel`, `nombre`, `contenido`, `respuesta`, `tools`, `origen`.

Desde el panel web → pestaña **Registro** puedes:
- Ver la tabla de **quién** ha consultado (teléfono, nombre, nº de mensajes, nº de documentos, si fue derivado, qué tools usó).
- Filtrar por teléfono o por texto de los mensajes.
- **Descargar el CSV** para abrirlo en Excel.

## Memoria de conversaciones

El historial de cada chat se guarda en `data/conversaciones.json` y sobrevive a reinicios. El agente recuerda los últimos `HISTORIAL_MAX_MENSAJES` pares user/assistant por chat (por defecto 20). El cliente puede borrar su historial escribiendo `/reset`.

## Comandos en chat de WhatsApp

- `/reset` — Borra la conversación y empieza de cero.
- `/pausa` — Bot deja de responder en ese chat (para que un humano tome el control).
- `/reanudar` — Vuelve a activarlo.
- `/ayuda` — Lista comandos.

## Panel web

`http://localhost:3000`, usuario y contraseña de `WEB_USER`/`WEB_PASS`.

- **Chats** — lista de chats con preview y fecha del último mensaje. Vista de un chat con histórico. Pausa/reanudación y reset por chat.
- **Documentos** — todos los documentos creados por el agente, con enlaces de descarga (md / docx / pdf) y filtro por teléfono.
- **Registro** — tabla de usuarios que han consultado, con nº mensajes/documentos, derivaciones, tools usadas y último contacto. Filtros y export CSV.
- **Base legal** — buscador sobre el índice de la base documental archivada.

**Importante**: el panel hace HTTP basic auth, sin TLS. Sirve sólo en red privada o detrás de un reverse proxy (Caddy/nginx) con HTTPS. No lo expongas directo a internet.

## Cómo funciona internamente

```
[Mensaje WhatsApp]
    │
    ├─ Es media? → media.js  ─┬─ audio  → transcripcion.js (Whisper)
    │                         ├─ imagen → bloque image para Claude
    │                         └─ pdf    → bloque document para Claude
    │
    ▼
[claude.js: generarRespuesta(historial)]
    │  + prompt cacheado
    │  + tools disponibles dinámicamente:
    │     - consultar_huecos_calendario / agendar_cita  (si Google OK)
    │     - derivar_al_abogado                          (siempre)
    │     - buscar_en_base_legal / leer_documento_base_legal (si base OK)
    ▼
[Respuesta] → reply al cliente
    │
    └─ Persistencia en data/conversaciones.json
```

Otros procesos:
- **reminders.js** corre por cron (`*/30 * * * *` por defecto). Lee eventos del calendar que caen a 24 h ± 30 min, extrae teléfono/nombre de la descripción del evento (la pone el bot al crear la cita) y manda WhatsApp con el cliente. Cada evento sólo se notifica una vez (registro en `data/recordatorios-enviados.json`).
- **webPanel.js** arranca Express en `WEB_PORT`.
- **baseLegal.js** mantiene un índice BM25 en memoria, persistido en `data/base-legal-index.json`. Se re-indexa al arrancar; sólo re-procesa lo que ha cambiado.

## Estructura

```
src/
  index.js          # entrypoint: cliente WhatsApp + arranque servicios
  claude.js         # wrapper Anthropic con prompt caching y tool-use loop
  prompt.js         # system prompt dinámico
  storage.js        # historial por chat (JSON)
  audit.js          # registro de consultas (JSONL)
  media.js          # triage de imágenes / PDFs / audios
  transcripcion.js  # Whisper
  documentos.js     # Markdown → Word (.docx) y Markdown → PDF
  calendario.js     # Google Calendar
  reminders.js      # cron de recordatorios 24h
  notifications.js  # Slack + email
  baseLegal.js      # indexación y búsqueda BM25 de documentos legales
  tools.js          # tools de Anthropic y dispatcher
  webPanel.js       # panel web (Express)
  config.js         # carga .env y flags de disponibilidad
scripts/
  google-auth.js    # único uso: sacar refresh_token de Google
  reindexar.js      # forzar re-indexación completa
data/
  conversaciones.json          # historial de chats (memoria)
  registro-consultas.jsonl     # audit log
  base-legal-index.json        # índice de la base documental
  recordatorios-enviados.json  # eventos de calendario ya notificados
  creado-por-whatsapp/         # documentos generados por el agente
.wwebjs_auth/                  # sesión de WhatsApp (no commitear)
Dockerfile
docker-compose.yml
```

## Limitaciones

- WhatsApp Web → riesgo de baneo si abusas. Usa número dedicado.
- Si el proceso Node se cae deja de responder. Docker Compose con `restart: unless-stopped` lo resuelve.
- El bot sólo reacciona a mensajes entrantes. Los recordatorios sí son proactivos (el bot mandará un mensaje sin que el cliente lo provoque, una vez por cita).
- Panel web sin TLS → sólo red privada.
- Base legal: BM25 simple, sin embeddings. Para búsqueda semántica avanzada (sinónimos, contexto), habría que añadir embeddings.

## Solución de problemas

- **No sale el QR**: revisa logs, probablemente Chromium no arranca. En Docker viene resuelto. En local, prueba `npm install` otra vez.
- **`pdf-parse` falla en algún PDF**: el indexador lo salta y loguea, sigue adelante. PDFs escaneados sin OCR no tendrán texto.
- **Whisper falla en audios largos**: límite ~25 MB por archivo. Notas de voz de WhatsApp suelen estar muy por debajo.
- **No llegan notificaciones email**: comprueba el `App Password` en Gmail; las claves normales no funcionan.
- **El bot no responde**: ¿escribiste `/pausa` antes? Mira el panel web, ahí ves los chats pausados.

## Próximos pasos sugeridos

- OCR para PDFs escaneados (tesseract / Google Vision).
- Embeddings para búsqueda semántica en la base legal.
- Migración a WhatsApp Cloud API (oficial Meta).
- Auto-creación de matter/expediente cuando se confirma cita.
- Métricas (Prometheus): nº mensajes, latencia Claude, citas creadas, derivaciones.
