import { useState } from 'react'
import { Radio } from 'lucide-react'
import { useAuth } from '../lib/auth.jsx'
import { Alert, Button, Field } from '../components/ui.jsx'

export default function Login() {
  const { supabase } = useAuth()
  const [mode, setMode] = useState('signin')
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState(''); const [info, setInfo] = useState(''); const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError(''); setInfo('')
    const { data, error } = mode === 'signin' ? await supabase.auth.signInWithPassword(form) : await supabase.auth.signUp(form)
    setBusy(false)
    if (error) setError(error.message)
    else if (mode === 'signup' && !data.session) setInfo('Check your inbox to confirm your email, then sign in.')
  }
  return (
    <div className="flex min-h-screen items-center justify-center p-4">
      <form onSubmit={submit} className="w-full max-w-sm space-y-4 rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex items-center gap-2 text-xl font-bold text-indigo-700"><Radio className="h-6 w-6" /> HireRelay</div>
        <p className="text-sm text-slate-500">Walk-in hiring coordinator for HR teams.</p>
        <Field label="Email"><input className="input" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
        <Field label="Password"><input className="input" type="password" required minLength={6} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
        {error && <Alert>{error}</Alert>}{info && <Alert tone="ok">{info}</Alert>}
        <Button className="w-full" loading={busy}>{mode === 'signin' ? 'Sign in' : 'Create account'}</Button>
        <button type="button" className="w-full text-center text-sm text-indigo-600" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
          {mode === 'signin' ? 'New here? Create an account' : 'Have an account? Sign in'}
        </button>
      </form>
    </div>
  )
}
