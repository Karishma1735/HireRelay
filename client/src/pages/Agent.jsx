import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Bot, Send, ShieldCheck } from 'lucide-react'
import { get, post } from '../lib/api.js'
import { Alert } from '../components/ui.jsx'

const SUGGESTIONS = ['How many candidates are waiting?', 'Which interviews have pending feedback?', 'Who has been waiting longest and what should I do next?', 'Prepare reminders for pending feedback']
const threadId = () => {
  try { let t = localStorage.getItem('hirerelay-agent-thread'); if (!t) { t = `main${Date.now().toString(36)}`; localStorage.setItem('hirerelay-agent-thread', t) } return t } catch { return 'main' }
}
const clock = (d) => new Date(d).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
const dayLabel = (d) => {
  const day = new Date(d); const today = new Date(); const diff = Math.round((new Date(today.toDateString()) - new Date(day.toDateString())) / 86400000)
  return diff === 0 ? 'Today' : diff === 1 ? 'Yesterday' : day.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
}

export default function Agent() {
  const tid = useRef(threadId()).current
  const [msgs, setMsgs] = useState([]); const [text, setText] = useState('')
  const scroller = useRef(null); const input = useRef(null); const firstPaint = useRef(true)
  const vs = useQuery({ queryKey: ['vs-status'], queryFn: () => get('/viasocket/status') })
  const hist = useQuery({ queryKey: ['agent-history', tid], queryFn: () => get(`/agent/history/${tid}`), enabled: !!vs.data?.configured, retry: false })
  useEffect(() => {
    // viaSocket keeps the thread; the stored user turn embeds the data snapshot, so show only the question.
    // Only fill an empty screen: history can arrive after the user already sent something, and must not wipe it.
    if (hist.data?.messages) setMsgs((cur) => cur.length ? cur : hist.data.messages.map((m) => ({ role: m.role, at: m.created_at, text: m.role === 'user' ? String(m.content).split(/\n\n(?:Live data snapshot|Current summary)/)[0].replace(/^HR question: /, '') : safeAnswer(m.content) })))
  }, [hist.data])

  const ask = useMutation({
    mutationFn: (message) => post('/agent/message', { message, thread_id: tid }),
    onMutate: (message) => setMsgs((m) => [...m, { role: 'user', text: message, at: Date.now() }]),
    onSuccess: (r) => setMsgs((m) => [...m, { role: 'assistant', text: r.answer, recs: r.recommendations, queued: r.queued_approvals, at: Date.now() }]),
    onError: (e) => setMsgs((m) => [...m, { role: 'error', text: e.message, at: Date.now() }])
  })

  // Like a chat app: the newest message is always in view, the first paint jumps, later ones glide.
  useLayoutEffect(() => {
    const el = scroller.current; if (!el) return
    el.scrollTo({ top: el.scrollHeight, behavior: firstPaint.current ? 'auto' : 'smooth' })
    if (msgs.length) firstPaint.current = false
  }, [msgs, ask.isPending])

  const send = (t) => {
    const v = (t ?? text).trim(); if (!v || ask.isPending) return
    setText(''); ask.mutate(v); input.current?.focus()
  }
  const blocked = vs.data && !vs.data.configured
  const loadingHistory = hist.isLoading && vs.data?.configured && !msgs.length

  return (
    <div className="flex h-[calc(100vh-6rem)] flex-col lg:h-[calc(100vh-4rem)]">
      <header className="mb-3 flex items-center gap-3">
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-white"><Bot className="h-5 w-5" /></span>
        <div><h1 className="text-lg font-semibold leading-tight">AI operations agent</h1>
          <p className="text-xs text-slate-500">{ask.isPending ? 'typing…' : 'Answers from your live data. Anything it proposes waits for your approval.'}</p></div>
      </header>
      {blocked && <Alert tone="warn">The agent runs on viaSocket AI and needs <code>{vs.data.missing.join(', ')}</code> in the server settings. See <Link className="underline" to="/setup">Setup</Link>.</Alert>}

      <div ref={scroller} className="mt-2 flex-1 overflow-y-auto rounded-xl border border-slate-200 bg-slate-100/70 px-3 py-4 sm:px-5" role="log" aria-live="polite" aria-label="Conversation">
        {/* min-h-full + a growing spacer pins short conversations to the bottom, and the list still scrolls normally when long. */}
        <div className="flex min-h-full flex-col gap-1.5">
          <div className="flex-1" />
          {loadingHistory && <p className="self-center text-xs text-slate-400">Loading conversation…</p>}
          {!loadingHistory && !msgs.length && (
            <div className="max-w-[85%] self-start rounded-2xl rounded-tl-sm bg-white px-3.5 py-2.5 text-sm shadow-sm">
              Hi! Ask me about your candidates, queues or feedback. I read your live data, and anything I suggest waits for your approval.
            </div>)}
          {msgs.map((m, i) => {
            const mine = m.role === 'user'; const prev = msgs[i - 1]
            const newDay = !prev || dayLabel(prev.at) !== dayLabel(m.at)
            const sameSender = prev && prev.role === m.role && !newDay
            return (
              <div key={i} className="contents">
                {newDay && m.at && <span className="my-2 self-center rounded-full bg-white px-3 py-0.5 text-xs text-slate-500 shadow-sm">{dayLabel(m.at)}</span>}
                {m.role === 'error' ? <div className="max-w-[85%] self-start"><Alert>{m.text}</Alert></div> : (
                  <div className={`w-fit max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-sm sm:max-w-[75%] ${mine ? 'self-end rounded-tr-sm bg-brand-600 text-white' : 'self-start rounded-tl-sm bg-white text-slate-800'} ${sameSender ? '' : 'mt-1.5'}`}>
                    <p className="whitespace-pre-wrap break-words">{m.text}</p>
                    {m.recs?.length > 0 && <ul className="mt-2 list-disc space-y-0.5 pl-5 text-slate-700">{m.recs.map((r, j) => <li key={j}>{r}</li>)}</ul>}
                    {m.queued?.length > 0 && (
                      <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-2 text-xs text-amber-900">
                        <div className="flex items-center gap-1 font-medium"><ShieldCheck className="h-3.5 w-3.5" /> {m.queued.length} action{m.queued.length > 1 ? 's' : ''} waiting for your approval</div>
                        <ul className="mt-1">{m.queued.map((q) => <li key={q.id}>{q.title}</li>)}</ul>
                        <Link to="/approvals" className="mt-1 inline-block font-medium underline">Review & approve</Link>
                      </div>)}
                    {m.at && <div className={`mt-0.5 text-right text-[10px] leading-none ${mine ? 'text-brand-200' : 'text-slate-400'}`}>{clock(m.at)}</div>}
                  </div>)}
              </div>)
          })}
          {ask.isPending && (
            <div className="mt-1.5 flex w-fit items-center gap-1 self-start rounded-2xl rounded-tl-sm bg-white px-4 py-3 shadow-sm" aria-label="The agent is typing">
              {[0, 150, 300].map((d) => <span key={d} className="h-2 w-2 animate-bounce rounded-full bg-slate-400" style={{ animationDelay: `${d}ms` }} />)}
            </div>)}
        </div>
      </div>

      {!msgs.length && !loadingHistory && !blocked && (
        <div className="mt-2 flex gap-2 overflow-x-auto pb-1">{SUGGESTIONS.map((s) => <button key={s} onClick={() => send(s)} className="shrink-0 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-sm text-slate-700 hover:bg-slate-50">{s}</button>)}</div>)}

      <form className="mt-2 flex items-end gap-2" onSubmit={(e) => { e.preventDefault(); send() }}>
        <textarea ref={input} rows={1} className="max-h-32 min-h-[44px] flex-1 resize-none rounded-3xl border border-slate-300 bg-white px-4 py-2.5 text-sm shadow-sm placeholder:text-slate-400 focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200 disabled:bg-slate-100"
          placeholder="Type a message" value={text} disabled={blocked} aria-label="Message"
          onChange={(e) => { setText(e.target.value); e.target.style.height = 'auto'; e.target.style.height = `${Math.min(e.target.scrollHeight, 128)}px` }}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); e.currentTarget.style.height = 'auto' } }} />
        <button type="submit" aria-label="Send" disabled={blocked || !text.trim() || ask.isPending} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white shadow-sm transition hover:bg-brand-700 disabled:bg-brand-300"><Send className="h-5 w-5" /></button>
      </form>
    </div>
  )
}

function safeAnswer(content) { try { const j = typeof content === 'string' ? JSON.parse(content) : content; return j.answer ?? String(content) } catch { return String(content) } }
