import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}

export function formatTime(timeStr) {
  if (!timeStr) return '--'
  const [h, m] = timeStr.split(':')
  const hour = parseInt(h)
  const ampm = hour >= 12 ? 'PM' : 'AM'
  const displayHour = hour % 12 || 12
  return `${displayHour}:${m} ${ampm}`
}

export function formatDate(dateStr) {
  if (!dateStr) return '--'
  const date = new Date(dateStr)
  return date.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
}

export function minutesToHHMM(minutes) {
  if (!minutes) return '0 min'
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  if (h === 0) return `${m} min`
  if (m === 0) return `${h} hr`
  return `${h}h ${m}m`
}

export function getInitials(name) {
  if (!name) return '?'
  return name
    .split(' ')
    .map((n) => n[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()
}

export function scoreColor(score) {
  if (score >= 80) return 'text-tulasi-600'
  if (score >= 60) return 'text-saffron-500'
  if (score >= 40) return 'text-yellow-500'
  return 'text-red-500'
}

export function scoreBg(score) {
  if (score >= 80) return 'bg-tulasi-100 text-tulasi-800'
  if (score >= 60) return 'bg-saffron-100 text-saffron-800'
  if (score >= 40) return 'bg-yellow-100 text-yellow-800'
  return 'bg-red-100 text-red-800'
}

export const ROLES = {
  devotee: 'Devotee',
  counsellor: 'Counsellor',
  sadhana_incharge: 'Sadhana Incharge',
  dept_incharge: 'Dept. Incharge',
  im: 'IM',
  kitchen_team: 'Kitchen Team',
  vmc: 'VMC',
  oc: 'OC',
  admin: 'Admin',
}

export const ROLE_COLORS = {
  devotee: 'bg-slate-100 text-slate-700',
  counsellor: 'bg-blue-100 text-blue-700',
  sadhana_incharge: 'bg-lotus-100 text-lotus-700',
  dept_incharge: 'bg-saffron-100 text-saffron-700',
  im: 'bg-cyan-100 text-cyan-700',
  kitchen_team: 'bg-orange-100 text-orange-700',
  vmc: 'bg-tulasi-100 text-tulasi-700',
  oc: 'bg-indigo-100 text-indigo-700',
  admin: 'bg-red-100 text-red-700',
}

export const ADMIN_ROLES = ['admin', 'vmc', 'oc']
export const PRIVILEGED_ROLES = ['admin', 'vmc', 'oc', 'counsellor', 'sadhana_incharge']

export function isAdmin(role) {
  return ADMIN_ROLES.includes(role)
}

export function isPrivileged(role) {
  return PRIVILEGED_ROLES.includes(role)
}
