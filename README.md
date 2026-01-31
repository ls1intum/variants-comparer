<div align="center">
  <img src="client/public/logo_comparer.png" alt="Variants Comparer Logo" width="200">
  
  # Exam Variants Comparer

  A tool to manage and compare multiple variants of exam exercises with test, solution, and template repositories.
</div>

## What is this tool?

The **Exam Variants Comparer** helps you manage and compare multiple variants of exam exercises:

- **Organize variants**: Handle up to 3 variants per exercise, each with test, solution, and template repositories
- **Clone automatically**: Download all repositories in one click with proper folder organization
- **Compare differences**: Side-by-side view to check differences between variants
- **Track review progress**: Mark files as reviewed, correct, or needing attention
- **Keep notes**: Attach markdown notes to each variant

## Prerequisites

- Docker & Docker Compose v2
- Git
- Access to repositories you want to clone
- Node.js 18+ (for local development without Docker)

## Quick Start

```bash
# Clone and start
git clone https://github.com/ls1intum/variants-comparer.git
cd variants-comparer

# Linux/macOS:
./start.sh

# Windows:
start.bat

# Without scripts:
docker compose up -d --build

# Open browser at http://localhost:3003
```

## User Guide

### 1. Configure an Exercise

1. **Target Folder**: Where repositories should be saved (e.g., `my-exercises`)
2. **Exercise Name**: Name your exercise (e.g., `exercise-1`)
3. **Configure Variants** (1-3):
   - **Variant Label**: e.g., "variant-a", "variant-b", "variant-c"
   - **Repository URLs**: Template, Solution, and Test repos
   - **Notes**: Markdown notes for each variant

> ⚠️ **For private repos**: Use token URLs: `https://<TOKEN>@github.com/org/repo.git`

### 2. Download & Compare

- Click **Save Links** to persist configuration
- Click **Download** to clone all repositories
- Navigate to **Compare** page to review differences

### 3. File Mapping (Advanced)

Use **File Mapping** when files have different names or paths across variants:

#### Manual Mapping

1. After downloading, go to **Compare** page
2. Scroll to the **File Mappings** section
3. Click **Load Available Files** to scan all downloaded repositories
4. Click **"+ Add Mapping"**
5. Select:
   - **Base File**: The reference file from Variant 1
   - **Target Variant**: Which variant to compare (Variant 2 or 3)
   - **Variant File**: The corresponding file in the target variant

#### Automatic Mapping Suggestions

1. Click **Load Available Files** to scan repositories
2. Click **Suggest Mappings** button
3. Adjust the **similarity threshold** (default 50%)
4. Review suggested file pairs based on content similarity
5. Click ✓ to accept or × to reject each suggestion

**Example**: The system might suggest mapping `src/Main.java` (Variant A) to `src/MainSolution.java` (Variant B) if they have 85% similar content.

#### Why Use File Mapping?

- Files renamed between variants (e.g., `Calculator.java` vs `CalculatorImpl.java`)
- Different directory structures across variants
- Logically equivalent files that don't share the same path
- Compare refactored code with original implementation

## File Organization

### Directory Structure

```
<target-folder>/
  └── <exercise-name>/
      └── <variant-label>/
          ├── test/          # Test repository
          ├── solution/      # Solution repository
          ├── template/      # Template repository
          └── notes.md       # Notes
```

**Example**:
```
my-exercises/
  └── sorting-algorithms/
      ├── variant-a/
      │   ├── test/
      │   ├── solution/
      │   ├── template/
      │   └── notes.md
      ├── variant-b/
      └── variant-c/
```

## Running with Docker

### Start Services
```bash
docker compose up -d --build
```

### Stop Services
```bash
docker compose down
```

### View Logs
```bash
# All services
docker compose logs -f

# Specific service
docker compose logs -f server
docker compose logs -f client
```

### Volumes
- `./data` → `/data` in container (cloned repositories)
- `./server/storage` → `/app/storage` (configuration persistence)

## Local Development (Without Docker)

```bash
# Terminal 1: Server
cd server
npm install
npm run dev

# Terminal 2: Client
cd client
npm install
npm run dev
```

Server runs on port 4000, client on port 5173 (Vite default).

## Configuration

### Environment Variables

**Server** ([server/.env](server/.env)):
- `PORT` – Server port (default: 4000)
- `ALLOWED_BASE_DIR` – Base directory for downloads (default: /data)
- `CONFIG_PATH` – Config file path (default: /app/storage/config.json)

**Client** ([client/.env](client/.env)):
- `VITE_API_BASE_URL` – API endpoint (default: http://localhost:4000)

To change ports, edit the `.env` files and restart (or rebuild for Docker).

## Troubleshooting

### Git Clone Failures
- **Private repos**: Must use token URLs: `https://<TOKEN>@github.com/org/repo.git`
- Plain HTTPS URLs and SSH URLs will not work
- Verify token has repository access permissions

### Target Folder Rejected
- Ensure path is under `/data` when using Docker
- Server validates all downloads stay within `ALLOWED_BASE_DIR`

### Port Already in Use
Change ports in `docker-compose.yml`:
```yaml
ports:
  - "3004:80"    # Client
  - "4001:4000"  # Server
```

### Container Won't Start
```bash
# Check logs
docker logs exam-comparer-server
docker logs exam-comparer-client

# Force rebuild
docker compose up -d --build --force-recreate
```

### API Unreachable from Client
- Verify `VITE_API_BASE_URL` in [client/.env](client/.env) matches server URL
- Check server is running: `docker compose ps`
- Ensure containers are on same network

## Tech Stack

**Client**: React 19, TypeScript, Vite, TailwindCSS, shadcn/ui  
**Server**: Node.js, Express, TypeScript, simple-git, Zod  
**Infrastructure**: Docker, Docker Compose, Nginx
