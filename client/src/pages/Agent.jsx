import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Bot, Send, ShieldCheck } from 'lucide-react'
import { get, post } from '../lib/api.js'
import { Alert, Button, Spinner } from '../components/ui.jsx'

const SUGGESTIONS = ['How many candidates are waiting?', 'Which interviews have pending feedback?', 'Who has been waiting longest and what should I do next?', 'Prepare reminders for pending feedback']
const threadId = () => {
  try { let t = localStorage.getItem('hirerelay-agent-thread'); if (!t) { t = `main${Date.now().toString(36)}`; localStorage.setItem('hirerelay-agent-thread', t) } return t } catch { return 'main' }
}

export default function Agent() {
  const tid = useRef(threadId()).current
  const [msgs, setMsgs] = useState([]); const [text, setText] = useState(''); const bottom = useRef(null)
  const vs = useQuery({ queryKey: ['vs-status'], queryFn: () => get('/viasocket/status') })
  const hist = useQuery({ queryKey: ['agent-history', tid], queryFn: () => get(`/agent/history/${tid}`), enabled: !!vs.data?.configured, retry: false })
  useEffect(() => {
    // viaSocket keeps the thread; the stored user turn embeds the data snapshot, so show only the question.
    if (hist.data?.messages) setMsgs(hist.data.messages.map((m) => ({ role: m.role, text: m.role === 'user' ? String(m.content).split('\n\nLive data snapshot')[0].replace(/^HR question: /, '') : safeAnswer(m.content) })))
  }, [hist.data])
  useEffect(() => { bottom.current?.scrollIntoView({ behavior: 'smooth' }) }, [msgs])
  const ask = useMutation({
    mutationFn: (message) => post('/agent/message', { message, thread_id: tid }),
    onMutate: (message) => setMsgs((m) => [...m, { role: 'user', text: message }]),
    onSuccess: (r) => setMsgs((m) => [...m, { role: 'assistant', text: r.answer, recs: r.recommendations, queued: r.queued_approvals }]),
    onError: (e) => setMsgs((m) => [...m, { role: 'error', text: e.message }])
  })
  const send = (t) => { const v = (t ?? text).trim(); if (!v || ask.isPending) return; setText(''); ask.mutate(v) }
  const blocked = vs.data && !vs.data.configured
  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col lg:h-[calc(100vh-4rem)]">
      <div className="mb-3"><h1 className="flex items-center gap-2 text-2xl font-semibold"><Bot className="h-6 w-6 text-indigo-600" /> AI operations agent</h1>
        <p className="text-sm text-slate-500">Answers from your live data. Anything it proposes is queued for your approval, never sent directly.</p></div>
      {blocked && <Alert tone="warn">The agent runs on viaSocket AI and needs <code>{vs.data.missing.join(', ')}</code> in <code>.env</code>. See <Link className="underline" to="/setup">Setup</Link>.</Alert>}
      <div className="mt-3 flex-1 space-y-3 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4">
        {hist.isLoading && vs.data?.configured && <Spinner />}
        {!msgs.length && !hist.isLoading && (<div className="space-y-2"><p className="text-sm text-slate-500">Try asking:</p>
          <div className="flex flex-wrap gap-2">{SUGGESTIONS.map((s) => <button key={s} disabled={blocked} onClick={() => send(s)} className="rounded-full border border-slate-200 px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50 disabled:opacity-50">{s}</button>)}</div></div>)}
        {msgs.map((m, i) => m.role === 'user' ? <div key={i} className="ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-indigo-600 px-3.5 py-2 text-sm text-white">{m.text}</div>
          : m.role === 'error' ? <Alert key={i}>{m.text}</Alert>
          : (<div key={i} className="max-w-[90%] space-y-2 rounded-2xl rounded-bl-sm bg-slate-100 px-3.5 py-2.5 text-sm"><p className="whitespace-pre-wrap">{m.text}</p>
            {m.recs?.length > 0 && <ul className="list-disc space-y-0.5 pl-5 text-slate-700">{m.recs.map((r, j) => <li key={j}>{r}</li>)}</ul>}
            {m.queued?.length > 0 && <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900"><div className="flex items-center gap-1 font-medium"><ShieldCheck className="h-3.5 w-3.5" /> {m.queued.length} action{m.queued.length > 1 ? 's' : ''} waiting for your approval</div>
              <ul className="mt-1">{m.queued.map((q) => <li key={q.id}>{q.title}</li>)}</ul><Link to="/approvals" className="mt-1 inline-block font-medium underline">Review & approve</Link></div>}</div>))}
        {ask.isPending && <div className="text-sm text-slate-400">Reading your live data…</div>}<div ref={bottom} />
      </div>
      <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); send() }}>
        <input className="input" placeholder="Ask about candidates, queues or feedback…" value={text} onChange={(e) => setText(e.target.value)} disabled={blocked} />
        <Button disabled={blocked || !text.trim()} loading={ask.isPending}><Send className="h-4 w-4" /></Button>
      </form>
    </div>
  )
}
function safeAnswer(content) { try { const j = typeof content === 'string' ? JSON.parse(content) : content; return j.answer ?? String(content) } catch { return String(content) } }
