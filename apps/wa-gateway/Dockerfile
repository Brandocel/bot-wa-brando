# wa-gateway — Baileys sobre Render.
#
# Antes esto traía Chromium entero porque open-wa automatiza WhatsApp Web con
# Puppeteer. Baileys habla el protocolo directamente, así que se fueron el
# navegador, sus veinte librerías de sistema y los sesenta segundos de
# arranque. La imagen pasó de ~700 MB a ~150 MB.
#
# Sigue siendo docker y no el runtime nativo de Node porque el disco
# persistente y el control de la imagen ya estaban montados así, y cambiarlo
# ahora sería mover una pieza que funciona sin ganar nada.
#
# Construir desde la RAÍZ del repo:  docker build -f apps/wa-gateway/Dockerfile .

# ─── Etapa 1: compilar ────────────────────────────────────────────────────
FROM node:20-bookworm-slim AS build

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

# dumb-init como PID 1 y los certificados para hablar con WhatsApp y con el
# core. Nada más: Baileys no necesita navegador.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates dumb-init \
 && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    GATEWAY_PORT=10000 \
    WA_SESSION_PATH=/data/baileys

WORKDIR /app

COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/wa-gateway/dist ./apps/wa-gateway/dist
COPY --from=build /app/apps/wa-gateway/package.json ./apps/wa-gateway/
COPY --from=build /app/package.json ./

# /data es el mount del Persistent Disk (ver render.yaml). La sesión de
# WhatsApp vive AHÍ y solo ahí; el resto del filesystem es efímero.
EXPOSE 10000

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "apps/wa-gateway/dist/main.js"]
