# AceMux

<div align="center">
  <img src="docs/preview.png" alt="AceMux Preview" width="800">

  A modern web application for managing and streaming AceStream content. Built with Astro and SQLite, it provides an elegant interface to organize your streams and watch them directly in your browser or external media players.
</div>

## Features

- **Stream Management**: Add, edit, and organize your AceStream links in one place
- **Web Player**: built-in player (MSE/`mpegts.js`) that shares the same session as your TV clients
- **External Player Support**: open streams directly in VLC or other compatible players
- **Plex & Jellyfin**: publish your library as a live TV tuner (M3U + XMLTV)
- **Shared Sessions**: several viewers of the same channel share a single P2P download
- **Visual Library**: custom thumbnails, card or compact table view
- **Favorites, Search and Sort**
- **Import / Export**: back up and restore your library as JSON
- **Persistent Storage**: SQLite database saved locally
- **Modern UI**: responsive interface built with Tailwind CSS

## Quick Start

The normal way to run AceMux is with **Docker** (Linux, NAS, Windows or macOS); you do not need Bun or Node on the host. The development setup at the bottom is only for contributors.

### Docker

Create a `docker-compose.yml` file with the following content:

```yaml
services:
  acestream:
    image: ghcr.io/martinbjeldbak/acestream-http-proxy:latest
    container_name: acestream
    environment:
      - ALLOW_REMOTE_ACCESS=true
    ports:
      - "6878:6878"
    restart: unless-stopped

  acemux:
    image: ghcr.io/la-lo-go/acemux:latest
    container_name: acemux
    ports:
      - "4321:4321"
    environment:
      - ACESTREAM_BASE=http://acestream:6878
      - PUBLIC_URL=${PUBLIC_URL:-}
      - API_TOKEN=${API_TOKEN:-}
      - EPG_DAYS=${EPG_DAYS:-2}
      - TZ=${TZ:-Europe/Madrid}
    volumes:
      - acemux_data:/app/data
    depends_on:
      - acestream
    restart: unless-stopped

  threadfin:
    image: fyb3roptik/threadfin:latest
    container_name: threadfin
    profiles: ["plex"]
    ports:
      - "34400:34400"
    environment:
      - PUID=1001
      - PGID=1001
      - TZ=${TZ:-Europe/Madrid}
    volumes:
      - threadfin-conf:/home/threadfin/conf
      - threadfin-tmp:/tmp/threadfin
    restart: unless-stopped

volumes:
  acemux_data:
  threadfin-conf:
  threadfin-tmp:
```

Start the stack:

```sh
docker compose up -d
```

Access the application at `http://localhost:4321`.

#### Available Images

| Registry | Image |
|----------|-------|
| GitHub Container Registry | `ghcr.io/la-lo-go/acemux:latest` |
| Docker Hub | `lalogo/acemux:latest` |

#### Environment Variables

Only `ACESTREAM_BASE` is relevant to get started; every other variable is optional and has a sensible default.

| Variable | Default | Notes |
|----------|---------|-------|
| `ACESTREAM_BASE` | `http://acestream:6878` | AceStream engine URL |
| `PUBLIC_URL` | _(request host)_ | (optional) LAN base URL reachable by Plex/Jellyfin/Threadfin, e.g. `http://192.168.1.133:4321` |
| `API_TOKEN` | _(open)_ | (optional) token that protects `/playlist.m3u`, `/stream/:id` and `/xmltv.xml` |
| `TZ` | `Europe/Madrid` | (optional) timezone |
| `EPG_DAYS` | `2` | (optional) days of filler EPG in the XMLTV guide |
| `THREADFIN_URL` | `http://threadfin:34400` | (optional) Threadfin URL to auto-refresh on stream changes |
| `MAX_CLIENTS_PER_STREAM` | `6` | (optional) viewers sharing a channel, `0` = unlimited |
| `MAX_CONCURRENT_STREAMS` | `3` | (optional) channels downloading at once, `0` = unlimited |
| `STREAM_STOP_GRACE_MS` | `10000` | (optional) keep an idle session alive before stopping the engine |
| `ACESTREAM_PID` | `acemux` | (optional) player id sent to the engine |
| `PORT` / `HOST` | `4321` / `0.0.0.0` | (optional) server binding |
| `DB_PATH` | `./data/db.sqlite` | (optional) path to the SQLite database |

#### Data Persistence

