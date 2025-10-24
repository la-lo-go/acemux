# AceMux

> [!WARNING]  
> This project is currently in beta stage. Many features are still under development and may not work as expected. Expect bugs and incomplete functionality.

<div align="center">
  <img src="docs/preview.png" alt="AceMux Preview" width="800">
  
  A modern web application for managing and streaming AceStream content. Built with Astro and SQLite, it provides an elegant interface to organize your streams and watch them directly in your browser or external media players.
</div>



## ✨ Features

- **Stream Management**: Add, edit, and organize your AceStream links in one place
- **Web Player**: Built-in HLS video player for browser-based streaming
- **External Player Support**: Open streams directly in VLC or other compatible players
- **Visual Library**: Add custom thumbnails to your streams for easy identification
- **Fast & Lightweight**: Built with Astro for optimal performance
- **Persistent Storage**: SQLite database ensures your streams are saved locally
- **Modern UI**: Beautiful, responsive interface built with Tailwind CSS
- **Copy Links**: Quick copy functionality for sharing stream links

## 🚀 Quick Start

### Development Setup

1. **Clone the repository**:
```sh
git clone <repository-url>
cd acemux
```

2. **Install dependencies**:
```sh
bun install
```

3. **Configure environment variables** (create a `.env` file):
```env
ACESTREAM_BASE=http://localhost:6878
DB_PATH=./data/db.sqlite
PORT=3000
```

4. **Run in development mode**:
```sh
bun dev
```

5. **Open your browser** and navigate to `http://localhost:3000`

## 📦 Production Build

To build for production:

```sh
bun run build
```

To preview the production build:

```sh
bun run preview
```

## 🐳 Docker Support

AceMux includes Docker configuration for easy deployment with AceStream Engine included.

> [!WARNING] 
> This is VERY beta and not recommended for production use yet.

### Quick Start with Docker

1. **Start both services** (AceMux + AceStream Engine):

```sh
docker-compose up -d
```

1. **Access the application** at `http://localhost:4321`

### Docker Environment Variables

You can configure the following environment variables in `docker-compose.yml`:

```yaml
services:
  acemux:
    environment:
      - ACESTREAM_BASE=http://acestream:6878  # AceStream Engine URL
      - PORT=4321                              # Application port
      - HOST=0.0.0.0                          # Host binding
```

To use a different AceStream server or change the port, edit the `docker-compose.yml` file before running `docker-compose up`.


## 🗺️ Roadmap

- [ ] **Docker Image**: Create and publish an official Docker image for easy deployment via CI/CD
- [ ] **User Authentication**: Implement user accounts and authentication
- [ ] **External Access URL**: Add a toggle for accessing streams via Tailscale or external IP
- [ ] **Search & Filter**: Add search functionality to quickly find streams
- [ ] **Import/Export**: Backup and restore your stream library
- [ ] **Stream Health Check**: Verify if streams are active/working
- [ ] **Categories/Tags**: Organize streams by sport, league, or custom tags
- [ ] **Favorites**: Mark streams as favorites for quick access
- [ ] **Sort Options**: Sort by name, date added, or custom order
- [ ] **Bulk Actions**: Delete or edit multiple streams at once
- [ ] **Grid/List View**: Toggle between different layout modes
- [ ] **Progressive Web App**: Install as desktop/mobile app

## 📁 Project Structure

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

## 🤝 Contributing

Contributions are welcome! Feel free to:

- Report bugs
- Suggest new features
- Submit pull requests
- Improve documentation

## 📄 License
This project is licensed under the MIT License. See the [LICENSE](LICENSE) file for details.

---

**Note**: AceMux requires a running AceStream Engine to function. Make sure you have it installed and configured before using this application.
