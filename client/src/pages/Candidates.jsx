import { useSearchParams } from 'react-router-dom'
import CandidateTable from '../components/CandidateTable.jsx'

export default function Candidates() {
  const [sp] = useSearchParams()
  return (
    <div className="space-y-4">
      <div><h1 className="text-[24px] font-semibold tracking-tight">Candidates</h1><p className="text-sm text-slate-500">Every candidate across your drives. Move them through the stages as the day unfolds.</p></div>
      <CandidateTable initialPendingFeedback={sp.get('pending_feedback') === '1'} />
    </div>
  )
}
