# Concurrency and playback

How AceMux behaves when several people watch the same channel or different
channels. Based on the research in [`research/acestream-engine-multiclient.md`](research/acestream-engine-multiclient.md).

## The engine limitation

The AceStream engine **does not play the same stream in two players at the same
time**. It identifies each session by *player id* (`pid`) and, upon receiving a new
request for the same content, stops serving the previous one:

> "user cannot play the same live stream with two (or more) players simultaneously
> from one engine, and engine will stop to serve requests from one player, when got
> a new request from another."
> — [Engine HTTP API (wiki)](https://web.archive.org/web/20240301201709/https://wiki.acestream.media/Engine_HTTP_API)

That is why any client that talks **directly** to the engine (VLC pointing
at `:6878`, two tabs of the web player, etc.) will make them kill each other if
they request the same `id`.

## How AceMux solves it

`GET /stream/:id` goes through a **session manager** (`src/lib/server/stream-manager.ts`):

```
client A ─┐
client B ─┼─► StreamManager ──► a single upstream session ──► AceStream engine
client C ─┘   (fan-out, refcount)
```

- **A single download per channel**: the first request opens the upstream; the
  rest subscribe to that same session.
- **Fan-out**: every chunk received is distributed to all subscribers.
- **Refcount**: the engine session is stopped only when the last client leaves,
  with a grace period (`STREAM_STOP_GRACE_MS`) for reconnections.
- **Explicit stop**: on close, the engine's `command_url?method=stop` is called.
- **Slow clients**: each subscriber has a bounded buffer; if it falls behind
  it is evicted so as not to block the rest.

Consequence: **several viewers of the same channel share a single P2P
download** (whether Plex, Jellyfin, VLC or the web player, as long as they use `/stream/:id`).

## Same channel vs. different channels

| Scenario | Behavior |
|-----------|----------------|
| N people, same channel | One download, N readers. Cap `MAX_CLIENTS_PER_STREAM`. |
| N different channels | N independent downloads. Cap `MAX_CONCURRENT_STREAMS`. |
| Beyond the cap | HTTP `503` with the reason (`stream is at capacity` / `max concurrent streams reached`). |

## Configuration variables

| Variable | Default | Description |
|----------|---------|-------------|
| `MAX_CLIENTS_PER_STREAM` | `6` | Viewers per channel (`0` = no limit) |
| `MAX_CONCURRENT_STREAMS` | `3` | Simultaneous channels (`0` = no limit) |
| `STREAM_STOP_GRACE_MS` | `10000` | Grace period before stopping a session with no clients |
| `ACESTREAM_PLAYER_ID` | `acemux` | Player id sent to the engine |

`GET /healthz` exposes `activeStreams` and `sessions` (clients, bytes, start) to
observe the state.

## Integrated playback (web)

The browser player also uses the **shared session**: it requests
`/stream/:id` and plays the MPEG-TS with `mpegts.js` (MSE + remux to fMP4). Thus,
the web, Plex, Jellyfin and VLC share a single download per channel.

- All readers of the same channel see the same session, with the cap
  `MAX_CLIENTS_PER_STREAM`.
- It only requires a browser with **Media Source Extensions** support (all
  modern desktop and current mobile browsers).
- The stats panel (`Peers`/`Down`/`Up`/`Status`) is fed by
  `/api/sessions/:id`, which reads the engine statistics without opening a second
  session.
