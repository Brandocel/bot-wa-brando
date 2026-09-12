# Manual de operación — bot-wa-brando

Todo lo que hay que saber para operar el bot sin que WhatsApp bloquee el número, sin perder la sesión y sin sorpresas de costo. Está escrito para quien lo opera día a día, no para quien lo programa; para eso están `ARCHITECTURE.md` y `ARQUITECTURA-SOPORTE.md`.

---

## 1. Qué es esto, en una página

Dos servicios en Render y una base Postgres:

| Servicio | Qué hace | Estado |
|---|---|---|
| **wa-gateway** | Habla con WhatsApp (Baileys, sin navegador). Recibe mensajes y los manda al core; envía lo que el core le pide. | Sesión en disco persistente `/data/baileys`. **Una sola instancia.** |
| **agent-core** | El cerebro: permisos, tickets, búsqueda en Drive, conversación, panel web. | Sin estado local; todo en Postgres. |
| **bot-wa-db** | Contactos, conversaciones, mensajes, tickets, documentos indexados, agentes. | Nunca se declara en el blueprint; existe aparte. |

Camino de un mensaje: WhatsApp → gateway → webhook del core → cola (pg-boss) → pipeline de filtros → estrategia → **outbox** → gateway → WhatsApp. El outbox es una tabla: si el gateway está caído, los mensajes esperan ahí y salen cuando vuelve. Nada se pierde y nada se manda dos veces.

Roles de quien escribe:

- **OWNER**: tu número (`OWNER_WA_ID`). Tiene comandos de administración y nunca lo silencian los límites.
- **Agente de soporte**: números dados de alta con `/agente`. Reciben tickets y pueden cerrarlos.
- **Miembro**: números con membresía en una empresa. Pueden pedir documentos.
- **Prospecto**: cualquier otro. Hoy recibe un eco; a futuro, ventas.

---

## 2. No perder el número: cómo bloquea WhatsApp y cómo se evita

WhatsApp no publica sus reglas, pero lo que bloquea es consistente: **volumen que no parece humano, mensajes a gente que no te tiene guardado, y reportes de spam**. Un número nuevo con poca historia cae con mucho menos.

### 2.1 Lo que el sistema ya hace solo

| Defensa | Dónde | Qué evita |
|---|---|---|
| Solo responde, nunca inicia | Diseño | El 90 % de los bloqueos vienen de mensajes no solicitados. El bot no escribe primero a nadie, salvo el aviso de ticket a agentes que tú diste de alta. |
| No contesta estados, difusiones, grupos sin mención, ni mensajes propios | `SourceFilter` | Responder a estados de todos tus contactos = reporte de spam el primer día. |
| Máximo 5 respuestas por minuto al mismo chat | `LoopGuardFilter` | Bucles (el gateway reenvía lo que el bot manda; si algo falla, esto lo corta). |
| Máximo 20 respuestas por hora por chat, **120 por hora en total** | `RateLimitFilter` | Un bug que conteste a medio mundo se frena solo. Cuando salta, el log dice `TECHO GLOBAL alcanzado`. |
| Retardo humano al escribir (~1 s por cada 40 caracteres, tope 6 s) + indicador "escribiendo…" + marcar como leído | `OutboxDispatcher` | Respuestas instantáneas de madrugada a 40 personas es la firma de un robot. |
| No aparece "en línea" permanente | `markOnlineOnConnect: false` | Delata automatización y además apaga las notificaciones en tu teléfono. |
| Reintentos con tope (5) y luego se rinde | Outbox | Un mensaje que falla no se dispara en bucle. |
| Interruptor de emergencia `/pausa` | `KillSwitchFilter` | Silencio total en un segundo, sin tocar el servidor. Tú sigues pudiendo mandar `/reanuda`. |
| No contesta a "ok", "listo", "va" | Estrategia | Menos mensajes salientes = menos exposición, y además se siente más humano. |

### 2.2 Lo que depende de ti (reglas de oro)

