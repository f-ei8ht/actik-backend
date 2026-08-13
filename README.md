# actik API

Hono + TypeScript backend, running on Bun, with a self-hosted HydraDB
`graph-node` alongside it in Docker Compose.

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

```sh
cp .env.example .env
bun run ingest   # or: docker compose exec api bun run ingest
```

All endpoints and limits come from env vars in `.env.example`
(`NPM_REGISTRY_URL`, `PYPI_JSON_URL`, `OSV_API_URL`,
`INGESTION_MAX_PACKAGES`, `INGESTION_MAX_DEPTH`, `INGESTION_MAX_ADVISORIES`,
`INGESTION_CONCURRENCY`). Re-running is idempotent (stable vertex ids + MERGE).

## Tests

```sh
bun test
```

## API

Mounts at `/api`. Error responses use `{"error":{"code","message"}}`; 404 for
unknown packages/advisories, 400 for invalid names, 429 when rate-limited.

| Route | Purpose |
|---|---|
| `GET /api/packages/:name` | Package overview + version list |
| `GET /api/packages/:name/maintainers` | Maintainers of a package |
| `GET /api/packages/:name/shared-maintainers` | Packages sharing a maintainer |
| `GET /api/packages/:name/typosquats` | Similar-name candidates (npm search + Levenshtein) |
| `GET /api/packages/:name/:version` | Version details + its advisories |
| `GET /api/packages/:name/:version/dependencies` | Forward dependencies |
| `GET /api/packages/:name/:version/dependents` | Direct dependents |
| `GET /api/packages/:name/:version/blast-radius` | Direct/transitive dependents, max depth, paths, latency |
| `GET /api/packages/:name/:version/graph` | Dependency neighborhood (for React Flow) |
| `GET /api/advisories/:id` | Advisory details + affected versions |
| `GET /api/graph/:name/:version` | Same as `.../graph` (alias) |
