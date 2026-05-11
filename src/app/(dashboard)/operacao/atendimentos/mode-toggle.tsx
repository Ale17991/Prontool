'use client'

import { useRouter, useSearchParams } from 'next/navigation'
import { CalendarDays, List } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Toggle entre modo Lista e Calendário.
 *
 * URL: `?mode=list` ou `?mode=cal` (default = cal). Antes era `?view=...`
 * que conflitava com o hook useCalendarFilters (view=dia|semana|mes).
 *
 * Cookie `prontool_atendimentos_view` (legado) ainda é gravado pra manter
 * preferência por dispositivo entre recargas sem querystring.
 */
export function ModeToggle({ mode }: { mode: 'list' | 'cal' }) {
  const router = useRouter()
  const search = useSearchParams()

  function setMode(next: 'list' | 'cal') {
    if (typeof document !== 'undefined') {
      if (next === 'list') {
        document.cookie = 'prontool_atendimentos_view=list; path=/; max-age=31536000; samesite=lax'
      } else {
        document.cookie = 'prontool_atendimentos_view=; path=/; max-age=0; samesite=lax'
      }
    }
    const params = new URLSearchParams(search?.toString() ?? '')
    if (next === 'cal') params.delete('mode')
    else params.set('mode', 'list')
    const qs = params.toString()
    router.push(qs ? `?${qs}` : '?')
  }

  return (
    <div className="inline-flex rounded-md border border-slate-200 bg-white p-0.5 text-xs">
      <button
        type="button"
        onClick={() => setMode('list')}
        className={cn(
          'flex items-center gap-1.5 rounded-sm px-3 py-1.5 font-bold transition-colors',
          mode === 'list' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100',
        )}
      >
        <List className="h-3.5 w-3.5" />
        Lista
      </button>
      <button
        type="button"
        onClick={() => setMode('cal')}
        className={cn(
          'flex items-center gap-1.5 rounded-sm px-3 py-1.5 font-bold transition-colors',
          mode === 'cal' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:bg-slate-100',
        )}
      >
        <CalendarDays className="h-3.5 w-3.5" />
        Calendário
      </button>
    </div>
  )
}
