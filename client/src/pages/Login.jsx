import { useState } from 'react'
import { Workflow, ListOrdered, UserCheck, Layers } from 'lucide-react'
import { useAuth } from '../lib/auth.jsx'
import { Alert, Button, Field } from '../components/ui.jsx'

export default function Login() {
  const { authenticate } = useAuth()
  const [mode, setMode] = useState('signin')
  const [form, setForm] = useState({ email: '', password: '' })
  const [error, setError] = useState(''); const [busy, setBusy] = useState(false)
  async function submit(e) {
    e.preventDefault(); setBusy(true); setError('')
    try { await authenticate(mode, form.email, form.password) } catch (err) { setError(err.message); setBusy(false) }
  }
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden flex-col justify-between overflow-hidden bg-ink-900 p-12 text-white lg:flex">
        <div className="flex items-center gap-2.5"><span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-white text-ink-900"><Workflow className="h-4 w-4" /></span><span className="text-[16px] font-semibold tracking-tight">HireRelay</span></div>
        <div>
          <div className="text-[38px] font-semibold leading-[1.1] tracking-tight">Run walk-in hiring<br />without the chaos.</div>
          <p className="mt-4 max-w-md text-[16px] text-slate-400">Registration, queue, interviewers and feedback in one place. Every email goes out on time.</p>
          <ul className="mt-8 space-y-3.5 text-[14.5px]">
            {[[ListOrdered, 'Queue numbers sent the moment people check in'], [UserCheck, 'Interviewers briefed with the CV attached'], [Layers, 'Multi-round interviews with separate feedback']].map(([Icon, t]) => (
              <li key={t} className="flex items-center gap-3"><span className="flex h-8 w-8 items-center justify-center rounded-[8px] bg-white/10 text-brand-300"><Icon className="h-4 w-4" /></span>{t}</li>))}
          </ul>
        </div>
        <div className="text-[13px] text-slate-500">Your data stays in your account.</div>
        <div className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-brand-600/20 blur-3xl" />
      </div>
      <div className="flex items-center justify-center p-6">
        <form onSubmit={submit} className="w-full max-w-sm space-y-4">
          <div className="mb-2 flex items-center gap-2 text-lg font-semibold lg:hidden"><Workflow className="h-5 w-5 text-brand-600" /> HireRelay</div>
          <div><h1 className="text-[26px] font-semibold tracking-tight">{mode === 'signin' ? 'Welcome back' : 'Create your account'}</h1><p className="mt-1 text-sm text-slate-500">Walk-in hiring coordinator for HR teams.</p></div>
          <Field label="Email"><input className="input !h-10" type="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></Field>
          <Field label={mode === 'signup' ? 'Password (8+ characters)' : 'Password'}><input className="input !h-10" type="password" required minLength={8} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} /></Field>
          {error && <Alert>{error}</Alert>}
          <Button variant="accent" className="w-full !h-10 !text-sm" loading={busy}>{mode === 'signin' ? 'Sign in' : 'Create account'}</Button>
          <button type="button" className="w-full text-center text-sm text-slate-500" onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}>
            {mode === 'signin' ? <>New here? <span className="font-medium text-brand-600">Create an account</span></> : <>Have an account? <span className="font-medium text-brand-600">Sign in</span></>}
          </button>
        </form>
      </div>
    </div>
  )
}