1. **Usa un número con historia.** Un chip nuevo activado ayer y conectado a un bot es el perfil que más rápido bloquean. Ideal: número con meses de uso normal, foto de perfil, nombre real de la empresa, y que ya haya chateado con esos clientes.
2. **Que los clientes te tengan guardado y te escriban ellos primero.** Es la señal más fuerte que WhatsApp usa. Al dar de alta un miembro, dile que te guarde y que mande el primer "hola". El bot nunca abre conversación con clientes: no lo cambies.
3. **Nada de promociones ni difusiones desde este número.** Ni a mano. Un número que mezcla soporte con mensajes masivos pierde las dos cosas.
4. **No conectes el mismo número a otro bot o a varias sesiones "raras".** Dispositivos vinculados: tu teléfono, WhatsApp Web si lo usas, y el gateway. Nada más.
5. **No reescanees el QR por deporte.** Cada vinculación nueva es un evento que WhatsApp anota. Reescanea solo cuando el gateway diga `Sesión desvinculada`.
6. **El teléfono tiene que seguir vivo.** Encendido, con internet, con WhatsApp abierto de vez en cuando. Un teléfono apagado dos semanas desvincula a todos los dispositivos.
7. **No cambies de teléfono sin plan.** Migrar WhatsApp a otro aparato desvincula el gateway. Hazlo con calma y reescanea después.
8. **Vigila el techo global.** 120 respuestas/hora es holgado para soporte documental. Si lo alcanzas, algo está mal (bucle, cliente en bucle, spam entrante): investiga antes de subirlo.
9. **Los agentes de soporte reciben avisos de ticket sin haber escrito primero.** Es la única excepción a "solo responder". Son pocos números, tuyos, y que te tienen guardado. Diles que guarden el número del bot antes de darlos de alta; un aviso a un número que no te tiene guardado puede acabar en "reportar".
10. **Si te llega una advertencia de WhatsApp ("tu cuenta podría ser bloqueada") o un bloqueo temporal (24–72 h): `/pausa` inmediato.** Deja el número en silencio total el tiempo que dure, y al volver, reduce ritmo un par de días. Un segundo bloqueo temporal suele ser el definitivo.
11. **Bloqueo definitivo**: se apela desde la app ("Solicitar revisión"). Explica que es atención a clientes que te escriben. No hay garantía. Por eso el punto 1 y el 2 importan más que todo el código.

### 2.3 Señales tempranas de problema

- Clientes que te dicen "me salió que tu número es sospechoso" o que ven "este número no está en tus contactos" con opción de reportar.
- Mensajes que salen con ✓ pero nunca ✓✓ a varios contactos a la vez.
- El gateway se reconecta muchas veces en una hora (`conexión cerrada (...)` repetido en el log).
- Bajada brusca de mensajes entrantes.

Ante cualquiera: `/pausa`, mira logs, y espera.

---

## 3. La sesión de WhatsApp

### 3.1 Dónde vive y qué la rompe

- Credenciales en el **disco persistente** de Render, en `/data/baileys`. Sobreviven a deploys y reinicios. **No lo borres, no cambies el nombre del disco, no lo desmontes.** Borrarlo = reescanear.
- `/data/session` es la sesión antigua de open-wa. Está ahí por si hay que volver atrás; no cuesta nada dejarla.
- La cola de mensajes pendientes del gateway va en `/data/pending`, también en disco.
- El gateway tiene `autoDeploy: false` a propósito: **cada deploy del gateway corta la conexión unos segundos**. Se despliega a mano, en horario de poco tráfico. El core sí se puede desplegar cuando sea.

### 3.2 Estados

Se ven en `https://wa-gateway.onrender.com/healthz` y en el log:

| Estado | Significa | Qué hacer |
|---|---|---|
| `BOOTING` | Arrancando o reconectando | Esperar 1–2 min |
| `WAITING_QR` | No hay sesión válida | Escanear el QR (abajo) |
| `CONNECTED` | Todo bien | Nada |
| `DISCONNECTED` + "Sesión desvinculada" | Se cerró desde el teléfono o WhatsApp la invalidó | Reescanear |
| `CRASHED` | No pudo reconectar | Reiniciar el servicio en Render; si persiste, ver logs |

Hay un vigilante cada 60 s y un "latido" (se manda un mensaje a sí mismo y lo borra) que detecta cuando el socket dice "conectado" pero ya no llegan eventos. Si el camino está muerto, el proceso sale y Render levanta otro; la sesión se recupera del disco sin QR.

### 3.3 Vincular / revincular

