# actik API

Hono + TypeScript backend, running on Bun.

## Local development

```sh
bun install
bun run dev
```

Open http://localhost:8000/health

## Docker (dev)

Hot reload, bind-mounted source:

```sh
docker compose -f compose.dev.yml up --build
```

## Docker (prod)

```sh
cp .env.example .env
docker compose -f compose.prod.yml up -d --build
```

Stop:

```sh
docker compose -f compose.prod.yml down
```
