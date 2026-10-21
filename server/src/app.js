import 'express-async-errors'
import express from 'express'
import cors from 'cors'
import { ZodError } from 'zod'
import { config } from './config.js'
import { requireAuth, localVerifier } from './auth.js'
import { authRoutes } from './routes/auth.js'
import { publicRoutes } from './routes/public.js'
import { hrRoutes } from './routes/hr.js'
import { viasocketRoutes } from './routes/viasocket.js'
import { agentRoutes } from './routes/agent.js'

/** `verifyToken` is injectable so tests can exercise the API without a running Supabase Auth. */
export function createApp({ verifyToken = localVerifier, staticDir } = {}) {
  const app = express()
  app.set('trust proxy', 1)
  app.use(cors({ origin: config.corsOrigins.length ? config.corsOrigins : true }))
  app.use(express.json({ limit: '1mb' }))

  app.use('/api', publicRoutes())
  app.use('/api', authRoutes())
  const auth = requireAuth(verifyToken)
  app.use('/api', auth, hrRoutes())
  app.use('/api/viasocket', auth, viasocketRoutes())
  app.use('/api/agent', auth, agentRoutes())

  if (staticDir) {
    app.use(express.static(staticDir))
    app.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile('index.html', { root: staticDir }))
  }

  app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }))
  // eslint-disable-next-line no-unused-vars
  app.use((err, _req, res, _next) => {
    if (err instanceof ZodError) return res.status(400).json({ error: 'Invalid input', details: err.issues.map((i) => `${i.path.join('.')}: ${i.message}`) })
    const status = err.status || 500
    if (status >= 500 && !err.code?.startsWith?.('viasocket') && !err.code?.endsWith?.('_not_configured')) console.error(err)
    res.status(status).json({ error: err.message || 'Server error', code: err.code && typeof err.code === 'string' && !/^\d/.test(err.code) ? err.code : undefined })
  })
  return app
}