By default the SQLite database lives in the `acemux_data` named volume mounted at `/app/data`. Named volumes work the same on Linux, Windows and macOS with no host-side permission setup.

If you prefer a bind mount (easier to inspect/backup), edit `docker-compose.yml`:

```yaml
volumes:
  - ./data:/app/data          # Bind mount
  # or
  - acemux_data:/app/data     # Named volume (default)
```

> [!NOTE]
> On Linux/NAS a bind-mounted `./data` may be owned by `root`. If the container cannot write, run `mkdir -p data && sudo chown -R 1000:1000 data` (the image runs as UID/GID `1000`).

#### Endpoints

AceMux exposes its library to external media players:

| Endpoint | Description |
|----------|-------------|
| `GET /playlist.m3u` | M3U playlist with `tvg-id`, `tvg-name`, `tvg-logo`, `group-title` and `tvg-chno` attributes |
| `GET /stream/:id` | Stable MPEG-TS stream (the AceStream engine is resolved server-side) |
| `GET /xmltv.xml` | AceMux's own EPG guide in XMLTV format |
| `GET /healthz` | JSON status |

The `playlist.m3u`, `stream/:id` and `xmltv.xml` endpoints accept `?token=<API_TOKEN>`.

#### Import / Export

Use **Actions → Export JSON** in the web UI to download your whole library (`acemux-streams.json`), and **Actions → Import JSON…** to restore it or bulk-add channels by pasting JSON (or picking a file). The import dialog also shows the schema with a **Copy** button so you can hand it to an LLM to format a list.

Accepted format (a plain array of streams also works):

```json
{
  "version": 1,
  "streams": [
    {
      "id": "40-char AceStream infohash",
      "name": "Channel name",
      "photo_url": "https://example.com/logo.png",
      "tvg_id": "epg.channel.id",
      "tvg_name": "Channel name for the guide",
      "group_title": "Sports",
      "number": 1,
      "enabled": true
    }
  ]
}
```

Only `id` (a 40-hex infohash, or an `acestream://` link containing one) and `name` are required; the rest is optional. Existing streams with the same `id` are updated.

#### Concurrency (multiple viewers)

The AceStream engine **only serves one player per stream**: a second request to the same `id` replaces the first. To support multiple viewers, AceMux keeps **a single upstream download per channel** and fans it out among all clients of `/stream/:id`; the engine session is stopped only when the last client leaves.

- **Same channel, several people**: they all share a single P2P download (Plex, Jellyfin, VLC and the web player). Cap with `MAX_CLIENTS_PER_STREAM`.
- **Different channels**: each one opens its own session, up to `MAX_CONCURRENT_STREAMS`.
- Slow clients are evicted with a bounded buffer so as not to slow down the rest.
- `/healthz` includes `activeStreams` and `sessions` to see the live status.

Details and limitations in [`docs/concurrency.md`](docs/concurrency.md).

### Development (contributors)

1. Clone the repository:
```sh
git clone <repository-url>
cd acemux
```

2. Install dependencies:
```sh
bun install
```

3. Create a `.env` file (see `.env.example`):
```env
ACESTREAM_BASE=http://localhost:6878
DB_PATH=./data/db.sqlite
PORT=4321
```

4. Run in development mode:
```sh
bun dev
```

5. Open `http://localhost:4321`.

Production build:

```sh
bun run build
bun run preview
```

## Plex & Jellyfin integration

AceMux exposes its library as an M3U playlist plus an XMLTV guide, so Plex and Jellyfin can show it as a live TV tuner.

Before you start:

- **Set `PUBLIC_URL`** to the LAN address of the host running AceMux (e.g. `http://192.168.1.133:4321`). AceMux uses it to build the stream URLs inside the playlist, so it must be reachable by the device that consumes the M3U.
- If you configured `API_TOKEN`, append `?token=<API_TOKEN>` to every URL below.
- **Auto-refresh**: whenever you add, edit or delete a stream, AceMux notifies Threadfin (`THREADFIN_URL`) to reload the playlist and guide, so changes show up without waiting for its schedule.

### Jellyfin (no Threadfin needed)

Jellyfin reads the M3U and XMLTV directly.

1. Go to **Live TV → Tuner Devices → Add**.
2. Add an **M3U Tuner**:
   ```
   http://<IP-LAN>:4321/playlist.m3u?token=<API_TOKEN>
   ```
