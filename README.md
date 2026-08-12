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
