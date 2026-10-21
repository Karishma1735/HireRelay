import { Router } from 'express'
import rateLimit from 'express-rate-limit'
import { z } from 'zod'
import { one } from '../db.js'
import { signSession, hashPassword, checkPassword } from '../auth.js'

const creds = z.object({ email: z.string().trim().toLowerCase().email().max(200), password: z.string().min(8, 'Use at least 8 characters').max(200) })

export function authRoutes() {
  const r = Router()
  const limiter = rateLimit({ windowMs: 60_000, limit: 15, standardHeaders: true, legacyHeaders: false })
  const session = (u) => ({ token: signSession(u), user: { id: u.id, email: u.email } })

  r.post('/auth/signup', limiter, async (req, res) => {
    const { email, password } = creds.parse(req.body)
    if (await one('select 1 from users where email = $1', [email])) return res.status(409).json({ error: 'An account with this email already exists. Sign in instead.' })
    const u = await one('insert into users (email, password_hash) values ($1,$2) returning id, email', [email, hashPassword(password)])
    res.status(201).json(session(u))
  })

  r.post('/auth/login', limiter, async (req, res) => {
    const { email, password } = creds.parse(req.body)
    const u = await one('select * from users where email = $1', [email])
    // Same answer for unknown email and wrong password.
    if (!u || !checkPassword(password, u.password_hash)) return res.status(401).json({ error: 'Wrong email or password' })
    res.json(session(u))
  })
  return r
}
