import { useEffect, useRef, useState } from 'react'

// One hue (blue) for ordered data, from the reference palette: the funnel uses ordinal steps
// 250 -> 600 so the lightest bar still clears 2:1 on a white surface.
export const BLUE = '#2a78d6'
export const RAMP = { 250: '#86b6ef', 350: '#5598e7', 450: '#2a78d6', 600: '#184f95' }

/** Width of an element, tracked, so SVG text and dots keep their true size instead of stretching. */
function useWidth() {
  const ref = useRef(null); const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current; if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.round(e.contentRect.width))); ro.observe(el); setW(Math.round(el.getBoundingClientRect().width))
    return () => ro.disconnect()
  }, [])
  return [ref, w]
}

const NICE = [4, 8, 10, 20, 40, 50, 100, 200, 400, 500, 1000, 2000, 5000, 10000, 50000]
const niceMax = (v) => NICE.find((n) => n >= v) ?? Math.ceil(v / 1000) * 1000
const short = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString([], { day: 'numeric', month: 'short', timeZone: 'UTC' })

/** Area chart over days: 2px line, ~10% wash, hairline grid, end dot + value, crosshair tooltip, table view. */
export function AreaChart({ data, height = 200, noun = 'registrations' }) {
  const [ref, width] = useWidth(); const [hover, setHover] = useState(null)
  const m = { l: 30, r: 28, t: 16, b: 26 }
  const w = Math.max(width, 260); const iw = w - m.l - m.r; const ih = height - m.t - m.b
  const max = niceMax(Math.max(...data.map((d) => d.count), 0))
  const x = (i) => m.l + (data.length === 1 ? iw / 2 : (i / (data.length - 1)) * iw)
  const y = (v) => m.t + ih - (v / max) * ih
  const line = data.map((d, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(d.count).toFixed(1)}`).join(' ')
  const area = `${line} L${x(data.length - 1).toFixed(1)},${(m.t + ih).toFixed(1)} L${x(0).toFixed(1)},${(m.t + ih).toFixed(1)} Z`
  const last = data.length - 1; const total = data.reduce((n, d) => n + d.count, 0)
  const at = (clientX) => { const r = ref.current.getBoundingClientRect(); const i = Math.round(((clientX - r.left - m.l) / iw) * last); return Math.min(last, Math.max(0, i)) }
  const h = hover == null ? null : data[hover]
  return (
    <div ref={ref} className="relative">
      <svg width={w} height={height} role="img" aria-label={`${noun} per day, last ${data.length} days: ${total} in total`} className="block touch-none select-none"
        tabIndex={0} onKeyDown={(e) => { if (e.key === 'ArrowLeft') setHover((v) => Math.max(0, (v ?? last) - 1)); else if (e.key === 'ArrowRight') setHover((v) => Math.min(last, (v ?? -1) + 1)); else if (e.key === 'Escape') setHover(null) }} onBlur={() => setHover(null)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}><line x1={m.l} x2={w - m.r} y1={y(max * f)} y2={y(max * f)} stroke="#e7e5e4" strokeWidth="1" />
            <text x={m.l - 8} y={y(max * f) + 4} textAnchor="end" fontSize="11" fill="#78716c">{Math.round(max * f)}</text></g>))}
        <path d={area} fill={BLUE} opacity="0.1" />
        <path d={line} fill="none" stroke={BLUE} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
        {[0, Math.floor(last / 2), last].map((i, k) => <text key={i} x={x(i)} y={height - 6} textAnchor={k === 0 ? 'start' : k === 2 ? 'end' : 'middle'} fontSize="11" fill="#78716c">{short(data[i].day)}</text>)}
        {h && <line x1={x(hover)} x2={x(hover)} y1={m.t} y2={m.t + ih} stroke="#a8a29e" strokeWidth="1" />}
        {/* end dot carries a 2px surface ring so it stays legible over the line */}
        <circle cx={x(hover ?? last)} cy={y(data[hover ?? last].count)} r="5" fill={BLUE} stroke="#fff" strokeWidth="2" />
        {hover == null && <text x={x(last) + 9} y={y(data[last].count) + 4} fontSize="12" fontWeight="600" fill="#1c1917">{data[last].count}</text>}
        <rect x={m.l} y={0} width={iw} height={height} fill="transparent" onMouseMove={(e) => setHover(at(e.clientX))} onMouseLeave={() => setHover(null)} onTouchMove={(e) => setHover(at(e.touches[0].clientX))} />
      </svg>
      {h && (
        <div className="pointer-events-none absolute z-10 -translate-x-1/2 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs shadow-md" style={{ left: Math.min(Math.max(x(hover), 60), w - 60), top: 0 }}>
          <div className="text-slate-500">{short(h.day)}</div><div className="font-semibold text-slate-900 tabular-nums">{h.count} {h.count === 1 ? noun.replace(/s$/, '') : noun}</div>
        </div>)}
      <details className="mt-1 text-xs text-slate-500">
        <summary className="cursor-pointer select-none">View as table</summary>
        <table className="mt-1 w-full max-w-xs text-left"><tbody>{data.map((d) => <tr key={d.day} className="border-t border-slate-100"><td className="py-0.5">{short(d.day)}</td><td className="py-0.5 text-right tabular-nums text-slate-800">{d.count}</td></tr>)}</tbody></table>
      </details>
    </div>
  )
}

/** Ordered stages as horizontal bars (one hue, light -> dark), value at the tip, % of the previous stage on the right. */
export function Funnel({ stages }) {
  const base = Math.max(...stages.map((s) => s.value), 1)
  return (
    <ul className="space-y-3">
      {stages.map((s, i) => {
        const pct = stages[i - 1]?.value ? Math.round((s.value / stages[i - 1].value) * 100) : null
        return (
          <li key={s.label} className="grid grid-cols-[88px_1fr_44px] items-center gap-2 text-sm" title={`${s.label}: ${s.value}`}>
            <span className="text-slate-600">{s.label}</span>
            <div className="flex items-center gap-2">
              {/* <= 24px thick, 4px rounded data end, square at the baseline */}
              <div className="h-5 rounded-r-[4px]" style={{ width: `max(${(s.value / base) * 86}%, ${s.value ? 6 : 2}px)`, background: s.color, opacity: s.value ? 1 : 0.35 }} />
              <span className="font-semibold tabular-nums text-slate-900">{s.value}</span>
            </div>
            <span className="text-right text-xs tabular-nums text-slate-400">{pct == null ? '' : `${pct}%`}</span>
          </li>)
      })}
    </ul>
  )
}

/** One stacked bar per interviewer: finished / running / not started, 2px surface gaps between segments. */
export function LoadBars({ rows }) {
  const max = Math.max(...rows.map((r) => r.done + r.running + r.not_started), 1)
  const parts = [['done', 'Interviewed', RAMP[600]], ['running', 'In interview', RAMP[450]], ['not_started', 'Not started', RAMP[250]]]
  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">{parts.map(([, label, c]) => <span key={label} className="flex items-center gap-1.5"><i className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} />{label}</span>)}</div>
      <ul className="space-y-3">
        {rows.map((r) => {
          const total = r.done + r.running + r.not_started
          return (
            <li key={r.id} className="grid grid-cols-[96px_1fr_28px] items-center gap-2 text-sm">
              <span className="truncate text-slate-700" title={r.name}>{r.name}</span>
              {total ? (
                <div className="flex h-5 gap-[2px]" style={{ width: `${(total / max) * 100}%`, minWidth: 8 }}>
                  {parts.map(([k, label, c]) => r[k] > 0 && <div key={k} title={`${r.name}: ${r[k]} ${label.toLowerCase()}`} className="first:rounded-l-[4px] last:rounded-r-[4px]" style={{ flexGrow: r[k], background: c }} />)}
                </div>) : <span className="text-xs text-slate-400">no one assigned</span>}
              <span className="text-right text-xs font-semibold tabular-nums text-slate-700">{total}</span>
            </li>)
        })}
      </ul>
    </div>
  )
}