1. Abre `https://wa-gateway.onrender.com/qr?key=<GATEWAY_API_KEY>` (la llave está en Render → wa-gateway → Environment).
2. En el teléfono: WhatsApp → Dispositivos vinculados → Vincular un dispositivo.
3. Escanea. La página se refresca sola; el QR caduca cada ~20 s.
4. Verifica: `/healthz` → `CONNECTED`, y mándate `/estado` desde tu WhatsApp.

En "Dispositivos vinculados" aparece como **Ubuntu / Chrome**. No lo cierres desde ahí salvo que quieras desvincular a propósito.

### 3.4 Qué NO hacer con la sesión

- No escanear el mismo QR desde dos teléfonos.
- No correr el gateway en local y en Render con la misma carpeta de sesión copiada.
- No subir la carpeta de sesión al repo (son credenciales).
- No reiniciar el gateway "para ver si se arregla" varias veces seguidas: cada arranque reconecta, y muchas reconexiones en poco tiempo también suman.

---

## 4. Operación diaria

### 4.1 Comandos del dueño (desde tu WhatsApp, a cualquier chat o al chat contigo mismo)

| Comando | Para qué |
|---|---|
| `/estado` | Resumen: pausa, prospectos, respuestas en 24 h, pendientes de enviar |
| `/pausa` / `/reanuda` | Interruptor general. Tú sigues teniendo comandos en pausa |
| `/ayuda` | Lista completa |
| `/empresa <nombre> \| <id de carpeta Drive>` | Alta de empresa |
| `/sync` · `/resync` · `/drive` · `/cuarentena` | Drive: sincronizar, rehacer índice completo, diagnóstico, archivos sin clasificar |
| `/agente <nombre> \| <teléfono>` | Alta de agente de soporte |
| `/agentes` · `/agente-baja <tel>` · `/asignar <ticket> <tel>` | Ver, dar de baja (reparte sus tickets), asignar a mano |
| `/diag [destino]` · `/probar <destino>` | Por qué no salen archivos; mandar texto + PDF de prueba |
| `/id` | Identificadores del chat (para configurar `OWNER_WA_ID`) |

### 4.2 Comandos de soporte (cualquier número con membresía)

`/buscar <qué>`, `/permisos`, `/tickets`, `/id`. Pero lo normal es que escriban en lenguaje natural: "la factura de febrero", "¿tienes la cotización?", "y la de marzo".

### 4.3 Comandos de agentes de soporte

`/mios` (sus tickets), `/tomar <n>`, `/cerrar <n> [nota]`. Solo funcionan desde números dados de alta con `/agente`.

### 4.4 Cómo se comporta la conversación

- Entiende tipo (factura, contrato, cotización, reporte, póliza), mes, folio y empresa, en cualquier orden y en varios mensajes. Lo dicho antes se recuerda 30 minutos.
- Si falta el mes y hay pocos documentos, los enseña numerados en vez de preguntar. Se responde "2", "la 2", "me pasas el 1". La lista vale 30 minutos.
- Hace máximo 3 preguntas por solicitud; a la cuarta, escala a una persona.
- Saludos, gracias y "ok" se contestan sin gastar modelo (o no se contestan, como haría alguien).
- "No me llegó" reenvía lo último que se entregó.
- Nunca dice "ese documento existe pero no tienes permiso": sin permiso y sin resultado dan la misma respuesta.

### 4.5 Tickets y escalado

Cada solicitud es un ticket con folio (`#213`). Se escala cuando: no se encuentra el documento, no se entiende la petición tras 3 preguntas, el archivo no se pudo enviar, o alguien pide humano.

Al escalar:

1. El ticket pasa a `EN_REVISION`.
2. Se asigna al agente activo con menos tickets (empate: el que lleva más tiempo sin recibir uno).
3. Al agente le llega por WhatsApp el resumen con **enlace `wa.me` al chat del cliente** y `Cuando quede resuelto: /cerrar N`.
4. Si nadie lo atiende en 4 h, sube a nivel 2 y se le recuerda (o se reparte si no tenía dueño).

Sin agentes dados de alta, los tickets quedan en revisión sin asignar y se ven en el panel. **Da de alta al menos uno el primer día.**

### 4.6 Panel web

`https://agent-core.onrender.com/panel`. Usuarios con `npm run panel:user` (rol ADMIN o AGENTE). Muestra bandeja por conversación, tickets, mensajes recientes, empresas y documentos. Es de lectura, salvo cerrar tickets.

