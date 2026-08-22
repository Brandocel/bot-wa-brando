# wa-gateway — open-wa + Chromium sobre Render.
# Render NO permite instalar paquetes de sistema en el runtime nativo de Node,
# por eso este servicio va con runtime: docker.
#
# Construir desde la RAÍZ del repo:  docker build -f apps/wa-gateway/Dockerfile .

# ─── Etapa 1: compilar ────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS build

# Que puppeteer no se baje su propio Chromium: en runtime usamos el de apt.
# Sin esto el build pesa ~300 MB de más y tarda el doble.
ENV PUPPETEER_SKIP_DOWNLOAD=true

WORKDIR /app

# Los package.json de TODOS los workspaces: npm ci valida el lockfile completo
# y truena si falta alguno, aunque solo vayamos a instalar uno.
COPY package.json package-lock.json tsconfig.base.json ./
COPY apps/wa-gateway/package.json ./apps/wa-gateway/
COPY apps/agent-core/package.json ./apps/agent-core/

# --include-workspace-root trae typescript, que es devDependency de la raíz.
RUN npm ci --include-workspace-root --workspace=wa-gateway

COPY apps/wa-gateway ./apps/wa-gateway
RUN npm run build --workspace=wa-gateway

# Fuera lo que solo servía para compilar.
RUN npm prune --omit=dev --include-workspace-root --workspace=wa-gateway

# ─── Etapa 2: runtime ─────────────────────────────────────────────────────
FROM node:20-bookworm-slim

# Deps de sistema de Chromium. Sin esto Puppeteer arranca y muere sin log útil.
RUN apt-get update && apt-get install -y --no-install-recommends \
      chromium \
      ca-certificates fonts-liberation dumb-init \
      libnss3 libatk-bridge2.0-0 libatk1.0-0 libcups2 libdrm2 libxkbcommon0 \
      libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 libasound2 \
      libpango-1.0-0 libcairo2 \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PUPPETEER_SKIP_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    CHROME_PATH=/usr/bin/chromium \
    GATEWAY_PORT=10000 \
    WA_SESSION_PATH=/data/session

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/wa-gateway/dist ./apps/wa-gateway/dist
COPY --from=build /app/apps/wa-gateway/package.json ./apps/wa-gateway/
COPY --from=build /app/package.json ./

# /data es el mount del Persistent Disk (ver render.yaml). La sesión de
# WhatsApp vive AHÍ y solo ahí; el resto del filesystem es efímero.
EXPOSE 10000

# dumb-init como PID 1: sin esto Chromium deja procesos zombie y el
# contenedor se queda sin memoria en unos días.
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/wa-gateway/dist/main.js"]
