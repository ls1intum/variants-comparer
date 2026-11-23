<div align="center">
  <img src="client/public/logo_comparer.png" alt="Variants Comparer Logo" width="200">
  
  # Exam Variants Comparer

  A tool to manage and compare multiple variants of exam exercises with test, solution, and template repositories.
</div>

## What is this tool?

The **Exam Variants Comparer** helps you manage and compare multiple variants of exam exercises:

- **Organize variants**: Handle up to 3 variants per exercise, each with test, solution, and template repositories
- **Clone in the browser**: Download all repositories in one click, or import them from a local folder / ZIP
- **No backend**: Everything runs and is stored locally in your browser (IndexedDB / localStorage)
- **Compare differences**: Side-by-side view to check differences between variants
- **Track review progress**: Mark files as reviewed, correct, or needing attention, with an optional comment
- **Export a review report**: Markdown summary of progress, findings, remaining work and edits, for yourself, as proof, or as hand-over to an AI agent
- **Keep notes**: Attach markdown notes to each variant
- **Fix mistakes in place**: Edit files and problem statements on the Compare page and write the changes back (Git push, Artemis, or ZIP download)

## Usage

The app is a static single-page application:

- **Hosted**: open the Cloudflare Pages instance (primary) or the GitHub Pages instance (backup).
- **Self-hosted with Docker**: `docker compose up -d --build`, then open http://localhost:3003.
- **Local development**: `cd client && npm install && npm run dev` (Vite, port 5173).

All configuration, review statuses and downloaded repositories are stored **in your browser only**. Use **Export** on the Configure page to back up your configuration (it can also import a `config.json` of the former server-based version). Downloaded repositories are not part of the export; re-download or re-import them on another machine.

## User Guide

### 1. Configure an Exercise

