import { useState, useEffect } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { format, startOfWeek, addDays, isSameDay } from 'date-fns'
import { supabase } from '@/lib/supabase'
import useAuthStore from '@/store/authStore'
import Card, { CardBody } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { cn } from '@/lib/utils'

const MEAL_TYPES = ['breakfast', 'lunch', 'dinner']
const MEAL_LABELS = { breakfast: '🌅 Breakfast', lunch: '🌞 Lunch', dinner: '🌙 Dinner', prasad_special: '🪔 Special' }
const MEAL_COLORS = {
  breakfast: 'border-l-saffron-400',
  lunch: 'border-l-tulasi-500',
  dinner: 'border-l-lotus-500',
}

export default function KitchenPage() {
  const { profile } = useAuthStore()
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), { weekStartsOn: 1 }))
  const [plans, setPlans] = useState([])
  const [loading, setLoading] = useState(true)

  const weekDays = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const weekFrom = format(weekStart, 'yyyy-MM-dd')
  const weekTo = format(addDays(weekStart, 6), 'yyyy-MM-dd')

  useEffect(() => {
    if (!profile) return
    const load = async () => {
      setLoading(true)
      const { data } = await supabase
        .from('meal_plans')
        .select('*')
        .eq('voice_id', profile.voice_id)
        .gte('plan_date', weekFrom)
        .lte('plan_date', weekTo)
        .order('plan_date')
        .order('meal_type')
      setPlans(data ?? [])
      setLoading(false)
    }
    load()
  }, [profile, weekFrom, weekTo])

  const getMeals = (date, type) => {
    const d = format(date, 'yyyy-MM-dd')
    return plans.find((p) => p.plan_date === d && p.meal_type === type)
  }

  const today = new Date()

  return (
    <div className="max-w-5xl mx-auto space-y-5">
      {/* Week navigator */}
      <div className="flex items-center justify-between">
        <Button
          size="sm"
          variant="secondary"
          icon={ChevronLeft}
          onClick={() => setWeekStart((w) => addDays(w, -7))}
        >
          Prev Week
        </Button>
        <div className="text-center">
          <p className="font-semibold text-slate-800 text-sm">
            {format(weekStart, 'dd MMM')} — {format(addDays(weekStart, 6), 'dd MMM yyyy')}
          </p>
          <button
            onClick={() => setWeekStart(startOfWeek(new Date(), { weekStartsOn: 1 }))}
            className="text-xs text-saffron-600 hover:text-saffron-700"
          >
            This week
          </button>
        </div>
        <Button
          size="sm"
          variant="secondary"
          onClick={() => setWeekStart((w) => addDays(w, 7))}
        >
          Next Week
          <ChevronRight className="w-4 h-4" />
        </Button>
      </div>

      {loading ? (
        <div className="text-center py-12 text-slate-400 text-sm">Loading meal plans...</div>
      ) : (
        /* Weekly grid */
        <div className="overflow-x-auto">
          <div className="min-w-[700px] grid grid-cols-7 gap-2">
            {weekDays.map((day) => {
              const isToday = isSameDay(day, today)
              return (
                <div key={day.toISOString()}>
                  <div className={cn(
                    'text-center py-2 rounded-xl mb-2 text-xs font-semibold',
                    isToday ? 'bg-saffron-500 text-white' : 'bg-slate-100 text-slate-600'
                  )}>
                    <div>{format(day, 'EEE')}</div>
                    <div className="text-base font-bold">{format(day, 'd')}</div>
                  </div>
                  <div className="space-y-1.5">
                    {MEAL_TYPES.map((type) => {
                      const meal = getMeals(day, type)
                      return (
                        <div
                          key={type}
                          className={cn(
                            'min-h-14 rounded-xl border-l-4 bg-white border border-slate-100 p-2',
                            MEAL_COLORS[type]
                          )}
                        >
                          <p className="text-xs font-semibold text-slate-500 mb-1">
                            {type.charAt(0).toUpperCase() + type.slice(1)}
                          </p>
                          {meal?.menu_items?.length > 0 ? (
                            <div className="space-y-0.5">
                              {meal.menu_items.map((item, i) => (
                                <p key={i} className="text-xs text-slate-700 leading-tight">• {item}</p>
                              ))}
                              {meal.is_special && (
                                <Badge variant="saffron" className="mt-1 text-xs">Special</Badge>
                              )}
                            </div>
                          ) : (
                            <p className="text-xs text-slate-300 italic">Not planned</p>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      )}

      {/* Today's detailed view */}
      <div>
        <h3 className="text-base font-semibold text-slate-700 mb-3">Today's Menu</h3>
        <div className="grid sm:grid-cols-3 gap-3">
          {MEAL_TYPES.map((type) => {
            const meal = getMeals(today, type)
            return (
              <Card key={type} className={cn('border-l-4', MEAL_COLORS[type])}>
                <CardBody className="py-4">
                  <p className="font-semibold text-slate-700 mb-2">{MEAL_LABELS[type]}</p>
                  {meal?.menu_items?.length > 0 ? (
                    <ul className="space-y-1">
                      {meal.menu_items.map((item, i) => (
                        <li key={i} className="text-sm text-slate-600">• {item}</li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-slate-400 italic">Menu not planned yet</p>
                  )}
                  {meal?.notes && (
                    <p className="text-xs text-saffron-600 mt-2 font-medium">{meal.notes}</p>
                  )}
                </CardBody>
              </Card>
            )
          })}
        </div>
      </div>
    </div>
  )
}
