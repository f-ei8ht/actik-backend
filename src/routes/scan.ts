import { Hono } from 'hono'
import { z } from 'zod'
import { analyzeRepository, scanRepository } from '../services/scan.service'

const app = new Hono()

const repoSchema = z.string().min(3).max(200).regex(/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/)
const nameSchema = z.string().min(1).max(100).regex(/^[a-zA-Z0-9._-]+$/)

app.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}))
  const repo = repoSchema.safeParse(body.repo)
  if (!repo.success) {
    return c.json(
      { error: { code: 'invalid_repo', message: 'expected {"repo": "owner/repo"}' } },
      400
    )
  }
  const result = await scanRepository(repo.data)
  return c.json({ scan: result }, 201)
})

app.get('/:owner/:name', async (c) => {
  const owner = nameSchema.parse(c.req.param('owner'))
  const name = nameSchema.parse(c.req.param('name'))
  return c.json({ scan: await analyzeRepository(owner, name) })
})

export default app