1. **Exercise Name**: Name your exercise (e.g., `exercise-1`)
2. **Proxy base URL**: Proxy used for cloning and Artemis downloads; preset to the default from `client/.env`, **Reset to default** undoes a per-browser override (see [Cloning and the CORS proxy](#cloning-and-the-cors-proxy))
3. **Configure Variants** (3):
   - **Variant Label**: e.g., "variant-a", "variant-b", "variant-c"
   - **Source**: *Repository URLs* (template, solution, and test repo URLs, or folder/ZIP import per repo) or *Artemis exercise* (see below)
   - **Problem Statement**: Markdown notes for each variant
4. **Artemis token** (shown once a variant uses the Artemis source): Needed only to load exercises directly from Artemis

Changes are saved automatically; the indicator at the top right shows *All changes saved* or why the configuration cannot be saved (e.g. a missing exercise name). Buttons are only enabled when their action can run; hover a disabled button to see what is missing. Each repository shows whether it is stored in the browser (*✓ N files*, × removes it) or *not loaded*. Renaming the exercise or a variant moves its stored repositories along.

> ⚠️ **For private repos**: Use token URLs: `https://<TOKEN>@github.com/org/repo.git`. The token is sent to the configured CORS proxy as an `Authorization` header.

### 2. Download or Import & Compare

- Click **Download N repositories** to clone all configured repository URLs, **or** use **or import: Folder / ZIP** below each URL field to load a repository you cloned or downloaded yourself (no proxy needed)
- **or** import a whole Artemis exercise per variant (see below)
- Navigate to **Compare** page to review differences
- On the **Compare** page, **View: One variant** diffs one variant against Variant 1 (cycle with the floating button); **View: All variants** shows Variant 1 and all other variants side by side, with rows aligned on Variant 1 and review buttons per variant
- The speech-bubble button next to the review buttons adds a **comment** to a file review (e.g. why it needs attention); it is kept when an edit resets the status
- **Clear downloaded repositories** removes the exercise's repositories from browser storage (after confirmation); the configuration is kept

### 3. Import Full Artemis Exercises

Instead of entering three repository URLs per variant, a variant can be filled from a complete Artemis programming exercise (template, solution, tests, and problem statement):

- **Upload exercise ZIP**: Upload the ZIP downloaded via the exercise's *Export* button in Artemis (the same ZIP Artemis accepts for re-import). No proxy or token needed.
- **Load from Artemis**: Paste the exercise URL (any URL containing `/programming-exercises/<id>`, e.g. `https://artemis.tum.de/api/programming/programming-exercises/22364/export-instructor-exercise` or the exercise page) and click **Load from Artemis**, or **Load N variants from Artemis**. This calls the instructor export endpoint and needs instructor rights for the exercise.

For loading by URL, paste your Artemis session token into **Artemis token**: log in to Artemis, open the browser dev tools → *Application* → *Cookies*, and copy the value of the `jwt` cookie. The token is kept for the current browser session only and is sent to Artemis through `/artemis-proxy`.

> ⚠️ The Artemis token grants full access to your Artemis account until it expires. Only use a proxy you trust, or download the ZIP in Artemis and upload it instead.

If the exercise name is still empty, it is taken from the exported exercise title.

### 4. File Mapping (Advanced)

Use **File Mapping** when files have different names or paths across variants:

#### Manual Mapping

1. Download or import the repositories of at least two variants (the files are then scanned automatically)
2. Scroll to the **File Mappings** section on the **Configure** page
3. Click **Add mapping**
4. Select:
   - **Base File**: The reference file from Variant 1
   - **Target Variant**: Which variant to compare (Variant 2 or 3)
   - **Variant File**: The corresponding file in the target variant

#### Automatic Mapping Suggestions

1. Click **Suggest mappings** (enabled once Variant 1 and another variant have stored repositories)
2. Review suggested file pairs with at least 50% content similarity
3. Click **Accept** or **Reject** for each suggestion

**Example**: The system might suggest mapping `src/Main.java` (Variant A) to `src/MainSolution.java` (Variant B) if they have 85% similar content.

#### Why Use File Mapping?

- Files renamed between variants (e.g., `Calculator.java` vs `CalculatorImpl.java`)
- Different directory structures across variants
- Logically equivalent files that don't share the same path
- Compare refactored code with original implementation

### 5. Edit and Write Back

Mistakes found while comparing can be fixed directly in the app:

1. On the **Compare** page (view *One variant*), click **Edit** on a file. Both sides open in an editor (Variant 1 left, the compared variant right); the arrows between them copy single changes from Variant 1, **Copy whole file** copies all of it. **Delete file** / **Create file** remove or add a file on either side. In *All variants*, **Edit** switches to the pairwise view of that variant.
2. **Save** stores the edit in the browser only and resets the review status of the file to unchecked.
3. The **Pending changes** panel lists all edits per variant (`A`dded / `M`odified / `D`eleted, **Discard** restores one). The Configure page shows `N modified` next to each repository and asks before re-downloading, re-importing or clearing would discard edits.
4. Write the changes back the way the variant was loaded:

| Loaded via | Write-back |
|---|---|
| Repository URL (cloned) | **Push**: commits all edits (message and author asked once, author remembered) and pushes to the cloned branch. If the remote branch has new commits, they are fetched and merged first; on a conflict nothing is pushed and the edits stay pending. |
| Folder / ZIP import | **Download … ZIP** of the edited repository. |
| Artemis exercise ZIP | **Download Artemis ZIP**: the original export with edited repositories and problem statement, for *Import from file* in Artemis (this creates a **new** exercise; Artemis cannot update an exercise from a ZIP). |
| Artemis URL | **Write to Artemis**: fetches the current exercise, merges changes made in Artemis since loading (a conflict aborts before anything is written), writes the files via the Artemis online-editor API (one commit per repository, which triggers a build) and updates the problem statement. Needs editor rights. **Download Artemis ZIP** is offered as a copy. |

> ⚠️ Writing to Artemis commits the shared server-side working copy of the online editor, including uncommitted edits other editors made there.

### 6. Export a Review Report

On the **Stats** page, **Export Report** builds a Markdown report of the active exercise or of all exercises:

- **Summary** per variant and content type: differing files, correct, needs attention, unreviewed
- **Needs attention**, **Not reviewed yet** and **Verified as correct** file lists with review comments
- **Edits**: changes written back (push, Artemis write, ZIP download; with date, way and commit message) and changes still pending

**Compact** keeps it to statistics and lists (to remember or to show as proof). **Detailed** adds the unified diffs of open files and edits plus a context block for AI agents, so the report can be pasted into an LLM to continue the consistency review. Preview the report, then **Copy to clipboard** or **Download .md**.

> Written-back edits are recorded in browser storage next to the variant's repositories; **Clear downloaded repositories** removes them, too.

## Cloning and the CORS proxy

Browsers cannot talk the Git smart-HTTP protocol to GitHub, GitLab, Artemis etc. directly, because these servers send no CORS headers. Cloning (via [isomorphic-git](https://isomorphic-git.org)) is therefore relayed through a small proxy:

- [client/functions/git-proxy/[[path]].ts](client/functions/git-proxy/[[path]].ts) is a Cloudflare Pages Function, deployed together with the app at `/git-proxy`. It only forwards Git smart-HTTP fetch and push requests (`info/refs?service=git-upload-pack|git-receive-pack`, `git-upload-pack`, `git-receive-pack`) and rejects everything else, so it is no open proxy.
- [client/functions/artemis-proxy/[[path]].ts](client/functions/artemis-proxy/[[path]].ts) at `/artemis-proxy` only forwards the Artemis endpoints the app uses, with the `Authorization` header: the instructor exercise export, the template/solution participation lookup, the online-editor file and commit endpoints of the template, solution and test repositories, and the problem statement update.
- CORS is granted to its own origin plus `ALLOWED_ORIGINS`; `ALLOWED_GIT_HOSTS` / `ALLOWED_ARTEMIS_HOSTS` optionally restrict the target hosts (see [client/wrangler.toml](client/wrangler.toml)).
- The proxy base URL can be changed per browser on the Configure page; leave it empty to fetch directly (only works for hosts that send CORS headers) or use the folder/ZIP imports.

> ⚠️ Access tokens embedded in repository URLs and the Artemis token pass through the proxy and grant write access (push, Artemis repository writes). Use the hosted proxy only if you trust it, deploy your own, or use folder/ZIP import.

## Deployment

### Cloudflare Pages (primary)

Connect the repository in Cloudflare Pages with:

- **Root directory**: `client`
- **Build command**: `npm run build`
- **Build output directory**: `dist`

The `client/functions` directory is deployed automatically as Pages Functions; `client/public/_redirects` provides the SPA fallback. Set `ALLOWED_ORIGINS` / `ALLOWED_GIT_HOSTS` / `ALLOWED_ARTEMIS_HOSTS` as environment variables (or via [client/wrangler.toml](client/wrangler.toml)). Test locally with `npm run build && npx wrangler pages dev`.

### Standalone proxy Worker (optional)

If the app is not served from Cloudflare Pages (GitHub Pages, Docker, local dev), the same proxies can run as a plain Cloudflare Worker ([client/worker/index.ts](client/worker/index.ts)):

```bash
cd client
# set ALLOWED_ORIGINS in worker/wrangler.toml to the app origin(s) first
npx wrangler deploy --config worker/wrangler.toml
```

Then set `VITE_PROXY_BASE` in [client/.env](client/.env) (the default for all builds) or the **Proxy base URL** in the app to the Worker URL, e.g. `https://variants-comparer-proxy.<account>.workers.dev`. A generic CORS proxy does not work here, because the app requests `<proxy base>/git-proxy/...` and `<proxy base>/artemis-proxy/...`.

### GitHub Pages (backup)

[.github/workflows/pages.yml](.github/workflows/pages.yml) deploys on every push to `main`. Enable *Settings → Pages → Source: GitHub Actions*. The build uses the default proxy from [client/.env](client/.env). The GitHub Pages origin must be listed in the proxy's `ALLOWED_ORIGINS`.

### Docker (self-hosted static bundle)

```bash
# Optional: override the default proxy base from client/.env
export VITE_PROXY_BASE=https://<your-proxy>
docker compose up -d --build   # or ./start.sh / start.bat
```

The image only serves the static build via nginx on port 3003. The proxy's `ALLOWED_ORIGINS` must include the origin you serve it from.

## Configuration

Build-time environment variables ([client/.env](client/.env)):

- `VITE_PROXY_BASE` – default base URL of the proxy, set in [client/.env](client/.env) to the hosted Worker (unset: own origin, i.e. the Cloudflare Pages Functions; empty: no proxy). A build environment variable overrides the file; users can override it per browser on the Configure page.
- `VITE_BASE` – base path of the deployment (default: `/`, GitHub Pages: `/<repo>/`)

## Troubleshooting

### Git Clone Failures
- **Private repos**: Must use token URLs: `https://<TOKEN>@github.com/org/repo.git`; SSH URLs do not work
- **CORS / network errors**: Check the proxy URL on the Configure page, and that the proxy allows your origin
- **Very large repositories** may exceed the browser storage quota; import only the needed folder instead

### Data disappeared
- Browser storage is per browser profile and origin; private windows and clearing site data remove it. Export your configuration regularly.

## Tech Stack

**App**: React 19, TypeScript, Vite, TailwindCSS, shadcn/ui, isomorphic-git, LightningFS, fflate, Zod, CodeMirror 6, node-diff3
**Proxy**: Cloudflare Pages Functions
**Infrastructure**: Cloudflare Pages, GitHub Pages, Docker + Nginx (static)
