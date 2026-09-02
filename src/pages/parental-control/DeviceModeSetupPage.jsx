// DeviceModeSetupPage.jsx
// Shown inside the Parental Control module the first time a device has
// not been configured for it yet (deviceModeStore.mode === 'unset').
// This does NOT create a second app — it decides how THIS device will
// behave: as a parent's management console, or as the child's own
// supervised device. See src/store/deviceModeStore.js for the full model.

import { ShieldCheck, Smartphone, UserRound, Baby } from 'lucide-react'
import { useNavigate } from 'react-router-dom'
import Card, { CardBody } from '@/components/ui/Card'
import { useDeviceModeStore } from '@/store/deviceModeStore'

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
        <div className="w-14 h-14 rounded-2xl bg-indigo-50 flex items-center justify-center mx-auto">
          <ShieldCheck className="w-7 h-7 text-indigo-600" />
        </div>
        <h2 className="text-lg font-bold text-primary-token">How are you using Parental Control?</h2>
        <p className="text-sm text-secondary-token">
          This only configures THIS device — VOICE stays one app either way.
        </p>
      </div>

      <div className="grid gap-3">
        <Card hover onClick={() => choose('parent')}>
          <CardBody className="py-5 flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-tulasi-50 flex items-center justify-center shrink-0">
              <UserRound className="w-5.5 h-5.5 text-tulasi-600" />
            </div>
            <div>
              <p className="font-semibold text-primary-token">I am a Parent</p>
              <p className="text-xs text-secondary-token mt-0.5">
                Manage children, devices, rules and screen time from this device.
              </p>
            </div>
          </CardBody>
        </Card>

        <Card hover onClick={() => choose('child')}>
          <CardBody className="py-5 flex items-center gap-4">
            <div className="w-11 h-11 rounded-xl bg-saffron-50 flex items-center justify-center shrink-0">
              <Baby className="w-5.5 h-5.5 text-saffron-600" />
            </div>
            <div>
              <p className="font-semibold text-primary-token">This is my child's device</p>
              <p className="text-xs text-secondary-token mt-0.5">
                Set THIS device up to be supervised. It will ask for a pairing code from a
                parent's device next, and will stop showing the regular VOICE login.
              </p>
            </div>
          </CardBody>
        </Card>
      </div>

      <p className="flex items-start gap-2 text-xs text-muted-token px-1">
        <Smartphone className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        You can change this later from Settings, which requires re-authenticating for security.
      </p>
    </div>
  )
}
