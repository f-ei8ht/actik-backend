import { Hono } from 'hono'
import { getRecentIncidents, getWatchStatus, runLiveWatch } from '../services/watch.service'

const app = new Hono()

app.post('/run', async (c) => {
  const status = await runLiveWatch()
  return c.json({ watch: status }, status.lastError ? 502 : 200)
})

app.get('/status', (c) => c.json({ watch: getWatchStatus() }))

app.get('/incidents', async (c) => {
  const limitRaw = c.req.query('limit')
  const limit = limitRaw ? Math.min(50, Math.max(1, Number(limitRaw))) : 20
  return c.json({ incidents: await getRecentIncidents(limit) })
})

export default app
