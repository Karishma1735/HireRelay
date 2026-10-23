import { createContext, useCallback, useContext, useState } from 'react'

const KEY = 'hirerelay-session'
const read = () => { try { return JSON.parse(localStorage.getItem(KEY)) } catch { return null } }
const write = (s) => { try { s ? localStorage.setItem(KEY, JSON.stringify(s)) : localStorage.removeItem(KEY) } catch { /* storage unavailable */ } }

export const getToken = () => read()?.token

const Ctx = createContext(null)
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }) {
  const [session, setSession] = useState(read)
  const authenticate = useCallback(async (mode, email, password) => {
    // The form calls its two modes 'signin' and 'signup'; the server routes are /auth/login and /auth/signup.
    const res = await fetch(`/api/auth/${mode === 'signin' ? 'login' : mode}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) })
    const j = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(j.details?.join('. ') || j.error || 'Could not sign in')
    write(j); setSession(j)
  }, [])
  const signOut = useCallback(() => { write(null); setSession(null) }, [])
  return <Ctx.Provider value={{ session, authenticate, signOut }}>{children}</Ctx.Provider>
}
