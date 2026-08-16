import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  FRONTEND_ORIGIN: z.string().default(''),
  TRUST_PROXY: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  HYDRADB_HTTP_URL: z.preprocess(
    (value) =>
      value === '' || value === undefined ? 'http://127.0.0.1:8443' : value,
    z.string().url()
  ),
  HYDRADB_AUTH_TOKEN: z.string().default(''),
  HYDRADB_NAMESPACE: z.string().default('default'),
  HYDRADB_GRAPH_ID: z.string().default('default'),
  HYDRADB_CELL_ID: z.string().default('cell-0'),
  NPM_REGISTRY_URL: z.string().url().default('https://registry.npmjs.org'),
  PYPI_JSON_URL: z.string().url().default('https://pypi.org/pypi'),
  OSV_API_URL: z.string().url().default('https://api.osv.dev'),
  INGESTION_MAX_PACKAGES: z.coerce.number().int().positive().default(50),
  INGESTION_MAX_DEPTH: z.coerce.number().int().positive().default(2),
  INGESTION_MAX_ADVISORIES: z.coerce.number().int().positive().default(500),
  INGESTION_CONCURRENCY: z.coerce.number().int().positive().default(8),
  DEMO_ORG_PATH: z.string().default('demo-org'),
})

export const env = envSchema.parse(Bun.env)
