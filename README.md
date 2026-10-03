# Orca Web

A native browser app for slicing models with OrcaSlicer on your home server. Upload an STL, preview it on the printer's build plate, choose bundled presets, slice in the background, and download validated G-code. All slicing happens on the server; clients need only a modern browser.

## Run on your LAN

The current image supports **Linux x86_64**, pins **OrcaSlicer 2.4.2** with its SHA-256 digest, and uses Node.js 22.

```bash
docker compose up -d --build
```

Open **http://SERVER_IP:8084** from another device on the same LAN. One container serves both the React application and API on port 8084. Runtime operation requires no external service or internet connection. The first image build downloads dependencies and the pinned slicer.

Job records, original models, working profiles, logs, and G-code persist in `./data`, mounted at `/data`. The image runs as UID/GID 1000; that user must be able to write the host data directory. The checked-in `data` directory is ready when the repository owner has UID 1000. If your host uses a different owner, prepare the directory once:

```bash
mkdir -p data
sudo chown -R 1000:1000 data
```

To use a different host port, create `.env` from `.env.example` and set `PORT`. The container's internal port remains 8084. Deployment is intended for a private LAN; the application includes no login system or public ingress setup.

## Included workflow

- STL upload with a configurable 250 MB limit, streamed to disk.
- Three.js build plate, orbit/pan/zoom, model bounds, X/Y/Z rotation, 90° axis turns, 180° flips, click-to-place on a face, uniform scale, reset, and automatic orientation/arrangement.
- Printer, process, and filament discovery from the actual installed Orca profiles. The catalog exposes only machines with a complete compatible preset set; this pin supplies KE 0.4 mm.
- Optional layer-height, wall-count, infill, support, and brim overrides applied to job-specific copies of bundled profiles.
- SQLite job history, a bounded in-process queue, live Server-Sent Events, cancellation, and deletion.
- Output validation against the selected printer, measured slicing time, print-duration/filament statistics when present, and G-code downloads.
- Desktop/tablet editing and phone-accessible job history and downloads.

The default printer is **Creality Ender-3 V3 KE 0.4 nozzle** and the process is **0.20mm Standard @Creality Ender3V3KE**. The installed machine supplies the build volume. The original requested PLA preset was renamed upstream; Orca 2.4.2's machine default is **Creality Generic PLA @Ender-3V3-all**, which this application discovers and uses.

Only STL uploads are enabled in this version. Arbitrary uploaded 3MF projects can carry printer settings, so importing them is postponed until that workflow is verified. Rotation and scaling of uploaded STLs use a server-generated standard 3MF containing only geometry and a placement transform: the pinned Linux build crashes with its direct rotation/scale flags. The working alternative was verified against actual G-code. See [the verified CLI contract](docs/orca-cli.md) for the pin, flags, inheritance handling, and compatibility findings.

Use **X/Y/Z +90°** to turn onto another side, **Flip X/Y/Z** for a half-turn, or **Place on face** and click/tap a flat face in the viewer. These actions turn on Ensure on bed and turn off Auto orient so the selected placement is preserved. Bed placement uses the actual transformed vertices in both preview and slicing, so irregular shapes are lowered until their lowest point touches the plate.

Orca determines the final arrangement and orientation and rejects models it cannot slice. Automatic orientation is applied during slicing, so the preview shows the requested manual transform. Tilted models may require supports. The app does not upload G-code to a printer or start prints automatically.

## Development

Use Node.js **22 LTS or 24 LTS**, and pnpm 10.32.1.

```bash
npm install --global pnpm@10.32.1
pnpm install
```

Install the same pinned Orca runtime into a user-writable directory:

```bash
sh scripts/install-orca.sh "$PWD/.local/orca"
export ORCA_BIN="$PWD/.local/orca/AppRun"
export ORCA_RESOURCES="$PWD/.local/orca/resources"
pnpm dev
```

Native Orca execution needs the Ubuntu 24.04 runtime libraries listed in the Dockerfile. Development serves Vite on port 5173 and proxies `/api` to the backend on port 8084. Production uses only port 8084.

```bash
pnpm test
pnpm typecheck
pnpm build
pnpm test:integration
pnpm exec playwright install chromium
pnpm test:browser
```

