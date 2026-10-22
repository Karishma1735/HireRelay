import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import jwt from 'jsonwebtoken'
import { config } from './config.js'

// Session tokens are HS256 JWTs signed with SESSION_SECRET, or a random secret generated once and kept in DATA_DIR.
let secret
function sessionSecret() {
  if (secret) return secret
  if (config.sessionSecret) return (secret = config.sessionSecret)
  const file = path.join(config.dataDir, 'session-secret')
  try { secret = fs.readFileSync(file, 'utf8').trim() } catch {
    fs.mkdirSync(config.dataDir, { recursive: true })
    secret = crypto.randomBytes(48).toString('hex')
    fs.writeFileSync(file, secret, { mode: 0o600 })
  }
  return secret
}

export const signSession = (user) => jwt.sign({ sub: user.id, email: user.email }, sessionSecret(), { algorithm: 'HS256', expiresIn: '30d' })

export async function localVerifier(token) {
  try {
    const p = jwt.verify(token, sessionSecret(), { algorithms: ['HS256'] })
    return { id: p.sub, email: p.email }
  } catch { return null }
}

/** HMAC of `purpose:value` with the server secret: for links that must be unguessable and unforgeable. */
export const signValue = (purpose, value) => crypto.createHmac('sha256', sessionSecret()).update(`${purpose}:${value}`).digest('base64url')

// Agent lookup tokens: short-lived, one user, read-only, and signed with a DIFFERENT key than login sessions,
// so a leaked tool token can never be used to sign in and a session token is never accepted by the tool routes.
const toolKey = () => `${sessionSecret()}:agent-tools`
export const signToolToken = (userId) => jwt.sign({ sub: userId, aud: 'agent-tools' }, toolKey(), { algorithm: 'HS256', expiresIn: '10m' })
export function verifyToolToken(token) {
  try { return jwt.verify(token, toolKey(), { algorithms: ['HS256'], audience: 'agent-tools' }).sub } catch { return null }
}

export function hashPassword(password) {
  const salt = crypto.randomBytes(16)
  return `${salt.toString('hex')}:${crypto.scryptSync(password, salt, 64).toString('hex')}`
}
export function checkPassword(password, stored) {
  const [salt, hash] = String(stored).split(':')
  if (!salt || !hash) return false
  const a = crypto.scryptSync(password, Buffer.from(salt, 'hex'), 64); const b = Buffer.from(hash, 'hex')
  return a.length === b.length && crypto.timingSafeEqual(a, b)
}

export function requireAuth(verify) {
  return async (req, res, next) => {
    const header = req.headers.authorization || ''
    const token = header.startsWith('Bearer ') ? header.slice(7) : ''
    if (!token) return res.status(401).json({ error: 'Sign in required' })
    try {
      const user = await verify(token)
      if (!user) return res.status(401).json({ error: 'Invalid or expired session' })
      req.user = user
      next()
    } catch (e) { next(e) }
  }
}
