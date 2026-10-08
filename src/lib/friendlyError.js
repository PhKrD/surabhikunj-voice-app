// Turns backend/network errors into sentences a normal user can act on.
// Technical detail still goes to the console/error reporter; the user never
// sees "JWT expired" or "violates row-level security policy".

const RULES = [
  [/failed to fetch|networkerror|network request failed|load failed|fetch timeout|timed? ?out/i,
    'Can’t reach the server. Check your internet connection and try again.'],
  [/invalid login credentials/i, 'That email and password don’t match. Please try again.'],
  [/email not confirmed/i, 'Please confirm your email first — check your inbox for the link.'],
  [/user already registered|already been registered/i, 'An account with this email already exists. Try signing in.'],
  [/password should be at least|weak password/i, 'Please choose a stronger password (at least 8 characters).'],
  [/rate limit|too many requests|429/i, 'Too many attempts. Please wait a minute and try again.'],
  [/jwt expired|invalid jwt|refresh token|session (not found|missing|expired)/i, 'Your session has expired. Please sign in again.'],
  [/row-level security|permission denied|not authorized|42501/i, 'You don’t have permission to do that.'],
  [/duplicate key|already exists|23505/i, 'This already exists.'],
  [/violates foreign key|23503/i, 'This is still in use elsewhere, so it can’t be changed.'],
  [/violates not-null|null value in column|23502/i, 'Please fill in all required fields.'],
]

export function friendlyError(error, fallback = 'Something went wrong. Please try again.') {
  if (!navigator.onLine) return 'You’re offline. Reconnect and try again.'
  const message = typeof error === 'string' ? error : (error?.message ?? error?.error_description ?? '')
  const code = error?.code ?? ''
  for (const [pattern, text] of RULES) {
    if (pattern.test(message) || pattern.test(code)) return text
  }
  return fallback
}
