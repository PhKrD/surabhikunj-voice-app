import { useState, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { ArrowLeft, Clock, Smartphone, Globe, Send, CheckCircle, XCircle } from 'lucide-react'
import { createRequest, listMyRequests } from '../../lib/requestApi'

const REQUEST_TYPES = [
  { value: 'bonus_time', label: 'More screen time', icon: Clock, placeholder: 'I need 30 more minutes to finish homework' },
  { value: 'app_unblock', label: 'Unblock an app', icon: Smartphone, placeholder: 'I need to use Instagram for a school project' },
  { value: 'website_access', label: 'Access a website', icon: Globe, placeholder: 'I need to visit YouTube for research' },
]

export default function RequestPage() {
  const navigate = useNavigate()
  const [type, setType] = useState('bonus_time')
  const [reason, setReason] = useState('')
  const [minutes, setMinutes] = useState(30)
  const [sending, setSending] = useState(false)
  const [requests, setRequests] = useState([])

  const loadRequests = useCallback(async () => {
    try {
      setRequests(await listMyRequests())
    } catch (err) {
      console.error('Failed to load requests:', err)
    }
  }, [])

  useEffect(() => {
    // Deferred so the setState happens in a microtask after mount, rather
    // than synchronously inside the effect body (matches the pattern
    // already used by every other data-loading page in this app, e.g.
    // ParentalControlPage.jsx / RulesTab.jsx).
    const id = setTimeout(() => loadRequests(), 0)
    return () => clearTimeout(id)
  }, [loadRequests])

  const handleSubmit = async () => {
    if (!reason.trim()) return
    setSending(true)
    try {
      const metadata = type === 'bonus_time' ? { minutes } : null
      await createRequest({ type, metadata, reason })
      setReason('')
      setMinutes(30)
      await loadRequests()
    } catch (err) {
      console.error('Failed to create request:', err)
    } finally {
      setSending(false)
    }
  }

  const typeConfig = REQUEST_TYPES.find((t) => t.value === type) || REQUEST_TYPES[0]
  const Icon = typeConfig.icon

  return (
    <div className="min-h-screen bg-indigo-50 flex flex-col">
      <div className="bg-indigo-600 text-white px-6 pt-12 pb-6">
        <button onClick={() => navigate('/child/home')} className="flex items-center gap-1.5 text-sm text-indigo-200 mb-4">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <h1 className="text-2xl font-bold">Request</h1>
        <p className="text-indigo-200 text-sm mt-1">Ask for extra time or access</p>
      </div>

      <div className="flex-1 px-6 py-6 space-y-6">
        <div className="bg-white rounded-2xl p-5 shadow-sm space-y-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Icon className="w-4 h-4 text-indigo-500" />
            Request type
          </div>
          <div className="grid grid-cols-1 gap-2">
            {REQUEST_TYPES.map((t) => {
              const TIcon = t.icon
              return (
                <button
                  key={t.value}
                  type="button"
                  onClick={() => setType(t.value)}
                  className={`flex items-center gap-3 p-3 rounded-xl border text-left transition-colors ${
                    type === t.value
                      ? 'border-indigo-500 bg-indigo-50 text-indigo-700'
                      : 'border-slate-200 hover:border-slate-300 text-slate-700'
                  }`}
                >
                  <TIcon className="w-5 h-5" />
                  <span className="font-medium">{t.label}</span>
                </button>
              )
            })}
          </div>

          {type === 'bonus_time' && (
            <div>
              <label className="block text-xs text-slate-500 mb-1.5">Minutes needed</label>
              <input
                type="number"
                min={1}
                max={120}
                value={minutes}
                onChange={(e) => setMinutes(parseInt(e.target.value, 10) || 30)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm"
              />
            </div>
          )}

          <div>
            <label className="block text-xs text-slate-500 mb-1.5">Reason</label>
            <textarea
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder={typeConfig.placeholder}
              rows={3}
              className="w-full px-3 py-2.5 rounded-xl border border-slate-200 text-sm resize-none"
            />
          </div>

          <button
            onClick={handleSubmit}
            disabled={sending || !reason.trim()}
            className="w-full bg-indigo-600 text-white font-semibold rounded-xl py-3 flex items-center justify-center gap-2 hover:bg-indigo-700 disabled:opacity-60"
          >
            <Send className="w-4 h-4" /> {sending ? 'Sending...' : 'Send request'}
          </button>
        </div>

        {requests.length > 0 && (
          <div className="space-y-3">
            <h3 className="text-sm font-semibold text-slate-700">Your requests</h3>
            {requests.map((req) => (
              <div key={req.id} className="bg-white rounded-xl p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium text-slate-800 capitalize">{req.request_type.replace('_', ' ')}</p>
                    <p className="text-sm text-slate-500 mt-0.5">{req.reason}</p>
                    <p className="text-xs text-slate-400 mt-1">{new Date(req.created_at).toLocaleString()}</p>
                  </div>
                  {req.status === 'approved' && <CheckCircle className="w-5 h-5 text-green-500" />}
                  {req.status === 'denied' && <XCircle className="w-5 h-5 text-red-500" />}
                  {req.status === 'pending' && <Clock className="w-5 h-5 text-saffron-500" />}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
