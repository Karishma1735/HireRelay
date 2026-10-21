import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import App from './App.jsx'
import { AuthProvider } from './lib/auth.jsx'
import './index.css'

const qc = new QueryClient({ defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: true } } })
createRoot(document.getElementById('root')).render(
  <QueryClientProvider client={qc}><BrowserRouter><AuthProvider><App /></AuthProvider></BrowserRouter></QueryClientProvider>
)