`pnpm test` runs unit/API tests and does not require Orca. `pnpm test:integration` starts the real server in an isolated temporary directory, slices the bundled cube, checks live events and actual G-code, verifies rotation/scale and all five overrides, and restarts the server to check persistence. It requires `ORCA_BIN` and `ORCA_RESOURCES`; it fails if a real slicer is unavailable. `KEEP_INTEGRATION_DATA=1` preserves its temporary files for debugging.

The Playwright tests run the real browser upload → preview → slice → download workflow and check phone access to job history. They also require the real slicer. The isolated native test server defaults to port 18084 (`ORCA_TEST_PORT` changes it) and a temporary data directory. Set `ORCA_TEST_URL` to test an already-running container instead of starting a native server:

```bash
ORCA_TEST_URL=http://127.0.0.1:8084 pnpm test:browser
```

To run the real slicing test **inside the deployed Docker runtime**:

```bash
pnpm test:integration:docker
```

This builds the Dockerfile's `integration` target and runs it without elevated capabilities. Run it whenever changing the Orca pin, followed by the browser tests against the production container. The Docker test requires a working local Docker daemon.

## Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8084` | Native API listen port / Compose host port |
| `HOST` | `0.0.0.0` | API listen interface |
| `DATA_DIR` | `./data` (`/data` in Docker) | Persistent jobs and SQLite |
| `ORCA_BIN` | `/opt/orca/AppRun` | Server-owned Orca executable |
| `ORCA_RESOURCES` | `/opt/orca/resources` | Installed bundled profile resources |
| `WEB_DIST` | `./apps/web/dist` | Compiled frontend directory |
| `MAX_UPLOAD_MB` | `250` | Maximum model upload size |
| `MAX_CONCURRENT_SLICES` | `1` | Maximum simultaneous slicing processes |
| `SLICER_TIMEOUT_SECONDS` | `900` | Total job processing deadline |

Compose intentionally sets conservative defaults. Change its `environment` section to adjust the upload limit, concurrency, or timeout.

## Jobs and API

Jobs progress through `queued`, `running`, `validating`, and then `succeeded`, `failed`, or `canceled`. Queued jobs resume after a restart. Interrupted running/validating jobs become failed with a clear restart message; completed jobs and their downloads remain available. Canceling terminates the slicer process group. Deleting a completed/failed/canceled job removes its files and metadata; jobs otherwise remain until explicitly deleted.

| Endpoint | Behavior |
| --- | --- |
| `GET /api/health` | Server and slicer availability |
| `GET /api/about` | Installed version, formats, upload limit |
| `GET /api/presets` | Discovered catalog and default selection |
| `POST /api/jobs` | Multipart `options` JSON and one `model` file; returns HTTP 202 |
| `GET /api/jobs` | Persistent job history |
| `GET /api/jobs/:id` | Current status and result |
| `DELETE /api/jobs/:id` | Cancel active job (202), or delete terminal job (204) |
| `GET /api/jobs/:id/events` | Live named SSE events and initial snapshot |
| `GET /api/jobs/:id/files` | Validated result files |
| `GET /api/jobs/:id/files/:file` | Download a known G-code file |

Requests select opaque preset IDs, validated transforms, and allowlisted overrides. The backend owns paths and argument arrays and launches Orca with `spawn(..., { shell: false })`. There is no command execution API. Neither the application nor its container installs desktop streaming, a remote GUI, or a display server.

## Repository

`apps/web` contains React/Vite/Three.js; `apps/server` contains Fastify, SQLite, job execution, and Orca integration; `packages/shared` owns API contracts and validation schemas. `fixtures/cube-20mm.stl`, the integration script, and Playwright tests exercise the real slicer workflow.

## Docker Compose

docker-compose.yaml

```yaml
services:
  orca-web:
    image: ghcr.io/reoriginai/orcaslicer-web:main
    container_name: orca-web
    restart: unless-stopped

    ports:
      - "8084:8084"

    volumes:
      - ./data:/data

    environment:
      PORT: 8084
      HOST: 0.0.0.0
      DATA_DIR: /data

      MAX_CONCURRENT_SLICES: 1
      MAX_UPLOAD_MB: 250
      SLICER_TIMEOUT_SECONDS: 900

    security_opt:
      - no-new-privileges:true

    cap_drop:
      - ALL

    init: true
    stop_grace_period: 20s
```

before starting `docker-compose.yaml` make a persistent directory `data` in the same workspace

```bash
mkdir -p data
sudo chown -R 1000:1000 data
```