---

## 5. Drive

- Una carpeta raíz por empresa; subcarpetas por tipo ayudan (`Facturas/`, `Cotizaciones/`), pero **el nombre del archivo manda** sobre la carpeta.
- Nombres que el bot entiende: `FACTURA_2026-02_V3001.pdf`, `Cotizacion_Cliente_2026-01.pdf`, `Contrato marzo 2026.pdf`. Todo lo entregable se indexa aunque el nombre no diga nada; lo que no se entiende queda como "documento" sin mes.
- **El bot lee por dentro los PDF** (y .txt/.csv) al indexarlos: saca el mes ("Fecha de emisión: 12/09/2026", "Periodo: junio 2026"), el folio y el tipo cuando el nombre no los trae, y guarda un extracto del texto. Con eso se puede pedir "la factura de Parcia Ima" o "el reporte contable de junio": busca esas palabras dentro de los documentos, no solo en el nombre. El nombre del archivo sigue mandando sobre el contenido, salvo cuando el nombre solo trae una marca de tiempo de descarga.
- Antes de mandar un documento comprueba que sea del mes pedido. Si el único parecido es de otro mes o no trae mes, lo ofrece diciéndolo ("la única que veo es X, de mayo; ¿te la mando?") en vez de mandarlo a ciegas. Y si le preguntan "¿cómo sabes que es de este mes?", contesta de dónde lo sacó.
- Imágenes y escaneos sin texto no se leen (no hay OCR): se indexan por nombre y carpeta nada más.
- `npx tsx scripts/dev/verify-contenido.ts <idDeCarpeta>` enseña qué lee de cada archivo de una carpeta: útil cuando un documento sale "sin mes" y no debería.
- Sincroniza cada 5 min (`DRIVE_SYNC_INTERVAL_MS`). `/sync` fuerza; `/resync` borra el cursor y rehace todo — úsalo después de cambiar reglas de clasificación o mover muchos archivos.
- La cuenta de servicio de Google debe tener acceso de lectura a cada carpeta raíz (compartir la carpeta con el correo de la cuenta de servicio).
- Tope de entrega: 15 MB (`MAX_DELIVERABLE_BYTES`). Más grande se escala.
- Si el adjunto falla, el cliente recibe un enlace de descarga que vence a los 30 minutos.

---

## 6. Modelo de lenguaje y costo

- `ANTHROPIC_API_KEY` vacía = el bot funciona con reglas y plantillas; solo pierde las frases libres.
- `ANTHROPIC_MODEL` (por defecto `claude-opus-5`). Para este uso, `claude-haiku-4-5` es ~5× más barato y rinde igual: cámbialo en Render → agent-core → Environment. El código ya lo soporta.
- Cuándo se llama al modelo: solo cuando las reglas no bastan ("lo del contrato que firmamos") y en charla libre ("¿qué me mandaste?"). Facturas por mes, folios, listas, saludos, gracias: cero llamadas.
- El modelo **nunca** decide permisos, qué entregar ni cuándo escalar. Eso es código. Un prompt malicioso de un cliente no puede sacar nada.

---

## 7. Deploy y variables

### 7.1 Variables (Render → servicio → Environment)

**agent-core**

| Variable | Qué es |
|---|---|
| `DATABASE_URL` | Internal Database URL de bot-wa-db (la interna, no la externa) |
| `GATEWAY_URL` / `GATEWAY_API_KEY` | Se heredan del gateway por blueprint |
| `OWNER_WA_ID` | Tu número: `521XXXXXXXXXX@c.us`. Si está mal, no eres OWNER y no tienes comandos. `/id` te lo dice |
| `ANTHROPIC_API_KEY` · `ANTHROPIC_MODEL` | Modelo (opcional) |
| `GOOGLE_SERVICE_ACCOUNT_JSON` | JSON de la cuenta de servicio en una línea (opcional: sin esto no hay Drive) |
| `MAX_DELIVERABLE_BYTES` · `DRIVE_SYNC_INTERVAL_MS` · `INCOMING_WORKERS` (mensajes atendidos a la vez, 4) | Opcionales |

**wa-gateway**

