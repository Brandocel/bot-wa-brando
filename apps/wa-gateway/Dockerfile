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

# ─── Etapa 1b: voz (gratis, local) ────────────────────────────────────────
# whisper.cpp transcribe las notas de voz y Piper habla con voz de México.
# Todo corre aquí, sin llaves ni servicios externos. Compilado portátil
# (sin -march=native): el CPU de Render no es el de la máquina que construye.
FROM debian:bookworm-slim AS voz

RUN apt-get update && apt-get install -y --no-install-recommends \
      build-essential cmake git curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

ARG WHISPER_VERSION=v1.7.6
ARG WHISPER_MODEL=ggml-small-q5_1.bin
ARG PIPER_VERSION=2023.11.14-2
ARG PIPER_VOZ=es/es_MX/claude/high/es_MX-claude-high

WORKDIR /src
RUN git clone --depth 1 --branch ${WHISPER_VERSION} https://github.com/ggml-org/whisper.cpp.git \
 && cmake -S whisper.cpp -B whisper.cpp/build -DGGML_NATIVE=OFF -DBUILD_SHARED_LIBS=OFF \
      -DWHISPER_BUILD_TESTS=OFF -DCMAKE_BUILD_TYPE=Release \
 && cmake --build whisper.cpp/build --config Release -j --target whisper-cli \
 && mkdir -p /opt/voz \
 && cp whisper.cpp/build/bin/whisper-cli /opt/voz/whisper-cli \
 && curl -fsSL -o /opt/voz/whisper.bin \
      https://huggingface.co/ggerganov/whisper.cpp/resolve/main/${WHISPER_MODEL}

# El tar de Piper trae su binario, sus librerías y espeak-ng-data en piper/.
RUN curl -fsSL https://github.com/rhasspy/piper/releases/download/${PIPER_VERSION}/piper_linux_x86_64.tar.gz \
      | tar -xz -C /opt/voz \
 && curl -fsSL -o /opt/voz/voz.onnx \
      https://huggingface.co/rhasspy/piper-voices/resolve/main/${PIPER_VOZ}.onnx \
 && curl -fsSL -o /opt/voz/voz.onnx.json \
      https://huggingface.co/rhasspy/piper-voices/resolve/main/${PIPER_VOZ}.onnx.json

# ─── Etapa 2: runtime ─────────────────────────────────────────────────────
FROM node:20-bookworm-slim

# dumb-init como PID 1, los certificados para hablar con WhatsApp y con el
# core, ffmpeg para convertir audios (nota de voz <-> wav) y libgomp, que
# whisper.cpp usa para repartir el trabajo entre hilos.
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates dumb-init ffmpeg libgomp1 \
 && rm -rf /var/lib/apt/lists/*

COPY --from=voz /opt/voz /opt/voz
ENV VOZ_DIR=/opt/voz

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
