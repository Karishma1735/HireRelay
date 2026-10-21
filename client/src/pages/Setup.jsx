import { useQuery } from '@tanstack/react-query'
import { CheckCircle2, Circle } from 'lucide-react'
import { Card, Spinner } from '../components/ui.jsx'

const GROUPS = {
  supabase: ['Supabase', <>Run <code>npx supabase start</code> (local), then <code>npx supabase db reset</code> to apply <code>supabase/migrations</code>. <code>npx supabase status</code> prints the URL and keys. Put them in <code>.env</code> and restart the server.</>],
  viasocket: ['viaSocket', <>Open <b>viaSocket → Integrations → the embed → Install Code</b> (click <b>Create embed</b> if there is none) and copy the org id, project id and embed secret into <code>.env</code>. The secret stays on the server.</>],
  hirerelay: ['HireRelay', <><code>INGEST_SECRET</code> is any long random string. <code>HIRERELAY_PUBLIC_URL</code> must be reachable from viaSocket&apos;s servers (a tunnel in development, your domain in production) — Google Forms responses are delivered there.</>]
}

export default function Setup({ standalone }) {
  const { data, isLoading } = useQuery({ queryKey: ['config'], queryFn: () => fetch('/api/config').then((r) => r.json()) })
  if (isLoading) return <Spinner />
  const items = data?.setup?.items || []
  return (
    <div className={standalone ? 'mx-auto max-w-2xl p-4 sm:p-8' : ''}>
      <h1 className="mb-1 text-2xl font-semibold">Setup</h1>
      <p className="mb-5 text-sm text-slate-500">Nothing below is faked: a feature that needs a missing value stays off and says why. Values are never shown here, only whether they are set.</p>
      <div className="space-y-4">
        {Object.entries(GROUPS).map(([g, [title, help]]) => (
          <Card key={g} title={title}>
            <p className="mb-3 text-sm text-slate-600">{help}</p>
            <ul className="space-y-1.5">
              {items.filter((i) => i.group === g).map((i) => (
                <li key={i.key} className="flex items-center gap-2 text-sm">
                  {i.ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <Circle className="h-4 w-4 text-slate-300" />}
                  <code className="text-xs">{i.key}</code><span className="text-slate-500">— {i.label}</span>
                </li>
              ))}
            </ul>
          </Card>
        ))}
      </div>
    </div>
  )
}
