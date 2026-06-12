'use client'

import { useEffect, useState, useTransition } from 'react'
import { Dumbbell, Loader2, Plus, Trash2, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Feature 032 — cadastro do plano de TREINO pela equipe.
 * Autossuficiente: GET/POST em /api/pacientes/[id]/treino.
 * Modelo versionado: salvar cria uma nova versão e desativa a anterior.
 * Aparece no portal do paciente na seção "Treino".
 */

interface ExerciseForm {
  name: string
  sets: string
  reps: string
  loadKg: string
  restSeconds: string
  notes: string
}
interface SessionForm {
  name: string
  focus: string
  exercises: ExerciseForm[]
}
interface WorkoutPlan {
  id: string
  title: string
  notes: string | null
  active: boolean
  createdAt: string
  sessions: Array<{
    name: string
    focus: string | null
    exercises: Array<{
      name: string
      sets: number | null
      reps: string | null
      loadKg: number | null
      restSeconds: number | null
      notes: string | null
    }>
  }>
}

const emptyExercise = (): ExerciseForm => ({ name: '', sets: '', reps: '', loadKg: '', restSeconds: '', notes: '' })
const emptySession = (): SessionForm => ({ name: '', focus: '', exercises: [emptyExercise()] })

function planToForm(p: WorkoutPlan): { title: string; notes: string; sessions: SessionForm[] } {
  return {
    title: p.title,
    notes: p.notes ?? '',
    sessions: p.sessions.map((s) => ({
      name: s.name,
      focus: s.focus ?? '',
      exercises: s.exercises.map((e) => ({
        name: e.name,
        sets: e.sets?.toString() ?? '',
        reps: e.reps ?? '',
        loadKg: e.loadKg?.toString() ?? '',
        restSeconds: e.restSeconds?.toString() ?? '',
        notes: e.notes ?? '',
      })),
    })),
  }
}

const numOrNull = (s: string): number | null => {
  const v = Number(s.replace(',', '.'))
  return s.trim() === '' || !Number.isFinite(v) ? null : v
}
const strOrNull = (s: string): string | null => (s.trim() === '' ? null : s.trim())

export function WorkoutEditor({ patientId, canWrite }: { patientId: string; canWrite: boolean }) {
  const base = `/api/pacientes/${patientId}/treino`
  const [active, setActive] = useState<WorkoutPlan | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const [title, setTitle] = useState('')
  const [notes, setNotes] = useState('')
  const [sessions, setSessions] = useState<SessionForm[]>([emptySession()])

  useEffect(() => {
    let off = false
    void (async () => {
      try {
        const res = await fetch(base)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = (await res.json()) as { active: WorkoutPlan | null }
        if (!off) setActive(data.active)
      } catch {
        if (!off) setError('Não foi possível carregar o treino.')
      } finally {
        if (!off) setLoading(false)
      }
    })()
    return () => {
      off = true
    }
  }, [base])

  function openForm(prefill: boolean) {
    if (prefill && active) {
      const f = planToForm(active)
      setTitle(f.title)
      setNotes(f.notes)
      setSessions(f.sessions.length ? f.sessions : [emptySession()])
    } else {
      setTitle('')
      setNotes('')
      setSessions([emptySession()])
    }
    setError(null)
    setEditing(true)
  }

  function patchSession(si: number, patch: Partial<SessionForm>) {
    setSessions((prev) => prev.map((s, i) => (i === si ? { ...s, ...patch } : s)))
  }
  function patchExercise(si: number, ei: number, patch: Partial<ExerciseForm>) {
    setSessions((prev) =>
      prev.map((s, i) =>
        i === si ? { ...s, exercises: s.exercises.map((e, j) => (j === ei ? { ...e, ...patch } : e)) } : s,
      ),
    )
  }

  function save() {
    const cleanSessions = sessions
      .map((s) => ({
        name: s.name.trim(),
        focus: strOrNull(s.focus),
        exercises: s.exercises
          .filter((e) => e.name.trim() !== '')
          .map((e) => ({
            name: e.name.trim(),
            sets: numOrNull(e.sets),
            reps: strOrNull(e.reps),
            loadKg: numOrNull(e.loadKg),
            restSeconds: numOrNull(e.restSeconds),
            notes: strOrNull(e.notes),
          })),
      }))
      .filter((s) => s.name !== '')

    if (title.trim() === '') {
      setError('Dê um título ao plano.')
      return
    }
    if (cleanSessions.length === 0) {
      setError('Adicione ao menos um treino com nome.')
      return
    }
    setError(null)
    startTransition(async () => {
      try {
        const res = await fetch(base, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: title.trim(), notes: strOrNull(notes), sessions: cleanSessions }),
        })
        if (!res.ok) {
          const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
          throw new Error(b.error?.message ?? `HTTP ${res.status}`)
        }
        // recarrega o plano ativo recém-criado
        const get = await fetch(base)
        if (get.ok) setActive(((await get.json()) as { active: WorkoutPlan | null }).active)
        setEditing(false)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Erro ao salvar.')
      }
    })
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Dumbbell className="h-4 w-4 text-primary" />
          Plano de treino
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-xs text-slate-500">
          Exibido ao paciente no portal (seção “Treino”). Salvar cria uma nova versão e arquiva a anterior.
        </p>

        {loading ? (
          <p className="text-sm text-slate-400">Carregando…</p>
        ) : !editing ? (
          <>
            {active ? <WorkoutReadView plan={active} /> : <p className="text-sm text-slate-500">Nenhum plano de treino ativo.</p>}
            {canWrite ? (
              <Button size="sm" variant={active ? 'outline' : 'default'} onClick={() => openForm(Boolean(active))} className="gap-1.5">
                <Plus className="h-3.5 w-3.5" />
                {active ? 'Novo plano (a partir do atual)' : 'Criar plano de treino'}
              </Button>
            ) : null}
          </>
        ) : (
          <div className="space-y-4">
            <div className="grid gap-3 md:grid-cols-2">
              <div className="space-y-1">
                <Label htmlFor="w_title" className="text-[11px]">Título do plano</Label>
                <Input id="w_title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Ex.: Treino ABC — hipertrofia" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="w_notes" className="text-[11px]">Observações gerais</Label>
                <Input id="w_notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Ex.: 3x por semana, progredir carga" />
              </div>
            </div>

            {sessions.map((s, si) => (
              <div key={si} className="rounded-lg border border-slate-200 bg-slate-50/50 p-3">
                <div className="mb-2 flex items-center gap-2">
                  <Input
                    value={s.name}
                    onChange={(e) => patchSession(si, { name: e.target.value })}
                    placeholder={`Treino ${String.fromCharCode(65 + si)} (ex.: Inferiores)`}
                    className="h-8 font-semibold"
                  />
                  <Input
                    value={s.focus}
                    onChange={(e) => patchSession(si, { focus: e.target.value })}
                    placeholder="Foco (ex.: pernas)"
                    className="h-8 w-40"
                  />
                  {sessions.length > 1 ? (
                    <button type="button" onClick={() => setSessions((p) => p.filter((_, i) => i !== si))} className="text-slate-400 hover:text-destructive">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  ) : null}
                </div>

                <div className="space-y-2">
                  {s.exercises.map((e, ei) => (
                    <div key={ei} className="grid grid-cols-12 items-center gap-1.5">
                      <Input className="col-span-4 h-8" value={e.name} onChange={(ev) => patchExercise(si, ei, { name: ev.target.value })} placeholder="Exercício" />
                      <Input className="col-span-1 h-8" value={e.sets} onChange={(ev) => patchExercise(si, ei, { sets: ev.target.value })} placeholder="séries" inputMode="numeric" />
                      <Input className="col-span-2 h-8" value={e.reps} onChange={(ev) => patchExercise(si, ei, { reps: ev.target.value })} placeholder="reps" />
                      <Input className="col-span-2 h-8" value={e.loadKg} onChange={(ev) => patchExercise(si, ei, { loadKg: ev.target.value })} placeholder="carga kg" inputMode="decimal" />
                      <Input className="col-span-2 h-8" value={e.notes} onChange={(ev) => patchExercise(si, ei, { notes: ev.target.value })} placeholder="obs" />
                      <button type="button" onClick={() => patchSession(si, { exercises: s.exercises.filter((_, j) => j !== ei) })} className="col-span-1 flex justify-center text-slate-400 hover:text-destructive">
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => patchSession(si, { exercises: [...s.exercises, emptyExercise()] })}
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-primary hover:underline"
                  >
                    <Plus className="h-3 w-3" /> exercício
                  </button>
                </div>
              </div>
            ))}

            <button
              type="button"
              onClick={() => setSessions((p) => [...p, emptySession()])}
              className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
            >
              <Plus className="h-3.5 w-3.5" /> adicionar treino (sessão)
            </button>

            <div className="flex items-center justify-between border-t border-slate-100 pt-3">
              {error ? <span className="text-xs text-destructive">{error}</span> : <span />}
              <div className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setEditing(false)} disabled={pending}>Cancelar</Button>
                <Button size="sm" onClick={save} disabled={pending}>
                  {pending ? <Loader2 className="mr-2 h-3 w-3 animate-spin" /> : null}
                  Salvar plano
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function WorkoutReadView({ plan }: { plan: WorkoutPlan }) {
  const [open, setOpen] = useState(true)
  return (
    <div className="rounded-lg border border-slate-100 bg-slate-50/60 p-3">
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex w-full items-center justify-between">
        <span className="text-sm font-semibold text-slate-800">{plan.title}</span>
        <ChevronDown className={`h-4 w-4 text-slate-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {plan.notes ? <p className="mt-1 text-xs text-slate-500">{plan.notes}</p> : null}
      {open ? (
        <div className="mt-3 space-y-3">
          {plan.sessions.map((s, i) => (
            <div key={i}>
              <p className="text-xs font-bold uppercase tracking-wide text-slate-500">
                {s.name}
                {s.focus ? <span className="ml-1 font-normal normal-case text-slate-400">· {s.focus}</span> : null}
              </p>
              <ul className="mt-1 space-y-0.5">
                {s.exercises.map((e, j) => (
                  <li key={j} className="text-sm text-slate-700">
                    {e.name}
                    {(e.sets || e.reps) ? <span className="text-slate-500"> — {e.sets ?? '?'}×{e.reps ?? '?'}</span> : null}
                    {e.loadKg ? <span className="text-slate-500"> · {e.loadKg}kg</span> : null}
                    {e.notes ? <span className="text-slate-400"> ({e.notes})</span> : null}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
