# AceStream Engine: multi-cliente, mismo infohash vs infohashes distintos

Investigación sobre fuentes primarias (documentación oficial, wiki archivada, código fuente de
proxies y foro oficial). Fecha: 2026-09-11.

Convención: **HECHO** = afirmado explícitamente por una fuente primaria.
**INFERENCIA** = deducción propia a partir de hechos, indicada como tal.
**CONFIANZA**: Alta / Media / Baja.

---

## Fuentes primarias usadas

| # | Fuente | URL |
|---|--------|-----|
| F1 | Start Playback (docs oficiales) | https://docs.acestream.net/developers/start-playback/ |
| F2 | API Reference (docs oficiales) | https://docs.acestream.net/developers/api-reference/ |
| F3 | Command Line Options (docs oficiales) | https://docs.acestream.net/developers/engine-command-line-options/ |
| F4 | Broadcasting Reference (docs oficiales) | https://docs.acestream.net/broadcasting/reference/ |
| F5 | Engine HTTP API (wiki, copia archivada 2024-03-01) | https://web.archive.org/web/20240301201709/https://wiki.acestream.media/Engine_HTTP_API |
| F6 | Foro: "No simultaneous playback of 2 streams" (2023) | https://forum.acestream.media/t/no-simultaneous-playback-of-2-streams-on-archlinux-and-acestream-3-1-75rc4/3729 |
| F7 | Foro: "Personal acestream server" (2024) | https://forum.acestream.media/t/personal-acestream-server/3862 |
| F8 | HTTPAceProxy (C++), `broadcast.cpp` / `broadcast.hpp` / `proxy.cpp` | https://github.com/jopsis/HTTPAceProxy/blob/master/httpaceproxycpp/src/broadcast.cpp |
| F9 | HTTPAceProxy (Python, pepsik), `clientcounter.py` / `acehttp.py` | https://github.com/pepsik-kiev/HTTPAceProxy/blob/master/aceclient/clientcounter.py |
| F10 | acexy (Go), `acexy.go` / `pmw.go` / `proxy.go` | https://github.com/Javinator9889/acexy/blob/main/acexy/lib/acexy/acexy.go |
| F11 | ValdikSS/aceproxy, `acehttp.py` / `clientcounter.py` / `aceconfig.py` | https://github.com/ValdikSS/aceproxy/blob/master/acehttp.py |
| F12 | aceserve (solo imagen Docker del engine) | https://github.com/jopsis/docker-acestream-aceserve |
| F13 | mediaflow-proxy-light issue #7 (stop de un cliente mata la sesión compartida) | https://github.com/mhdzumair/mediaflow-proxy-light/issues/7 |
| F14 | android-service-client-example (validez del `playback_url`) | https://github.com/acestream/android-service-client-example |
| F15 | Wiki Configuration Files / Streaming (opciones `acestream.conf`) | https://wiki.acestream.media/Configuration_Files · https://wiki.acestream.media/Streaming/en |

---

## Pregunta 1 — `GET /ace/getstream?id=<infohash>`: ¿dos peticiones = dos sesiones o una?

**Respuesta corta:** el engine **no** da soporte nativo a dos clientes reproduciendo el **mismo id**.
No crea dos sesiones independientes que convivan: la segunda petición pasa a ser "el reproductor
activo" y el engine deja de servir a la anterior.

**HECHOS**

- El engine identifica la sesión de reproducción por *player ID* (`pid`). La wiki oficial dice, literal:
  > "Player ID" purpose - app engine must distinguish one player session from another, as in the
  > current engine implementation user **cannot play the same live stream with two (or more) players
  > simultaneously from one engine, and engine will stop to serve requests from one player, when got
  > a new request from another."
  (F5)
- El foro oficial (2023) confirma el síntoma: al arrancar un segundo stream, el primero deja de
  cachear y muere; el hilo se resuelve añadiendo un `pid` distinto por stream. (F6)
- El foro oficial (2024) lo dice sin ambigüedad para el mismo CID:
  > "You're using same CID on second device or different one? In first case, you need third-party HTTP
  > proxy (HLS proxy, HTTP Ace proxy) for that - Ace Stream do not support playback via internal proxy
  > of same CID on different clients."
  (F7)