| Variable | Qué es |
|---|---|
| `WA_SESSION_PATH` | `/data/baileys` — no cambiar |
| `WA_PENDING_PATH` | `/data/pending` |
| `GATEWAY_API_KEY` | Llave para el core y para `/qr`. Si la rotas, el core la hereda; reinicia el core |
| `CORE_WEBHOOK_URL` | Red interna al core |

### 7.2 Desplegar

- **core**: push a `master` → deploy automático. Corre `prisma migrate deploy` al arrancar: las migraciones aplican solas. Una migración fallida deja el servicio caído: revisa logs.
- **gateway**: a mano, en horario tranquilo, y después verifica `/healthz`. Solo hace falta cuando cambia código del gateway.
- Antes de cualquier cambio grande: `/pausa`. Después: `/reanuda`.

### 7.3 Base de datos

- Respaldo: Render → bot-wa-db → Backups (el plan gratuito no lo incluye; considera el plan con backups diarios, son datos de facturas).
- Nunca `prisma migrate reset` contra producción. Nunca `db push`. Solo migraciones en el repo.
- Las conversaciones y mensajes se guardan completos; los archivos no (solo el índice; el PDF vive en Drive).

---

## 8. Qué hacer si…

| Síntoma | Causa probable | Qué hacer |
|---|---|---|
| El bot no contesta a nadie | Gateway desconectado, o `/pausa` activa, o techo global | `/estado` (si contesta, el core vive). `/healthz` del gateway. Log del core: `TECHO GLOBAL`, `bot en pausa` |
| No me contesta a mí pero a otros sí | `OWNER_WA_ID` mal | `/id` desde tu chat; copia `senderId` a la variable |
| A un cliente autorizado le dice que no encuentra nada | Membresía sin categoría/periodo permitido, o documento en cuarentena, o mal clasificado | `/permisos` desde su número; `/cuarentena`; revisa el nombre del archivo; `/resync` |
| El texto sale pero el PDF no | Direccionamiento (LID) o tamaño | `/diag <número>` y `/probar <número>`. El cliente mientras recibe enlace de descarga |
| Manda el mismo documento varias veces | Conversación mal interpretada | Ya está corregido en código; si reaparece, guarda la captura y el folio |
| `Sesión desvinculada` | Cerrada desde el teléfono, teléfono apagado semanas, o WhatsApp la invalidó | Reescanear QR (§3.3). No borres `/data` |
| Reconexiones constantes | Red de Render o WhatsApp inestable | Esperar; si dura >30 min, reiniciar gateway una vez |
| "Tu cuenta podría ser bloqueada" | Volumen o reportes | `/pausa` ya. Reduce actividad 48 h. Revisa §2.2 |
| Bloqueo temporal | Igual | `/pausa` todo el tiempo que dure + 24 h más |
| Bloqueo definitivo | Igual | Apelar desde la app. Prepara número de respaldo con historia |
| Ticket escalado y nadie se enteró | Sin agentes activos | `/agentes`; `/agente <nombre> \| <tel>` |
| Agente no recibe avisos | Número mal normalizado o no tiene el bot guardado | `/agentes` muestra el waId; `/probar <tel>` para ver si le llega algo |

---

## 9. Checklist

**Diario (1 min)**: `/estado`. Que "pendientes de enviar" sea 0 o casi. Panel: tickets en revisión sin asignar.

**Semanal**: `/agentes` (carga), `/cuarentena` (archivos que nadie va a poder pedir), log del gateway (reconexiones), consumo en console.anthropic.com.

**Antes de un cambio**: `/pausa` → deploy → `/healthz` → mensaje de prueba desde un número de cliente → `/reanuda`.

**Al dar de alta un cliente**: que guarde el número, que escriba él primero, `/permisos` desde su número para confirmar qué ve.

**Al dar de alta un agente**: que guarde el número, `/agente`, y provoca un escalado de prueba para que vea cómo llega.

---

## 10. Lo que este sistema NO es

- No es la API oficial de WhatsApp Business. Es una sesión vinculada, como WhatsApp Web. Funciona bien para soporte que responde; **no sirve y es peligroso para envíos masivos**. Si algún día se necesita iniciar conversaciones a escala, el camino es la Cloud API oficial con plantillas aprobadas; el core está hecho para que eso sea cambiar el gateway, no reescribir el bot.
- No garantiza contra bloqueos. Reduce el riesgo a lo que un humano con el mismo uso tendría. El resto es el historial del número y el comportamiento de quien lo opera.
