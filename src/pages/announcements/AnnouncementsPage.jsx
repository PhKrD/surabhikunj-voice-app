import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { Megaphone, Plus, Trash2, X, Send } from 'lucide-react'
import { supabase } from '@/lib/supabase'
import useAuthStore from '@/store/authStore'
import useToastStore from '@/store/toastStore'
import Card, { CardHeader, CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import Avatar from '@/components/ui/Avatar'
import { formatDate, isAdmin } from '@/lib/utils'

const POST_ROLES = ['admin', 'vmc', 'oc', 'im', 'dept_incharge', 'sadhana_incharge', 'counsellor']
const inputCls =
  'w-full px-3 py-2 rounded-xl border border-slate-200 text-sm text-slate-800 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-saffron-300 focus:border-transparent transition'

export default function AnnouncementsPage() {
  const { profile } = useAuthStore()
  const toast = useToastStore()
  const canPost = POST_ROLES.includes(profile?.role)

  const [items, setItems] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [pinned, setPinned] = useState(false)
  const [saving, setSaving] = useState(false)
  const [deletingId, setDeletingId] = useState(null)

  const load = useCallback(async () => {
    if (!profile) return
    setLoading(true)
    const { data } = await supabase
      .from('announcements')
      .select('id, title, body, is_pinned, created_at, created_by, author:created_by(spiritual_name, avatar_url)')
      .eq('voice_id', profile.voice_id)
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(50)
    setItems(data ?? [])
    setLoading(false)
  }, [profile])

  useEffect(() => {
    const t = setTimeout(() => { load() }, 0)
    return () => clearTimeout(t)
  }, [load])

  const submit = async () => {
    if (!title.trim()) {
      toast.error('Title is required')
      return
    }
    setSaving(true)
    try {
      const { error } = await supabase.from('announcements').insert({
        voice_id: profile.voice_id,
        title: title.trim(),
        body: body.trim() || null,
        is_pinned: pinned,
        created_by: profile.id,
      })
      if (error) throw error
      setTitle('')
      setBody('')
      setPinned(false)
      setShowForm(false)
      toast.success('Announcement posted')
      load()
    } catch (e) {
      toast.error('Could not post announcement', e.message)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (id) => {
    setDeletingId(id)
    try {
      const { error } = await supabase.from('announcements').delete().eq('id', id)
      if (error) throw error
      setItems((prev) => prev.filter((x) => x.id !== id))
      toast.success('Announcement deleted')
    } catch (e) {
      toast.error('Could not delete', e.message)
    } finally {
      setDeletingId(null)
    }
  }

  const canManage = (item) => isAdmin(profile?.role) || item.created_by === profile?.id

  return (
    <div className="max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Megaphone className="w-5 h-5 text-saffron-500" />
          <h2 className="text-lg font-bold text-slate-800">Announcements</h2>
        </div>
        {canPost && !showForm && (
          <Button size="sm" icon={Plus} onClick={() => setShowForm(true)}>New</Button>
        )}
      </div>

      {canPost && showForm && (
        <Card>
          <CardHeader><h3 className="font-semibold text-slate-700">New Announcement</h3></CardHeader>
          <CardBody className="space-y-3">
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Title"
              className={inputCls}
            />
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="Write the announcement..."
              rows={3}
              className={`${inputCls} resize-none`}
            />
            <button
              type="button"
              onClick={() => setPinned((v) => !v)}
              className={`flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium border transition ${
                pinned ? 'bg-saffron-50 border-saffron-200 text-saffron-700' : 'bg-slate-50 border-slate-200 text-slate-500'
              }`}
            >
              <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center ${pinned ? 'border-saffron-500 bg-saffron-500' : 'border-slate-300'}`}>
                {pinned && <div className="w-1.5 h-1.5 rounded-full bg-white" />}
              </div>
              Pin to top
            </button>
            <div className="flex gap-2 pt-1">
              <Button onClick={submit} loading={saving} icon={Send}>Post</Button>
              <Button variant="secondary" icon={X} onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </CardBody>
        </Card>
      )}

      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Loading announcements...</div>
      ) : items.length === 0 ? (
        <Card>
          <CardBody>
            <div className="flex flex-col items-center py-10 text-slate-400">
              <Megaphone className="w-12 h-12 mb-3 opacity-30" />
              <p className="text-sm">No announcements yet.</p>
            </div>
          </CardBody>
        </Card>
      ) : (
        <div className="space-y-3">
          {items.map((item) => (
            <motion.div key={item.id} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}>
              <Card className={item.is_pinned ? 'border-saffron-200' : ''}>
                <CardBody className="py-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-semibold text-slate-800">{item.title}</p>
                        {item.is_pinned && <Badge variant="saffron">Pinned</Badge>}
                      </div>
                      {item.body && <p className="text-sm text-slate-600 mt-1 whitespace-pre-wrap">{item.body}</p>}
                      <div className="flex items-center gap-2 mt-2 text-xs text-slate-400">
                        {item.author && <Avatar name={item.author.spiritual_name} url={item.author.avatar_url} size="sm" />}
                        <span>{item.author?.spiritual_name ?? 'Unknown'}</span>
                        <span>·</span>
                        <span>{formatDate(item.created_at)}</span>
                      </div>
                    </div>
                    {canManage(item) && (
                      <button
                        onClick={() => remove(item.id)}
                        disabled={deletingId === item.id}
                        className="p-2 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600 transition flex-shrink-0"
                        title="Delete"
                      >
                        <Trash2 className="w-4 h-4" />
                      </button>
                    )}
                  </div>
                </CardBody>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  )
}
