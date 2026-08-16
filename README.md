# actik API

Hono + TypeScript backend, running on Bun, with a self-hosted HydraDB
`graph-node` alongside it in Docker Compose.

## Why HydraDB?

actik's whole pitch is *graph-native supply-chain defense*. Every feature in
this repo leans on a single graph of ~100k nodes and edges stored in HydraDB:

- **Blast radius** is `algo.SSPaths` over `DEPENDS_ON` edges — a traversal that
  a relational DB answers with recursive CTEs and a vector DB cannot answer at
  all.
- **Repo scanner** (`POST /api/scan`) writes `Repository → HAS_LOCKFILE →
  Lockfile → RESOLVES → PackageVersion` into the graph, then answers "which
  resolved versions have advisories?" with a single `AFFECTED_BY` join.
- **Exposure score** re-traverses the same graph after each proposed fix to
  prove the fix clears the blast radius.
- **Time travel** (`GET /api/advisories/:id/exposure-window?asOf=`) answers the
  track's hardest question — *"which applications resolved the compromised
  version while it was live?"* — by reading `scanned_at` on `RESOLVES` edges
  and `published_at`/`modified_at` on advisories. That's a temporal predicate
  over graph edges; no other store in this problem has the shape for it.

Everything the API returns (paths, chains, exposure windows) is produced by
traversing the graph, not by querying a table.

## Local development (without Docker)

```sh
bun install
bun run dev
```

Open http://localhost:8000/health

## Docker Compose (dev)

Pulls HydraDB's published image from `ghcr.io/hydra-db/hydradb`.

```sh
cp .env.example .env
docker compose -f compose.dev.yml up --build
```

- API: http://localhost:8000/health
- HydraDB HTTP: http://localhost:8443
- HydraDB Bolt: `bolt://localhost:7687`
- HydraDB readiness: http://localhost:9090/readyz

HydraDB data (store, cache, auth token) persists in `./hydradb-data`. The
compose `entrypoint` creates it on first start, so there is no manual setup.

## Docker Compose (prod)

```sh
cp .env.example .env
# set HYDRADB_AUTH_TOKEN to a real value (>= 32 chars)
docker compose -f compose.prod.yml up -d --build
```

In prod only the API port 8000 is published. HydraDB (8443/7687/9090) stays on
the internal compose network; the API reaches it at `http://hydradb:8443`.

Stop:

```sh
docker compose -f compose.prod.yml down
```

Data lives in `./hydradb-data`; back it up or mount it from a persistent volume
on the VPS.

## Data ingestion

Seeds a supply-chain graph into HydraDB from three sources — npm registry
(+ npm bulk audit advisories), PyPI (via its JSON API vulnerabilities), and
Google OSV — then builds `DEPENDS_ON` / `AFFECTED_BY` edges for blast-radius
traversal.

`DEPENDS_ON` edges are **version-to-version exact**: each dependency
declaration resolves to a single target version, preferring the version a real
lockfile resolved for the same source (lockfile-grounded), falling back to the
best range match. This keeps blast radius trustworthy — `express@5.2.1` points
at `qs@6.5.2`, not at every `qs` release.

After the package graph is written, the runner also ingests a synthetic
organization from `demo-org/` (see `DEMO_ORG_PATH`): each repository's
lockfiles are parsed into `Repository → HAS_LOCKFILE → Lockfile → RESOLVES →
PackageVersion` edges, keeping the *exact resolved version*, the *requested
range*, and the internal `node_modules` path as evidence.

```sh
cp .env.example .env
docker compose up -d --build
```

The API **auto-seeds on startup**: if HydraDB has an empty package graph it
runs the full ingestion pipeline before serving (fast-restart skips it when
already seeded). No manual `bun run ingest` needed. The command stays
available for a manual refresh:

```sh
docker compose exec api bun run ingest
```

All endpoints and limits come from env vars in `.env.example`
(`NPM_REGISTRY_URL`, `PYPI_JSON_URL`, `OSV_API_URL`,
`INGESTION_MAX_PACKAGES`, `INGESTION_MAX_DEPTH`, `INGESTION_MAX_ADVISORIES`,
`INGESTION_CONCURRENCY`, `DEMO_ORG_PATH`). Re-running is idempotent (stable
vertex ids + MERGE).

## Tests

```sh
bun test
bunx tsc --noEmit
```

## API

Mounts at `/api`. Error responses use `{"error":{"code","message"}}`; 404 for
unknown packages/advisories, 400 for invalid names, 429 when rate-limited.

All `:name` / `:name/:version` routes accept an optional `?ecosystem=npm|PyPI`
query parameter to disambiguate packages that share a name across ecosystems.

