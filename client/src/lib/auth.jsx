import { createContext, useContext, useEffect, useState } from 'react'
import { getSupabase } from './supabase.js'

const Ctx = createContext(null)
export const useAuth = () => useContext(Ctx)

export function AuthProvider({ children }) {
  const [state, setState] = useState({ loading: true, session: null, supabase: null })
  useEffect(() => {
    let sub
    getSupabase().then(async (supabase) => {
      if (!supabase) return setState({ loading: false, session: null, supabase: null })
      const { data } = await supabase.auth.getSession()
      setState({ loading: false, session: data.session, supabase })
      sub = supabase.auth.onAuthStateChange((_e, session) => setState((s) => ({ ...s, session }))).data.subscription
    }).catch(() => setState({ loading: false, session: null, supabase: null }))
    return () => sub?.unsubscribe()
  }, [])
  return <Ctx.Provider value={state}>{children}</Ctx.Provider>
}
