# bot-wa-brando

Agente de WhatsApp con dos caras sobre un solo núcleo:

- **Vendedor consultivo** — atiende leads orgánicos, diagnostica, califica y me los
  entrega listos para cerrar.
- **Asistente personal** — solo para mí, y además el panel de control del vendedor.

La arquitectura completa está en [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).
Léela antes de tocar código: el diseño existe para que open-wa sea reemplazable.

**Estado: Fase 1 cerrada y verificada en real** — el ciclo
`WhatsApp → gateway → cola → pipeline → outbox → respuesta` funciona con una
cuenta de verdad, en los dos roles: contesta `eco (prospect)` a desconocidos y
`eco (owner)` en el chat propio. Todavía no hay IA; eso es Fase 3.

---

## Estructura

```
apps/wa-gateway   Chromium + open-wa. Proceso tonto, sin lógica de negocio.
apps/agent-core   NestJS. Todo el cerebro.
prisma/           Esquema completo (fases 1–7)
docs/             Arquitectura
render.yaml       Blueprint de despliegue
```

---

## Correr en local

Requisitos: Node ≥ 20 y un Postgres. Docker no hace falta en local — open-wa baja
su propio Chromium.

```bash
npm install
```

```bash
cp .env.example .env
```

Genera la clave del gateway y ponla en `GATEWAY_API_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

Crea las tablas:

```bash
npx prisma migrate dev --name init
```

**`OWNER_WA_ID` es la variable más importante del archivo.** Es lo único que te da
rol `OWNER`; si está mal, el asistente personal no te reconoce y caes en la rama de
ventas. El formato es `<lada><número>@c.us` — por ejemplo `5215512345678@c.us`.
Si no estás seguro del tuyo, arranca el gateway, mándate un mensaje desde otro
número y míralo en los logs del core.

Levanta los dos procesos en terminales separadas:

```bash
npm run dev:gateway
```

```bash
npm run dev:core
```

Abre el QR en el navegador y escanéalo con WhatsApp → Dispositivos vinculados:

```
http://localhost:10000/qr?key=<GATEWAY_API_KEY>
```

Escríbele al número desde otro teléfono. Debe contestar `eco (prospect): ...`.
Escríbete a ti mismo y debe decir `eco (owner): ...`. Si ves esas dos cosas,
la Fase 1 está hecha.

---

## Desplegar en Render (~$39/mes)

| Servicio | Plan | Costo |
|---|---|---|
| `wa-gateway` | Standard, 2 GB (Starter hace OOM con Chromium) | $25 |
| Disco de sesión | 5 GB | $1.25 |
| `agent-core` | Starter, 512 MB | $7 |
| Postgres | Basic-256mb (el Free caduca a los 30 días) | $6 |

1. Sube el repo a GitHub (privado: `prisma/schema.prisma` describe tu negocio).
2. Render → **Blueprints** → New Blueprint Instance → apunta a este repo.
   Lee `render.yaml` y crea los tres recursos.
3. Llena a mano las que quedaron marcadas `sync: false`: `OWNER_WA_ID` y
   `ANTHROPIC_API_KEY`.
4. Copia `GATEWAY_API_KEY` (Render la generó sola) desde el dashboard del gateway.
5. Abre `https://<tu-gateway>.onrender.com/qr?key=<GATEWAY_API_KEY>` y escanea.

### Cosas que te van a morder

- **El QR solo existe en memoria.** Si el gateway reinicia antes de que escanees,
  se genera otro. Ten el teléfono en la mano.
- **`autoDeploy: false` en el gateway, a propósito.** Cada deploy del gateway corta
  la sesión unos 10 segundos, porque Render apaga la instancia vieja antes de
  levantar la nueva cuando hay disco. El core sí puede redeployarse libremente.
- **Todo lo que no esté en `/data` se borra en cada deploy.** Ahí vive la sesión.
- **La sesión de WhatsApp son credenciales de tu cuenta.** Está en `.gitignore`;
  que siga así.
- **Primer login desde una IP de datacenter.** Es el momento de mayor riesgo de ban.
  No mandes nada masivo las primeras semanas.

---

## Comandos

```bash
npm run build
```

```bash
npx prisma studio
```

---

## open-wa: cuatro trampas y cómo se resolvieron

Esto costó una tarde entera de depuración. Si algún día el gateway deja de
conectar, empieza por aquí antes de tocar nada más.

**1. El QR nunca aparecía (timeout de 30s).**
open-wa manda un User-Agent que dice `Chrome/104`. WhatsApp Web responde con la
página de "actualiza tu navegador", donde no hay QR que encontrar, y la
librería se queda esperando un elemento que nunca existe.
La opción `customUserAgent` **no sirve**: en `initializer.js` solo se lee dentro
de `if (config.inDocker)`, así que fuera de Docker se ignora en silencio.
→ Se parchea en runtime sobreescribiendo `puppeteer.config.useragent`, en
`apps/wa-gateway/src/whatsapp.ts`. No se edita `node_modules` para que
sobreviva a `npm install` y funcione igual en Render.

**2. "No se pudo vincular el dispositivo".**
WhatsApp detectaba la automatización. `useStealth` viene **apagado** por defecto.
→ `useStealth: true`.

**3. Escaneabas bien y el proceso moría solo.**
`ensureHeadfulIntegrity: true` dispara la rutina *"Refreshing session"* de
`Client.js`, que llama a `WAPI.getUseHereString()` → lee `localeStrings` de los
internos de WhatsApp Web, módulo que ya no existe.
→ **No activar esa opción.** El comentario está en el código para que nadie la
vuelva a poner.

**4. El asistente personal no recibía nada.**
WhatsApp ya direcciona chats por **LID**. El chat "Mensajes contigo mismo" no
es `<tu numero>@c.us` sino algo como `108817861898421@lid`, y dentro de él
`from` es tu número mientras `to` es tu LID — la misma cuenta escrita distinto.
→ El mapper detecta el chat propio con `chat.contact.isMe`, que es la señal
semántica correcta y no depende del formato de la dirección.
`OWNER_SELF_CHAT_ID` queda como respaldo opcional.

> open-wa descarga parches de `cdn.openwa.dev` en cada arranque
> (`Patches Installed: <hash>` en los logs). Así se mantiene al día con los
> cambios de WhatsApp Web — y también significa que **depende de que ese CDN
> siga vivo**. Es la razón de que el `MessagingPort` exista.

---

## Notas de implementación

- **La cola va sobre Postgres (pg-boss), no Redis.** No es solo por ahorrarse los
  $10/mes del Key Value: encolar y escribir el outbox pegan a la misma base, así
  que caben en una transacción.
- **La serialización por chat es un advisory lock de Postgres**, no la cola. Ver
  `PrismaService.withChatLock`. Así sigue siendo correcto aunque escales workers.
- **La idempotencia es la PK de `Message`**, que es el `messageId` de WhatsApp.
  No hay caché en RAM que se desincronice.
- **Solo dos archivos conocen open-wa**: `apps/wa-gateway/src/whatsapp.ts` y
  `apps/agent-core/src/infrastructure/whatsapp/open-wa.mapper.ts`. Si algo de
  open-wa se filtra fuera de ahí, es un bug de arquitectura.
