import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { get } from '../lib/api.js'
import CandidateTable from '../components/CandidateTable.jsx'
import { Badge, Card, Spinner } from '../components/ui.jsx'
import { InterviewerStats } from './Interviewers.jsx'

export default function InterviewerDetail() {
  const { id } = useParams()
  const iv = useQuery({ queryKey: ['interviewer', id], queryFn: () => get(`/interviewers/${id}`), refetchInterval: 5000 })
  if (iv.isError) return <Card><p className="text-sm text-slate-600">Interviewer not found. <Link className="text-brand-600" to="/interviewers">Back to interviewers</Link></p></Card>
  if (!iv.data) return <Spinner />
  const i = iv.data
  return (
    <div className="space-y-4">
      <div>
        <Link to="/interviewers" className="text-xs text-brand-600">← All interviewers</Link>
        <div className="flex flex-wrap items-center gap-3"><h1 className="text-2xl font-semibold">{i.name}</h1><Badge tone={i.active ? 'green' : 'slate'}>{i.active ? 'Active' : 'Inactive'}</Badge></div>
        <p className="text-sm text-slate-500">{i.email || 'no email'}</p>
      </div>
      <Card><InterviewerStats i={i} /></Card>
      <div>
        <h2 className="mb-2 text-sm font-semibold text-slate-700">Candidates assigned to {i.name}</h2>
        <CandidateTable interviewerId={i.id} />
      </div>
    </div>
  )
}
