<div align="center">
  <img src="client/public/logo_comparer.png" alt="Variants Comparer Logo" width="200">
  
  # Exam Variants Comparer

  A two-service setup (Express API + React + shadcn/ui client) that lets you capture three exam variants, store their repository links, download them into a structured folder tree, and keep accompanying markdown notes. Everything is dockerized with a persistent host folder for the cloned repositories.
</div>

## Features
- 🎨 **Modern UI**: React + Vite + shadcn/ui for a clean, responsive interface
- 📝 **Variant Management**: Handle three variants (test, solution, template) with repository links and markdown notes
- 🔄 **Comparison View**: Side-by-side review of all variants before distribution
- 📥 **Automated Downloads**: One-click repository cloning with progress indicators
- 💾 **Persistent Storage**: Save/load configurations to JSON
- 🔒 **Security**: Server-side validation ensures downloads stay within designated directories
- 🐳 **Docker Ready**: Complete Docker Compose setup with volume mapping
- 📚 **Course Integration**: Optional course-management links per variant

## Table of Contents
- [Prerequisites](#prerequisites)
- [Quick Start](#quick-start)
- [Running with Docker](#running-with-docker-recommended)
- [Local Development](#local-development-without-docker)
- [Project Structure](#project-structure)
- [API Summary](#api-summary)
- [Configuration](#configuration)
- [Troubleshooting](#troubleshooting)

## Prerequisites
- Docker & Docker Compose v2
- Git (for repository cloning)
- Node.js 18+ and npm (for local development without Docker)

## Quick Start

The fastest way to get started:

```bash
# Clone the repository
git clone <your-repo-url>
cd variants-comparer

# Start with Docker
./start.sh

# Open your browser
# Client: http://localhost:3000
# API: http://localhost:4000
```

## Running with Docker (recommended)
1. Copy the example client env file if you want to override the default API host (optional):
   ```bash
   cp client/.env.example client/.env
   # edit VITE_API_BASE_URL if the API is not available at http://localhost:4000
   ```
2. Start both services:
   ```bash
   ./start.sh
   ```
3. Open the client at http://localhost:3000. The API is exposed on http://localhost:4000.

### Volumes & folders
- `./data` on the host is mounted into the server container at `/data`. Every target folder you pick must resolve inside `/data`, ensuring cloned repositories are written to a real host directory.
- `./server/storage` is mounted to `/app/storage` so the saved JSON survives container restarts.

### Changing the client API base URL
The React build bakes `VITE_API_BASE_URL` at build time. By default Docker Compose passes `http://localhost:4000`. Adjust `docker-compose.yml` (client → build.args) if your API lives elsewhere.

## Local development without Docker

For development without Docker:

```bash
# Terminal 1: Start the server
cd server
npm install
npm run dev

# Terminal 2: Start the client
cd client
cp .env.example .env
npm install
npm run dev
```

The Vite dev server expects the API at `http://localhost:4000` unless you override `VITE_API_BASE_URL` in `client/.env`.

## Project Structure

```
variants-comparer/
├── client/                # React client application
│   ├── src/
│   │   ├── components/   # UI components (shadcn/ui)
│   │   ├── contexts/     # React contexts
│   │   ├── lib/          # Utilities and API client
│   │   ├── pages/        # Main pages (Configure, Compare)
│   │   └── types.ts      # TypeScript types
│   ├── Dockerfile
│   └── package.json
├── server/               # Express server API
│   ├── src/
│   │   └── index.ts      # Main server file
│   ├── storage/          # Persistent config storage
│   ├── Dockerfile
│   └── package.json
├── data/                 # Cloned repositories and notes
│   └── exam-variants/    # Organized by exercise and variant
├── docker-compose.yml    # Docker orchestration
└── start.sh             # Helper script
```

## API summary

### Endpoints

- **`GET /api/config`** – Fetch saved variants and target folder
- **`POST /api/save`** – Persist current form (validates target folder and URLs)
- **`POST /api/download`** – Clone repositories into `<target>/<exercise>/<variant>/<test|solution|template>` and write `notes.md`

### Request/Response Format

All payloads share the same shape:

```json
{
  "targetFolder": "./exam-variants",
  "exerciseName": "Exercise 1",
  "variants": [
    { 
      "label": "Variant 1", 
      "testRepo": "https://github.com/user/test-repo", 
      "solutionRepo": "https://github.com/user/solution-repo", 
      "templateRepo": "https://github.com/user/template-repo", 
      "markdown": "# Notes\n\nVariant-specific notes", 
      "courseLink": "https://example.edu/course/1" 
    },
    { "label": "Variant 2", ... },
    { "label": "Variant 3", ... }
  ]
}
```

## Configuration

### Environment Variables

**Server** (`server/.env`):
- `PORT` – Server port (default: 4000)
- `ALLOWED_BASE_DIR` – Base directory for downloads (default: /data)
- `CONFIG_PATH` – Path to config JSON file (default: /app/storage/config.json)

**Client** (`client/.env`):
- `VITE_API_BASE_URL` – API endpoint (default: http://localhost:4000)

## Folder structure after download

```
<target-folder>/
  exercise-1/
    variant-1/
      test/          # Cloned test repository
      solution/      # Cloned solution repository
      template/      # Cloned template repository
      notes.md       # Variant-specific markdown notes
    variant-2/
      test/
      solution/
      template/
      notes.md
    variant-3/
      test/
      solution/
      template/
      notes.md
```

## Useful scripts

- **`start.sh`** – Runs `docker compose up -d --build` to start all services
- **Server commands**:
  - `npm run dev` – Start development server with hot reload
  - `npm run build` – Build for production
  - `npm start` – Run production build
- **Client commands**:
  - `npm run dev` – Start Vite dev server
  - `npm run build` – Build for production
  - `npm run preview` – Preview production build locally

## Troubleshooting

### Common Issues

**Target folder rejected**
- Ensure the path is under `/data` (maps to `./data` on the host)
- The server validates that all downloads stay within `ALLOWED_BASE_DIR`

**Git clone failures**
- Check that the server container has repository access
- For private repos, you may need to:
  - Mount SSH keys into the container
  - Use HTTPS URLs with embedded tokens
  - Configure git credentials

**API unreachable from client**
- Verify `VITE_API_BASE_URL` matches your browser's API URL
- Check that the server is running on the expected port (default: 4000)
- Ensure Docker containers are on the same network

**Port already in use**
- Change ports in `docker-compose.yml`:
  ```yaml
  ports:
    - "3001:80"    # Client (change 3000 to 3001)
    - "4001:4000"  # Server (change 4000 to 4001)
  ```

**Container won't start**
- Check Docker logs: `docker logs exam-comparer-server` or `docker logs exam-comparer-client`
- Ensure Docker daemon is running
- Try rebuilding: `docker compose up -d --build --force-recreate`

## Tech Stack

**Client**
- React 19
- TypeScript
- Vite
- TailwindCSS
- shadcn/ui
- React Router

**Server**
- Node.js
- Express
- TypeScript
- simple-git
- Zod (validation)

**Infrastructure**
- Docker & Docker Compose
- Nginx (client serving)

## License

MIT (or specify your license)

---

**Note**: This project is designed for educational purposes to manage exam variants and their associated repositories. Ensure you have proper access rights to any repositories you clone.