3. Go to **Live TV → TV Guide Providers → Add** and pick **XMLTV**:
   ```
   http://<IP-LAN>:4321/xmltv.xml?token=<API_TOKEN>
   ```
4. Save and scan. Channels appear immediately and the guide shows the stream name.

### Plex (Threadfin required)

Plex needs **Plex Pass** and cannot read M3U directly, so it goes through [Threadfin](https://github.com/Threadfin/Threadfin). Threadfin is part of the stack (service `threadfin`, port `34400`).

1. Start the stack:
   ```sh
   docker compose up -d
   ```
2. Open Threadfin at `http://<IP-LAN>:34400` and add the sources:
   - **Menu → Playlist → Add new**: name `acemux`, type **M3U**, URL `http://<IP-LAN>:4321/playlist.m3u?token=<API_TOKEN>`
   - **Menu → XMLTV → Add new**: name `acemux`, type **XMLTV**, URL `http://<IP-LAN>:4321/xmltv.xml?token=<API_TOKEN>`
   - **Menu → Settings → EPG Source = XEPG** (XEPG means "use my XMLTV files"; PMS would ask Plex/Jellyfin to provide the guide instead).
3. Open **Menu → Mapping**. Every channel that should be visible to Plex must be mapped to its EPG channel:
   - AceMux emits a `tvg-id` equal to the XMLTV channel id, so **new** channels are mapped automatically.
   - For existing rows, pick the matching channel and click **Save**.
   - At least one mapped and enabled channel is required; otherwise Plex receives an empty lineup (`/lineup.json` returns `null`).
4. In Plex, go to **Settings → Live TV & DVR → Set up a Tuner**:
   - **Device**: select the discovered **Threadfin / HDTC-2US** HDHomeRun, or enter the device address `192.168.1.133:34400` (address only, no path).
   - Do **not** paste the XMLTV URL in the device field: the XMLTV URL belongs to the guide step.
   - **Guide**: choose Threadfin's XMLTV `http://<IP-LAN>:34400/xmltv/threadfin.xml`, or let Plex take the guide from the tuner.
5. Save and scan channels. The programme names are the stream names from AceMux (edit a stream's name to change what Plex shows).

> [!TIP]
> If Plex reports "no hardware found", you pasted the XMLTV URL in the tuner/device field. The **device** is Threadfin's emulated HDHomeRun on port `34400`; the **XMLTV URL** is only for the guide.

### Networking notes

- Every client (Jellyfin, Plex, Threadfin) must be able to reach `PUBLIC_URL`. On Docker Desktop (Windows/macOS) use the host LAN IP.
- On Linux/NAS the AceStream P2P engine performs better with `network_mode: host`, as it needs incoming peer traffic. Docker Desktop does not support host networking.

## Roadmap

- [x] **Live Video Player**: browser player (MSE/`mpegts.js`) sharing the stream session with Plex/Jellyfin/VLC
- [x] **Docker Image**: Official Docker images on Docker Hub and GitHub Container Registry
- [x] **Stream Health Check**: Real-time status indicators showing stream availability
- [x] **Search & Filter**: Add search functionality to quickly find streams
- [x] **Import/Export**: Backup and restore your stream library
- [x] **Favorites**: Mark streams as favorites for quick access
- [x] **Sort Options**: Sort by name, date added, or custom order
- [x] **Bulk Actions**: Delete or edit multiple streams at once
- [x] **Grid/List View**: Toggle between different layout modes
- [x] **Progressive Web App**: Install as desktop/mobile app
- [ ] **User Authentication**: Implement user accounts and authentication
- [ ] **External Access URL**: Add a toggle for accessing streams via Tailscale or external IP
- [ ] **Categories/Tags**: Organize streams by sport, league, or custom tags

## Project Structure

```
acemux/
├── src/
│   ├── pages/              # Application routes
│   │   ├── index.astro     # Main stream library page
│   │   ├── [id].astro      # Stream player page
│   │   └── api/            # API endpoints
│   ├── lib/
│   │   ├── db.ts           # Database functions
│   │   └── components/     # Reusable Astro components
│   └── styles.css          # Global styles
├── data/                   # SQLite database storage
└── public/                 # Static assets
```

## Contributing

Contributions are welcome! Feel free to:

- Report bugs
- Suggest new features
- Submit pull requests
- Improve documentation

## License

This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

**Note**: AceMux requires a running AceStream Engine to function. Make sure you have it installed and configured before using this application.
