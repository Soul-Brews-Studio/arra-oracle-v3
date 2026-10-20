# GitHub Codespaces Prebuilds

This repository supports [GitHub Codespaces prebuilds](https://docs.github.com/en/codespaces/prebuilding-your-codespaces/about-github-codespaces-prebuilds) so new environments start in seconds instead of minutes.

## Enabling Prebuilds

Only repository administrators can enable prebuilds:

1. Go to **Settings > Codespaces > Prebuilds** in this repository.
2. Select the template region closest to the team.
3. Enable prebuilds for the branches you want (e.g. `main` and `feat/codespaces-prebuild`).
4. Save. The first prebuild will start automatically and a status badge will appear on the repository homepage.

## Creating a Codespace from a Prebuild

### From the Web UI

1. Open the repository on GitHub.
2. Click **Code > Codespaces > Create codespace on `<branch>`**.
3. If a prebuild is available, the dialog will say **"Prebuild ready"** and the environment will use it.

### From the CLI

```bash
gh codespace create --repo Soul-Brews-Studio/arra-oracle-v3 --branch main
```

To see which codespaces used a prebuild:

```bash
gh codespace list
```

Look for the `Prebuild` column.

## What Is Cached

The dev container runs the heavy setup during the prebuild phase via `onCreateCommand`:

- Installs Bun dependencies (`bun install`).
- Seeds `.env` from `.env.example` if one does not exist.
- Warms the Bun install cache volume.

When a new codespace launches from the prebuild, only lightweight per-user setup remains.

## Forwarded Ports

The following ports are forwarded automatically and labeled in the **Ports** panel:

| Port | Label | Purpose |
| :--- | :--- | :--- |
| `47778` | Oracle HTTP/MCP API | Main Oracle server and MCP interface |
| `8000` | ChromaDB | Local vector database (via Docker Compose) |
| `3000` | Oracle Web (Astro dev) | Astro development server when running `bun run dev` in `web/` |
| `4321` | Astro default | Astro's default dev server port |

> **Note:** Ollama (`http://host.docker.internal:11434`) is **not** forwarded by default. Run Ollama on the host machine or Codespaces host, or add `11434` to `forwardPorts` if you want to expose it.

## Common Commands

```bash
# Start the Oracle server
bun run server

# Start the vector server in read-only mode
bun run vector

# Start the web frontend
cd web && bun run dev

# Run unit tests
bun run test:unit

# Check health
curl http://localhost:47778/api/health
```

## Troubleshooting

- **Port label is missing**: Open the Ports panel, right-click the port, and choose **Set Label**.
- **Prebuild is stale**: Push a new commit to the configured branch or manually trigger a prebuild rebuild from **Settings > Codespaces > Prebuilds**.
- **Dependency changes feel slow**: `updateContentCommand` runs `bun install` when the codespace resumes after code changes. For a fresh prebuild, commit the updated lockfile and trigger a rebuild.
