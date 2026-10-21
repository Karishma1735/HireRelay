import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './lib/auth.jsx'
import Layout from './components/Layout.jsx'
import Login from './pages/Login.jsx'
import Apply from './pages/Apply.jsx'
import Setup from './pages/Setup.jsx'
import Dashboard from './pages/Dashboard.jsx'
import Drives from './pages/Drives.jsx'
import DriveDetail from './pages/DriveDetail.jsx'
import Candidates from './pages/Candidates.jsx'
import Interviewers from './pages/Interviewers.jsx'
import Agent from './pages/Agent.jsx'
import Approvals from './pages/Approvals.jsx'
import Integrations from './pages/Integrations.jsx'

export default function App() {
  const { session } = useAuth()
  return (
    <Routes>
      <Route path="/apply/:slug" element={<Apply />} />
      {!session ? <Route path="*" element={<Login />} />
        : (
          <Route element={<Layout />}>
            <Route index element={<Dashboard />} />
            <Route path="drives" element={<Drives />} />
            <Route path="drives/:id" element={<DriveDetail />} />
            <Route path="candidates" element={<Candidates />} />
            <Route path="interviewers" element={<Interviewers />} />
            <Route path="agent" element={<Agent />} />
            <Route path="approvals" element={<Approvals />} />
            <Route path="integrations" element={<Integrations />} />
            <Route path="setup" element={<Setup />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Route>
        )}
    </Routes>
  )
}
