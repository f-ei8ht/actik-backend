import { z } from 'zod'

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  FRONTEND_ORIGIN: z.string().default(''),
  HYDRADB_HTTP_URL: z.string().url().default('http://127.0.0.1:8443'),
  HYDRADB_AUTH_TOKEN: z.string().default(''),
  HYDRADB_NAMESPACE: z.string().default('default'),
  HYDRADB_GRAPH_ID: z.string().default('default'),
  HYDRADB_CELL_ID: z.string().default('cell-0'),
})

export const env = envSchema.parse(Bun.env)
