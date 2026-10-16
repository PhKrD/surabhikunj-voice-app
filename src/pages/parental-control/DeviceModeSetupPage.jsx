// DeviceModeSetupPage.jsx
// Shown inside the Parental Control module the first time a device has
// not been configured for it yet (deviceModeStore.mode === 'unset').
// This does NOT create a second app — it decides how THIS device will
// behave: as a parent's management console, or as the child's own
// supervised device. See src/store/deviceModeStore.js for the full model.

import { ShieldCheck, Smartphone, UserRound, Baby, ChevronRight } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Card from '@/components/ui/Card'
import { useDeviceModeStore } from '@/store/deviceModeStore'

function Option({ mode, icon: Icon, tone, title, body, onChoose }) {
  return (
    <Card hover as="button" type="button" onClick={() => onChoose(mode)} className="w-full text-left p-5 flex items-center gap-4">
      <span className={`w-14 h-14 rounded-[var(--radius-lg)] flex items-center justify-center shrink-0 ${tone}`}>
        <Icon className="w-7 h-7" aria-hidden="true" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-heading text-primary-token">{title}</span>
        <span className="block text-caption mt-1">{body}</span>
      </span>
      <ChevronRight className="w-5 h-5 text-muted-token shrink-0" aria-hidden="true" />
    </Card>
  )
}

export default function DeviceModeSetupPage() {
  const navigate = useNavigate()
  const setMode = useDeviceModeStore((s) => s.setMode)

  const choose = (mode) => {
    setMode(mode)
    if (mode === 'child') {
      // From this point on, this physical device boots directly into the
      // child pairing/experience — see the root redirect in App.jsx.
      navigate('/child/enroll', { replace: true })
    }
    // 'parent' just re-renders ParentalControlPage with the family list.
  }

  return (
    <div className="max-w-lg mx-auto space-y-6 py-6">
      <div className="text-center space-y-2">
        <div className="w-16 h-16 rounded-[var(--radius-lg)] grad-brand flex items-center justify-center mx-auto shadow-[var(--shadow-2)]">
          <ShieldCheck className="w-8 h-8 text-white" aria-hidden="true" />
        </div>
        <h1 className="text-title text-primary-token pt-2">Whose phone is this?</h1>
        <p className="text-caption max-w-sm mx-auto">
          This only sets up THIS phone. VOICE stays one app either way.
        </p>
      </div>

      <div className="grid gap-3">
        <Option
          mode="parent"
          onChoose={choose}
          icon={UserRound}
          tone="bg-[var(--color-primary-soft)] text-[var(--color-primary)]"
          title="Mine — I’m a parent"
          body="See your children, set limits and routines, lock their phone from here."
        />
        <Option
          mode="child"
          onChoose={choose}
          icon={Baby}
          tone="bg-[var(--color-accent-soft)] text-[var(--color-warning)]"
          title="My child’s phone"
          body="Next you’ll type a pairing code from your phone. After that this phone shows the child’s screen, not the VOICE login."
        />
      </div>

      <p className="flex items-start gap-2 text-xs text-muted-token px-1">
        <Smartphone className="w-3.5 h-3.5 mt-0.5 shrink-0" aria-hidden="true" />
        You can change this later in Settings (it asks you to sign in again).
      </p>
    </div>
  )
}