- El endpoint directo (`/ace/getstream?id=...` sin `format=json`) no ofrece control de sesión; con
  `format=json` el engine devuelve `playback_url`, `stat_url`, `command_url`, `playback_session_id`.
  La docs indica que el engine **detiene la sesión automáticamente si el reproductor deja de leer**.
  (F1)
- El `command_url` con `method=stop` detiene la sesión de reproducción. (F1, F5)

**INFERENCIA**

- Dos peticiones idénticas sin `pid` distinto → comportamiento de sesión única: la segunda sustituye
  a la primera; no hay fan-out. Con `pid` distinto el engine puede abrir sesiones separadas, pero para
  el **mismo CID** la fuente oficial dice que no funciona y hay que poner un proxy delante. (F5, F6, F7)
- Si un cliente cierra su conexión HTTP a `/ace/getstream`, el engine tiende a terminar la sesión
  (F1: "engine will stop it automatically if the player stops reading"). Con una sesión compartida por
  N clientes, la salida de uno puede tumbar a todos; por eso los proxies cuentan referencias antes de
  enviar `method=stop` (ver F13).
- Los parámetros `allow_multiple_threads_reading` y `stop_prev_read_thread` existen en la API oficial
  (F2) y apuntan justamente a permitir/evitar lecturas concurrentes, pero **su semántica no está
  documentada**. Indicio, no prueba.

**CONFIANZA:** Alta (no hay multi-cliente nativo para el mismo id; hay que usar proxy). Media en el
detalle exacto de aborto al cerrar una conexión.

---

## Pregunta 2 — `GET /ace/manifest.m3u8?id=<infohash>`: ¿sesión HLS por petición? ¿`playback_url` reutilizable?

**Respuesta corta:** en modo *redirect* (sin `format=json`) el engine devuelve un playlist cuyos
segmentos están indexados por infohash (`/ace/c/<infohash>/<n>.ts`), es decir, contenido compartido.
En modo middleware (`format=json`) cada llamada devuelve un `playback_url` con **token y
`playback_session_id` propios**, luego es una sesión distinta por llamada. La reutilización práctica
la hace el proxy, no el engine.

**HECHOS**

- El playlist devuelto por `/ace/manifest.m3u8?infohash=...` referencia segmentos del tipo
  `http://127.0.0.1:6878/ace/c/<infohash>/0.ts`, `.../1.ts`, ... (F1). No hay token de sesión en los
  segmentos.
- Con `format=json`, la respuesta incluye:
  `playback_url` = `/ace/m/<infohash>/<hash>.m3u8`,
  `stat_url` = `/ace/stat/<infohash>/<hash>`,
  `command_url` = `/ace/cmd/<infohash>/<hash>`,
  `playback_session_id` (F1).
- "Playback URL is valid as long as session is alive (until session is explicitly stopped, or stopped
  by inactivity timeout, or engine is stopped)." (F14)
- Existe el parámetro `force_session_restart` (F2), lo que implica que por defecto puede reutilizarse
  una sesión, pero no hay documentación de que dos clientes puedan leer el mismo `playback_url` a la vez.

**INFERENCIA**

- `/ace/manifest.m3u8` en modo redirect: **cualquier** cliente puede pedir los mismos segmentos
  `/ace/c/<infohash>/...`, porque van por contenido, no por sesión. El playlist es probablemente
  regenerable y compartible. Confianza Media.
- `/ace/manifest.m3u8?format=json`: cada llamada genera una sesión/token nuevos; **no** es un
  `playback_url` pensado para repartirse entre N clientes. Reutilizarlo desde varios puntos equivale a
  que varios lectores consuman una única sesión, con la duda de `allow_multiple_threads_reading`. Los
  proxies maduros no reparten el `playback_url` al cliente: abren **una** lectura upstream y copian
  bytes (F8, F9, F10).
- Cada petición de cliente al manifest (`format=json`) es, por tanto, una sesión independiente →
  consumo de P2P/CPU duplicado si se proxy-ea petición a petición. Confianza Media-Alta.

