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

## Quick Start

```bash
# Clone and start
git clone https://github.com/ls1intum/variants-comparer.git
cd variants-comparer
./start.sh  # or start.bat on Windows

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
- Use **File Mapping** for files with different names/paths across variants

## File Mapping & Organization

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

### File Mapping Feature

Compare files with **different names or paths** across variants:

1. After download, go to **Compare** page
2. Click **"+ Add Mapping"**
3. Select base file, target variant, and corresponding file
4. System can auto-suggest mappings based on content similarity

**Example**: Compare `src/Main.java` (Variant A) with `src/MainSolution.java` (Variant B)

## Configuration

Edit [client/.env](client/.env) and [server/.env](server/.env) to change ports or API URLs.

## Troubleshooting

**Git clone failures**: Use token URLs for private repos: `https://<TOKEN>@github.com/org/repo.git`

**Port conflicts**: Change ports in `docker-compose.yml`

**Logs**: `docker compose logs -f`
