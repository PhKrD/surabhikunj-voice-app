import { useState, useEffect, useCallback } from 'react'
import { Plus, Trash2, X, MapPin, Navigation } from 'lucide-react'
import Card, { CardBody } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import useOrgStore from '@/store/orgStore'
import useToastStore from '@/store/toastStore'
import {
  getLatestLocation,
  listRecentLocations,
  listGeofences,
  createGeofence,
  deleteGeofence,
} from '@/lib/parentalControlApi'

const defaultForm = { name: '', latitude: '', longitude: '', radiusMeters: 200 }

function haversineMeters(lat1, lon1, lat2, lon2) {
  const r = 6_371_000
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLon = ((lon2 - lon1) * Math.PI) / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2
  return 2 * r * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

/**
 * Dependency-free map: an OpenStreetMap embed centred on a point, with a
 * marker. Good enough to answer "where is my child right now" at a glance
 * without pulling in a maps SDK; the coordinates link opens Google Maps.
 */
function MapEmbed({ latitude, longitude, zoomDelta = 0.01, height = 220 }) {
  const bbox = [longitude - zoomDelta, latitude - zoomDelta * 0.6, longitude + zoomDelta, latitude + zoomDelta * 0.6].join(',')
  const src = `https://www.openstreetmap.org/export/embed.html?bbox=${encodeURIComponent(bbox)}&layer=mapnik&marker=${latitude},${longitude}`
  return (
    <iframe
      title="Map"
      src={src}
      style={{ width: '100%', height, border: 0 }}
      className="rounded-xl"
      loading="lazy"
      referrerPolicy="no-referrer-when-downgrade"
    />
  )
}

export default function LocationTab({ childId }) {
  const { org } = useOrgStore()
  const toast = useToastStore()

  const [latest, setLatest] = useState(null)
  const [history, setHistory] = useState([])
  const [geofences, setGeofences] = useState([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [saving, setSaving] = useState(false)
  const [formError, setFormError] = useState('')
  const [form, setForm] = useState(defaultForm)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [latestLoc, recent, gfs] = await Promise.all([
        getLatestLocation(childId),
        listRecentLocations(childId, { limit: 15 }),
        listGeofences(childId),
      ])
      setLatest(latestLoc)
      setHistory(recent)
      setGeofences(gfs)
    } catch (error) {
      toast.error('Could not load location data', error.message)
    } finally {
      setLoading(false)
    }
  }, [childId, toast])

  useEffect(() => {
    const id = setTimeout(() => load(), 0)
    return () => clearTimeout(id)
  }, [load])

  const resetForm = () => {
    setForm(defaultForm)
    setFormError('')
  }

  const useMyLocation = () => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition((pos) => {
      setForm((f) => ({
        ...f,
        latitude: pos.coords.latitude.toFixed(6),
        longitude: pos.coords.longitude.toFixed(6),
      }))
    })
  }

  const handleCreate = async () => {
    const lat = Number(form.latitude)
    const lng = Number(form.longitude)
    if (!form.name.trim() || Number.isNaN(lat) || Number.isNaN(lng)) {
      setFormError('Name, latitude and longitude are required.')
      return
    }
    setFormError('')
    setSaving(true)
    try {
      await createGeofence({
        childId,
        orgId: org?.id,
        name: form.name.trim(),
        latitude: lat,
        longitude: lng,
        radiusMeters: Number(form.radiusMeters) || 200,
      })
      resetForm()
      setShowForm(false)
      await load()
      toast.success('Geofence created')
    } catch (error) {
      setFormError(error.message)
      toast.error('Could not create geofence', error.message)
    } finally {
      setSaving(false)
    }
  }

  const handleDeleteGeofence = async (gf) => {
    try {
      await deleteGeofence(gf.id)
      await load()
      toast.success('Geofence removed')
    } catch (error) {
      toast.error('Could not remove geofence', error.message)
    }
  }

  if (loading) return <div className="text-center py-8 text-muted-token text-sm">Loading...</div>

  return (
    <div className="space-y-4">
      {/* Latest location */}
      <Card>
        <CardBody className="py-4">
          <p className="text-sm font-semibold text-primary-token mb-2">Last known location</p>
          {latest ? (
            <div className="space-y-3">
              <MapEmbed latitude={latest.latitude} longitude={latest.longitude} />
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-indigo-50 flex items-center justify-center flex-shrink-0">
                  <MapPin className="w-5 h-5 text-indigo-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <a
                    href={`https://www.google.com/maps?q=${latest.latitude},${latest.longitude}`}
                    target="_blank"
                    rel="noreferrer"
                    className="text-sm font-medium text-indigo-600 hover:underline"
                  >
                    {latest.latitude.toFixed(5)}, {latest.longitude.toFixed(5)}
                  </a>
                  <p className="text-xs text-muted-token">
                    {new Date(latest.recorded_at).toLocaleString()}
                    {latest.accuracy_meters ? ` · ±${Math.round(latest.accuracy_meters)} m` : ''}
                  </p>
                </div>
                {geofences.length > 0 && (() => {
                  const inside = geofences.filter((gf) => haversineMeters(latest.latitude, latest.longitude, gf.latitude, gf.longitude) <= gf.radius_meters)
                  return (
                    <span className={`text-xs font-medium px-2.5 py-1 rounded-full ${inside.length ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>
                      {inside.length ? `At ${inside.map((g) => g.name).join(', ')}` : 'Not at a saved place'}
                    </span>
                  )
                })()}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-token">
              No location reported yet. Location permission must be granted to VOICE on the child device (Settings → Apps → VOICE → Permissions → Location → Allow all the time).
            </p>
          )}
        </CardBody>
      </Card>

      {/* Geofences */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm font-semibold text-primary-token">Places</p>
          <p className="text-xs text-muted-token">Home, school, grandma's… you get an alert when your child arrives or leaves.</p>
        </div>
        <Button
          size="sm"
          icon={showForm ? X : Plus}
          onClick={() => {
            if (showForm) resetForm()
            setShowForm((v) => !v)
          }}
        >
          {showForm ? 'Close' : 'Add zone'}
        </Button>
      </div>

      {showForm && (
        <Card>
          <CardBody className="py-4 space-y-3">
            <label className="block">
              <span className="text-xs text-secondary-token">Name</span>
              <input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Home"
                className="w-full mt-1 px-3 py-2.5 rounded-xl border border-[var(--border-color)] text-sm"
              />
            </label>
            <div className="grid sm:grid-cols-3 gap-3">
              <label className="block">
                <span className="text-xs text-secondary-token">Latitude</span>
                <input
                  value={form.latitude}
                  onChange={(e) => setForm((f) => ({ ...f, latitude: e.target.value }))}
                  placeholder="18.5204"
                  className="w-full mt-1 px-3 py-2.5 rounded-xl border border-[var(--border-color)] text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs text-secondary-token">Longitude</span>
                <input
                  value={form.longitude}
                  onChange={(e) => setForm((f) => ({ ...f, longitude: e.target.value }))}
                  placeholder="73.8567"
                  className="w-full mt-1 px-3 py-2.5 rounded-xl border border-[var(--border-color)] text-sm"
                />
              </label>
              <label className="block">
                <span className="text-xs text-secondary-token">Radius (m)</span>
                <input
                  type="number"
                  min={50}
                  value={form.radiusMeters}
                  onChange={(e) => setForm((f) => ({ ...f, radiusMeters: e.target.value }))}
                  className="w-full mt-1 px-3 py-2.5 rounded-xl border border-[var(--border-color)] text-sm"
                />
              </label>
            </div>
            <button
              type="button"
              onClick={useMyLocation}
              className="flex items-center gap-1.5 text-xs font-medium text-indigo-600"
            >
              <Navigation className="w-3.5 h-3.5" /> Use my current location
            </button>
            {formError && <p className="text-sm text-red-600">{formError}</p>}
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="secondary" size="sm" onClick={() => { resetForm(); setShowForm(false) }}>
                Cancel
              </Button>
              <Button size="sm" loading={saving} onClick={handleCreate}>
                Save
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      <div className="space-y-2">
        {geofences.length === 0 && !showForm && (
          <p className="text-sm text-muted-token text-center py-4">No places yet. Add one and use "Use my current location" while you're there.</p>
        )}
        {geofences.map((gf) => (
          <Card key={gf.id}>
            <CardBody className="py-3.5 flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="font-medium text-primary-token truncate">{gf.name}</p>
                <p className="text-xs text-muted-token">
                  {gf.latitude.toFixed(5)}, {gf.longitude.toFixed(5)} · {gf.radius_meters}m radius
                </p>
              </div>
              <button
                onClick={() => handleDeleteGeofence(gf)}
                className="p-2 rounded-lg text-muted-token hover:text-red-600 hover:bg-red-50"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </CardBody>
          </Card>
        ))}
      </div>

      {/* History */}
      {history.length > 0 && (
        <div>
          <p className="text-sm font-semibold text-primary-token mb-2">Recent history</p>
          <div className="space-y-1.5">
            {history.map((loc) => (
              <div key={loc.id} className="flex items-center justify-between text-xs text-secondary-token px-2">
                <a
                  href={`https://www.google.com/maps?q=${loc.latitude},${loc.longitude}`}
                  target="_blank"
                  rel="noreferrer"
                  className="hover:underline"
                >
                  {loc.latitude.toFixed(4)}, {loc.longitude.toFixed(4)}
                </a>
                <span>{new Date(loc.recorded_at).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