---

## Pregunta 3 — Límites de concurrencia y configuración relevante

**Respuesta corta:** no existe un límite documentado de "nº de sesiones de reproducción" ni un
`--stream-limit`. Los límites documentados son de conexiones/peers y de caché. El "límite" real al
mismo infohash es de comportamiento (1 reproductor efectivo), no numérico.

**HECHOS**

- La página oficial de opciones de línea de comandos **no** lista límites de sesiones/streams: solo
  `--port`, `--api-port`, `--http-port`, `--bind-all`, `--state-dir`, `--cache-dir`, `--cache-limit`,
  `--cache-max-bytes`, `--cache-auto`, `--login/--password`, `--access-token`, `--use-internal-buffering`
  y logging (F3).
- Parámetros de nodo documentados (F4):
  - `--max-connections` (int): máximo total de conexiones TCP y UDP (establecidas + pendientes).
    **Default 1000.**
  - `--max-peers` (int): máximo de conexiones establecidas a otros nodos. **Default 50.**
  - `--live-cache-type` (`disk`/`memory`), `--cache-dir`, `--state-dir`, etc.
- `acestream.conf` (wiki/config y ejemplos de la comunidad) usa además `--live-buffer 30`,
  `--vod-buffer`, `--max-upload-slots`, `--download-limit`, `--upload-limit`,
  `--stats-report-interval`, `--allow-user-config`. (F15)
