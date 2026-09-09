/**
 * MemberLinkPicker.jsx
 *
 * Lets a parent optionally link a pc_children profile to a real VOICE org
 * member account (pc_children.linked_profile_id — see
 * supabase/68_child_org_link_and_tamper.sql). When linked, pairing this
 * child's device signs it in AS that member, so Sadhana/cleanliness/etc.
 * work normally on the same device that is under parental-control
 * supervision, instead of the legacy fully-isolated device-only
 * experience. Optional — leave unlinked for a child with no org account.
 *
 * Sources the member list from org_members() (RPC already used by
 * MembersPage.jsx), which any member with the default 'members.view'
 * permission can call — no new elevated permission needed.
 */

import { useState, useEffect } from 'react'
import { UserRound } from 'lucide-react'
import { supabase } from '@/lib/supabase'

export default function MemberLinkPicker({ value, onChange }) {
  const [members, setMembers] = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let alive = true
    supabase.rpc('org_members').then(({ data, error }) => {
      if (!alive) return
      if (!error) {
        setMembers((data ?? []).filter((m) => m.status === 'active'))
      }
      setLoading(false)
    })
    return () => { alive = false }
  }, [])

  return (
    <label className="block">
      <span className="text-xs text-secondary-token flex items-center gap-1.5">
        <UserRound className="w-3.5 h-3.5" />
        Link to an existing VOICE member <span className="text-muted-token font-normal">(optional)</span>
      </span>
      <select
        value={value ?? ''}
        onChange={(e) => {
          const id = e.target.value || null
          onChange(id, members.find((m) => m.id === id) ?? null)
        }}
        disabled={loading}
        className="w-full mt-1 px-3 py-2.5 rounded-xl border border-[var(--border-color)] text-sm"
      >
        <option value="">Not linked — device-only (no org account)</option>
        {members.map((m) => (
          <option key={m.id} value={m.id}>
            {m.display_name ?? m.spiritual_name ?? m.legal_name ?? m.email} {m.email ? `(${m.email})` : ''}
          </option>
        ))}
      </select>
      <span className="block text-xs text-muted-token mt-1">
        When linked, this child's device signs in as that member's own account, so Sadhana,
        cleanliness and other VOICE features work normally alongside parental-control supervision.
      </span>
    </label>
  )
}
