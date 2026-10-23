import { useState } from 'react'
import { useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { Workflow, CheckCircle2 } from 'lucide-react'
import { Alert, Button, Field, Spinner } from '../components/ui.jsx'

const MAX_CV = 5 * 1024 * 1024

/** Public candidate registration form: no sign-in, shareable by HR. */
export default function Apply() {
  const { slug } = useParams()
  const drive = useQuery({ queryKey: ['public-drive', slug], queryFn: async () => { const r = await fetch(`/api/public/drives/${slug}`); const j = await r.json(); if (!r.ok) throw new Error(j.error); return j }, retry: false })
  const [f, setF] = useState({ full_name: '', email: '', phone: '', role_applied: '', experience_years: '', current_company: '', website: '' })
  const [state, setState] = useState({ busy: false, error: '', done: false })
  const [cv, setCv] = useState(null); const [cvError, setCvError] = useState('')
  const pickCv = (e) => {
    const file = e.target.files?.[0]; setCvError(''); setCv(null); if (!file) return
    if (!/\.(pdf|docx?)$/i.test(file.name)) return setCvError('Please choose a PDF, DOC or DOCX file.')
    if (file.size > MAX_CV) return setCvError('That file is larger than 5 MB.')
    setCv(file)
  }
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  async function submit(e) {
    e.preventDefault(); setState({ busy: true, error: '', done: false })
    const body = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ''))
    // With a CV the request is multipart; without one it stays plain JSON.
    let init = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    if (cv) { const fd = new FormData(); Object.entries(body).forEach(([k, v]) => fd.append(k, v)); fd.append('cv', cv); init = { method: 'POST', body: fd } }
    const r = await fetch(`/api/public/drives/${slug}/register`, init)
    const j = await r.json().catch(() => ({}))
    setState(r.ok ? { busy: false, error: '', done: true } : { busy: false, error: j.details?.join('. ') || j.error || 'Could not submit', done: false })
  }
  if (drive.isLoading) return <Spinner />
  if (drive.isError) return <div className="p-8 text-center text-slate-600">{drive.error.message}</div>
  const d = drive.data
  return (
    <div className="mx-auto max-w-lg p-4 sm:py-10">
      <div className="mb-5 flex items-center gap-2.5 font-semibold"><span className="flex h-7 w-7 items-center justify-center rounded-[7px] bg-ink-900 text-white"><Workflow className="h-4 w-4" /></span> HireRelay</div>
      <div className="rounded-xl bg-white p-5 shadow-pop ring-1 ring-slate-200 sm:p-7">
        <h1 className="text-[24px] font-semibold tracking-tight">{d.name}</h1>
        <p className="mb-4 mt-1 text-sm text-slate-500">{[d.role_title, d.venue, d.drive_date].filter(Boolean).join(' · ')}</p>
        {state.done ? (
          <div className="space-y-2 py-6 text-center"><CheckCircle2 className="mx-auto h-10 w-10 text-brand-600" /><p className="font-medium">You&apos;re registered.</p><p className="text-sm text-slate-500">Check in at the registration desk when you arrive.</p></div>
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
            <Field label="Upload your CV (optional)">
              <input className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-[7px] file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-medium file:text-brand-700 hover:file:bg-brand-100" type="file" accept=".pdf,.doc,.docx,application/pdf" onChange={pickCv} />
            </Field>
            <p className="-mt-1 text-xs text-slate-500">PDF, DOC or DOCX, up to 5 MB. {cv && <b className="text-slate-700">{cv.name} ({Math.max(1, Math.round(cv.size / 1024))} KB)</b>}</p>
            {cvError && <Alert>{cvError}</Alert>}
            <input className="hidden" tabIndex={-1} autoComplete="off" aria-hidden="true" value={f.website} onChange={set('website')} name="website" />
            {state.error && <Alert>{state.error}</Alert>}
            <p className="text-xs text-slate-500">Your details{cv ? ' and CV' : ''} are shared only with the hiring team and the interviewer assigned to you.</p>
            <Button variant="accent" className="w-full !h-10 !text-sm" loading={state.busy} disabled={!!cvError}>{state.busy && cv ? 'Uploading…' : 'Register'}</Button>
          </form>
        )}
      </div>
    </div>
  )
}