- En el wiki, `--maxclients` aparece para **nodos fuente/broadcast** ("maximum number of peers, on
  which data from the source are given simultaneously"), no para el engine reproductor. (F15)
- No aparece `--stream-limit` en ninguna fuente oficial consultada.

**INFERENCIA**

- El engine reproductor puede sostener varias sesiones de **infohashes distintos** a la vez (el foro y
  los proxies ejecutan varios broadcasts concurrentes: `MAX_CONCURRENT_CHANNELS` en F8). Confianza Alta.
- El cuello real no es un contador de sesiones sino `--max-connections` / `--max-peers`: al agotar
  conexiones, el engine no podrá enganchar más peers (degradación, sin error documentado).
  Confianza Media.
- `--stream-limit` **no parece existir**; si alguien lo cita, conviene verificarlo contra la versión
  concreta del engine. Confianza Media-Alta.
- La mejor "concurrencia" para el mismo id no se logra configurando el engine, sino con un proxy que
  comparta upstream. Confianza Alta.

---

## Pregunta 4 — MPEG-TS (`/ace/getstream`) vs HLS (`/ace/manifest.m3u8`)

**HECHOS**

- Formatos soportados: MPEG-TS vía `/ace/getstream` y HLS vía `/ace/manifest.m3u8` (F1).
- MPEG-TS: respuesta HTTP progresiva única (stream continuo). HLS: manifiesto + segmentos
  `/ace/c/<infohash>/<n>.ts` (F1).
- HTTPAceProxy (Python) reconoce que sus `ReadTimeoutError` al leer del engine se dan **solo con
  fuentes HLS** ("This error only applies to HLS broadcast sources"), y el proxy lee todo lo que el
  engine entrega. (F9, issue https://github.com/pepsik-kiev/HTTPAceProxy/issues/40)
- acexy marca el modo HLS como **experimental / no testeado** y desaconseja su uso
  ("Using it is discouraged and not guaranteed to work"). (F10)

**INFERENCIA**

- Para un broadcaster, MPEG-TS es la opción más robusta: una sola conexión upstream por infohash y
  `copy` de bytes a N clientes. HLS añade segmentación en el engine, muchas peticiones cortas y
  reescritura de manifiesto; es más frágil y algo más caro en CPU/IO en el proxy. Confianza Alta.
- HLS "puro" ya soporta compartición a nivel de segmentos (content-scoped), pero requiere proxy de
  manifiesto/segmentos y reescritura de URLs; la gestión de sesión sigue siendo necesaria para no
  abrir sesiones de más. Confianza Media.

---

## Pregunta 5 — Cómo resuelven HTTPAceProxy / acexy / aceserve / aceproxy el multi-cliente

**Respuesta corta:** los proxies que funcionan hacen **fan-out desde un único upstream por infohash**,
con **refcount de clientes** y **parada del upstream al salir el último**. `aceserve` no es un proxy:
es solo el engine en Docker.

**HECHOS**

- **HTTPAceProxy C++** (F8):
  - `BroadcastManager::get_or_create(infohash, params)` — un `Broadcast` por infohash, reutilizado.
  - `Broadcast::add_client(...)` — cada cliente obtiene su `ChunkQueue`; `client_count()` es el refcount.
  - `Broadcast::stream_loop()` abre **una** lectura upstream (`start_broadcast(...)` → URL, m3u8 o
    http) y `broadcast_chunk()` reparte cada chunk a las colas de todos los clientes.
  - `remove_client()`: si `client_count() == 0` → `stop()` → `ace_->stop_broadcast()` + `shutdown()`.
  - `Proxy::handle_core_stream` llama `get_or_create` y `start_once`; aplica
    `max_connections` y `max_concurrent_channels` (403/503 al exceder).
  - "Broadcast sharing: multiple clients watching the same channel reuse one AceStream connection."
- **HTTPAceProxy Python (pepsik)** (F9):
  - `ClientCounter.addClient` devuelve el número de clientes por infohash.
  - El primer cliente (`== 1`) lanza `StreamReader` (el broadcast); los siguientes copian la cola
    (`c.q.copy()`) y comparten el mismo `AceClient`.
  - `deleteClient`, al quedar el último, hace `idleAce.StopBroadcast()`.
  - Usa la **Engine API** (puerto 62062), no la HTTP API.
- **acexy (Go)** (F10):
  - `streams map[AceID]*ongoingStream`: una entrada por stream; `FetchStream` reutiliza si existe.
  - `GetStream` llama al middleware **una vez** (`format=json` + `pid` UUID) y guarda `playback_url`.
  - `StartStream` añade el writer y, si no hay player aún, abre **una** `GET playback_url`; el
    `Copier` escribe a un `pmw.PMultiWriter` que reparte a todos los writers.
  - `StopStream`/evicción decrementan clientes; al llegar a 0 → `releaseStream` → `CloseStream`
    (`command_url?method=stop`).
  - Rechaza que el cliente envíe `pid` (el proxy gestiona el `pid` del upstream).
- **aceserve** (F12): `jopsis/aceserve` = imagen Docker del **engine** AceStream
  (`jopsis/docker-acestream-aceserve`), con puertos 6878/8621/62062. No implementa fan-out; es el
  backend que consume HTTPAceProxy.
- **ValdikSS/aceproxy** (F11):
  - `ClientCounter` cuenta clientes por contenido y guarda un `AceClient` por contenido.
  - Sin VLC, un segundo cliente sobre el mismo contenido recibe **503** ("Not the first client,
    cannot continue in non-VLC mode").
  - Con VLC, el proxy reproduce el contenido en VLC y sirve a N clientes desde VLC; al salir el último,
    tras `videodestroydelay`, `ace.destroy()`.
  - El `aceconfig.py` comenta: "multiple clients can't watch one stream without VLC. That's Ace
    Stream Engine fault."
- **mediaflow-proxy-light issue #7** (F13): bug real donde al desconectar un cliente se enviaba
  `method=stop` y se caía la sesión compartida de todos; se corrigió con refcount.

**INFERENCIA**

- El patrón canónico es: upstream único por infohash + refcount + fan-out + stop-on-last. Confianza Alta.
- ValdikSS/aceproxy es la prueba histórica de que el engine por sí solo no sirve el mismo contenido a
  varios clientes: necesitó VLC como etapa extra. Confianza Alta.

---

## Pregunta 6 — ¿Debe AceMux hacer de broadcaster (una descarga P2P para N clientes)?

**Respuesta:** **Sí.** Es la arquitectura que usan todos los proxies maduros y compensa los riesgos.

**Ventajas (HECHO + INFERENCIA)**

- Evita la limitación nativa del engine (mismo id no soporta multi-cliente). (F5, F7) — HECHO.
- Una sola descarga/upload P2P por infohash en vez de una por cliente → ahorro de ancho de banda,
  peers y CPU. — INFERENCIA (soportada por HTTPAceProxy: "reuse one AceStream connection"; F8).
- Ciclo de vida controlado y estable: arranque en el primer cliente, parada en el último, sin que un
  cierre tumbe a los demás. — HECHO (F8, F9, F10).
- Centraliza stats y `stat_url`, tolerancia a clientes lentos (eviction/colas), y permite reescribir
  URLs/M3U8 en el punto medio. — HECHO/INFERENCIA (F8, F10).
- Habilita MPEG-TS estable para Plex/Jellyfin (AceMux ya expone `/stream/:id`). — INFERENCIA.

**Riesgos/costes (INFERENCIA, salvo donde se cita)**

- Un cliente lento puede frenar a todos → hacen falta colas con límite y *eviction* (HTTPAceProxy
  `ChunkQueue` con `DroppedOldest`; acexy `pmw` con `client-eviction-timeout`). (F8, F10)
- Parada mal gestionada mata la sesión compartida → refcount obligatorio (lección de F13).
- Clave de compartición: canonicalizar a **infohash** (distinguir `id`/`content_id`/`infohash`; usar
  `server/api?method=get_content_id`). (F2)
- Overhead de memoria por cliente (buffer) y un punto único de fallo: si el upstream se atasca,
  afecta a todos.
- Doble buffering (engine `--live-buffer`/caché + buffer del proxy) puede añadir latencia.
- El `pid` del upstream debe ser único y gestionado por AceMux; conviene ignorar/rechazar el `pid`
  que envíe el cliente, como hace acexy. (F10)

**Estado actual de AceMux (contexto, no fuente externa)**

- `src/lib/server/acestream.ts` y `src/pages/stream/[id].ts`: por cada petición llaman a
  `/ace/getstream?id=...&format=json`, obtienen `playback_url` y abren **una** descarga upstream
  **nueva**. No hay registro de sesiones, ni refcount, ni fan-out.
- `src/pages/ace/[...path].ts`: proxy inverso sin estado; reenvía `/ace/manifest.m3u8?id=X` o
  `/ace/getstream?id=X` tal cual. Cada cliente del navegador genera su propia petición/sesión al engine.
- Conclusión: hoy AceMux **proxy-a cada petición**; con más de un espectador por id se reproduce el
  problema descrito en F5/F7.

**Recomendación final**

Implementar en AceMux un **gestor de sesiones upstream compartidas por infohash** con:
1. Registro `infohash -> sesión` (clave canónica).
2. Una única lectura upstream MPEG-TS por infohash, con `pid` propio (UUID), usando la API middleware
   (`format=json`) para obtener `playback_url`/`command_url`.
3. Fan-out a N clientes con cola acotada y política de cliente lento (*drop/evict*).
4. Refcount: `method=stop` **solo** al salir el último cliente (o por timeout de inactividad).
5. Límites propios configurables (`max_connections`, `max_concurrent_channels`).

Solo con ese diseño AceMux cumple el caso multi-cliente/ multi-canal que promete. Proxy-ar cada
petición es aceptable únicamente como caso degenerado (1 espectador por infohash, baja concurrencia).

---

## Resumen de confianza

| Pregunta | Confianza |
|----------|-----------|
| 1. Mismo id no es multi-cliente nativo; hay que proxy | Alta (detalle de aborto: Media) |
| 2. Manifest redirect = segmentos por contenido; middleware = sesión con token por llamada | Media-Alta |
| 3. No hay límite de sesiones documentado; sí `--max-connections`/`--max-peers`; `--stream-limit` no existe | Media-Alta |
| 4. MPEG-TS más simple/robusto para fan-out; HLS más frágil/caro | Alta |
| 5. Proxies usan upstream único por infohash + refcount + fan-out + stop-on-last | Alta |
| 6. AceMux debe implementar broadcaster compartido | Alta |
