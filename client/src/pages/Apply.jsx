import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Radio, CheckCircle2 } from 'lucide-react'
import { Alert, Button, Field, Spinner } from '../components/ui.jsx'

/** Public candidate registration form: no sign-in, shareable by HR. */
export default function Apply() {
  const { slug } = useParams()
  const drive = useQuery({ queryKey: ['public-drive', slug], queryFn: async () => { const r = await fetch(`/api/public/drives/${slug}`); const j = await r.json(); if (!r.ok) throw new Error(j.error); return j }, retry: false })
  const [f, setF] = useState({ full_name: '', email: '', phone: '', role_applied: '', experience_years: '', current_company: '', website: '' })
  const [state, setState] = useState({ busy: false, error: '', done: false })
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  async function submit(e) {
    e.preventDefault(); setState({ busy: true, error: '', done: false })
    const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ''))
    const r = await fetch(`/api/public/drives/${slug}/register`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const j = await r.json().catch(() => ({}))
    setState(r.ok ? { busy: false, error: '', done: true } : { busy: false, error: j.details?.join('. ') || j.error || 'Could not submit', done: false })
  }
  if (drive.isLoading) return <Spinner />
  if (drive.isError) return <div className="p-8 text-center text-slate-600">{drive.error.message}</div>
  const d = drive.data
  return (
    <div className="mx-auto max-w-lg p-4 sm:py-10">
      <div className="mb-4 flex items-center gap-2 font-bold text-indigo-700"><Radio className="h-5 w-5" /> HireRelay</div>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
        <h1 className="text-xl font-semibold">{d.name}</h1>
        <p className="mb-4 mt-1 text-sm text-slate-500">{[d.role_title, d.venue, d.drive_date].filter(Boolean).join(' · ')}</p>
        {state.done ? (
          <div className="space-y-2 py-6 text-center"><CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" /><p className="font-medium">You&apos;re registered.</p><p className="text-sm text-slate-500">Check in at the registration desk when you arrive.</p></div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <Field label="Full name *"><input className="input" required minLength={2} value={f.full_name} onChange={set('full_name')} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Email"><input className="input" type="email" value={f.email} onChange={set('email')} /></Field>
              <Field label="Phone"><input className="input" type="tel" value={f.phone} onChange={set('phone')} /></Field>
            </div>
            <p className="-mt-1 text-xs text-slate-500">Provide at least an email or a phone number.</p>
            <Field label="Role applying for"><input className="input" value={f.role_applied} onChange={set('role_applied')} placeholder={d.role_title || ''} /></Field>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Years of experience"><input className="input" type="number" min="0" max="60" step="0.5" value={f.experience_years} onChange={set('experience_years')} /></Field>
              <Field label="Current company"><input className="input" value={f.current_company} onChange={set('current_company')} /></Field>
            </div>
            <input className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website} onChange={set('website')} name="website" />
            {state.error && <Alert>{state.error}</Alert>}
            <Button className="w-full" loading={state.busy}>Register</Button>
          </form>
        )}
      </div>
    </div>
  )
}
