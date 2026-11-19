FROM node:20-slim

# Dependencias de Chromium para Puppeteer (whatsapp-web.js)
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libxshmfence1 \
    libxss1 \
    libxtst6 \
    xdg-utils \
    ca-certificates \
    tini \
    && rm -rf /var/lib/apt/lists/*

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev --no-audit --no-fund && npm cache clean --force

COPY src ./src
COPY scripts ./scripts

RUN mkdir -p /app/data /app/.wwebjs_auth /app/.wwebjs_cache && \
    useradd -m -u 1001 bot && \
    chown -R bot:bot /app

USER bot

EXPOSE 3000

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "src/index.js"]