| Route | Purpose |
|---|---|
| `GET /api/packages/:name` | Package overview + version list |
| `GET /api/packages/:name/maintainers` | Maintainers of a package |
| `GET /api/packages/:name/shared-maintainers` | Packages sharing a maintainer |
| `GET /api/packages/:name/typosquats` | Similar-name candidates (npm search + Levenshtein) |
| `GET /api/packages/:name/:version` | Version details + its advisories |
| `GET /api/packages/:name/:version/dependencies` | Forward dependencies |
| `GET /api/packages/:name/:version/dependents` | Direct dependents |
| `GET /api/packages/:name/:version/blast-radius` | Direct/transitive dependents, max depth, paths, **per-repository exposure paths**, latency, affected repositories + resolution evidence |
| `GET /api/packages/:name/:version/graph` | Dependency neighborhood (for React Flow), incl. resolving repositories |
| `GET /api/advisories/:id` | Advisory details + affected versions + known fixed versions |
| `GET /api/advisories/:id/exposure-window` | Apps that resolved an affected version **while the advisory was live** (`scanned_at` within `[published_at, modified_at]`) with a per-app **`EXPOSED` / `AT_RISK` conclusion**; optional `?asOf=YYYY-MM-DD` snapshot |
| `GET /api/graph/:name/:version` | Same as `.../graph` (alias) |
| `POST /api/scan` | Scan a repository (`{"repo":"owner/name"}` or a full GitHub/GitLab/Bitbucket/Codeberg URL): fetch manifests, resolve exact versions, write into the graph, return exposure score + findings + fixes + minimal-fix set |
| `GET /api/scan/:owner/:name` | Re-run analysis for a previously scanned repo from the graph (no re-fetch) |
| `GET /api/simulate/propagation/:name/:version` | Worm simulation: compromise a package at `?compromisedAt=`, compute each app's time-to-exposure from DEPENDS_ON depth (`?perHopMs=`, default 6 min) |
| `GET /api/investigate/:ecosystem/:name/:version` | One-call investigation: version details + advisories + blast radius + **maintainer risk** (maintainers → other packages → repositories) + typosquats + recommendations |
| `POST /api/watch/run` | Live-watch pass: poll OSV for every scanned/resolved version, record newly-flagged advisories as Alert nodes with `first_seen_at` |
| `GET /api/watch/status` | Last live-watch run summary |
| `GET /api/watch/incidents` | Recent incidents, each with its exposure path (`repo → lockfile → pkg@version → advisory`) |

### Scanner

`POST /api/scan` pulls `package-lock.json`, `yarn.lock`, `pnpm-lock.yaml`,
`bun.lock`, `uv.lock` or `requirements*.txt` straight from the repository
(no clone, no token) across **GitHub, GitLab, Bitbucket and Codeberg** — the
default branch is resolved via each host's API (falling back to `HEAD`), then
manifests are fetched over raw URLs. It parses the exact resolved versions
(including nested `node_modules` resolutions), upserts the repo into HydraDB,
and returns:

- an **exposure score** (0–100) weighted by severity × count,
- each vulnerable package with its advisory, the **exact fix** (e.g.
  `npm install lodash@4.17.21`) sourced from the advisory's known fixed
  versions, and
- the **exposure path** from the app through the dependency chain.

The scan also returns a **minimal-fix set** — the fewest package upgrades that
clear every finding, each one *verified* by re-traversing HydraDB: the target
version must exist in the graph and resolve to zero advisories.

Findings are merged from two sources: `AFFECTED_BY` edges already in HydraDB
(`source: "graph"`) and a live Google OSV check against every resolved version
(`source: "osv"`), so a scan is useful on *any* lockfile, not just seeded
packages.

Resolved versions that aren't in the ingested graph are reported as
`unlinked`, so coverage is transparent.

### Time travel

`GET /api/advisories/:id/exposure-window` partitions the apps resolving an
affected version into:

- `exposedWhileLive` — apps whose scan happened **during** the advisory's
  `[published_at, modified_at]` window (the track's "09:00 compromised →
  09:06 exposed" scenario),
- `currentlyAffected` — every app still resolving an affected version.

Pass `?asOf=2026-05-14` to treat the graph as it was at that date (only
`RESOLVES` edges scanned up to then are considered).

### Propagation simulation (worm spread)

`GET /api/simulate/propagation/lodash/4.17.20?compromisedAt=2026-05-14T09:00:00Z&perHopMs=360000`
compromises a package at `t=0` and walks the reverse `DEPENDS_ON` closure. For
every app that resolves a reachable version it computes
`exposedAt = compromisedAt + depth × perHopMs`, where `depth` is the shortest
chain from the app's resolved version to the compromised one. Defaults to the
track's "09:00 compromised → 09:06 exposed" cadence.

### Live watch

`POST /api/watch/run` polls Google OSV for every version a scanned app resolves
and compares against what's already in the graph. Newly-flagged advisories
become `Alert` nodes (keyed by `advisory:version`, so `first_seen_at` is only
set once) with `ALERTS_ON` edges to the affected `PackageVersion` and
`EXPOSES` edges to every `Lockfile` that resolves it.
`GET /api/watch/incidents` lists them newest-first with their exposure path.
