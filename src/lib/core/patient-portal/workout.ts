/**
 * Feature 032 — planos de treino (com histórico via versão).
 * Criar um plano desativa o anterior (1 ativo/paciente). Histórico = inativos.
 * RBAC pelo caller. Tabelas novas (0121) → cliente solto (não tipadas ainda).
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'

export interface WorkoutExercise {
  name: string
  sets: number | null
  reps: string | null
  loadKg: number | null
  restSeconds: number | null
  notes: string | null
}
export interface WorkoutSession {
  name: string
  focus: string | null
  exercises: WorkoutExercise[]
}
export interface WorkoutPlan {
  id: string
  title: string
  notes: string | null
  active: boolean
  createdAt: string
  sessions: WorkoutSession[]
}
export interface WorkoutPlanSummary {
  id: string
  title: string
  active: boolean
  createdAt: string
}

function loose(supabase: SupabaseClient<Database>): SupabaseClient {
  return supabase as unknown as SupabaseClient
}

export interface CreateWorkoutPlanArgs {
  tenantId: string
  patientId: string
  title: string
  notes?: string | null
  sessions: WorkoutSession[]
  actorUserId: string
}

export async function createWorkoutPlan(
  supabase: SupabaseClient<Database>,
  args: CreateWorkoutPlanArgs,
): Promise<{ id: string }> {
  const sb = loose(supabase)
  // desativa o plano ativo anterior
  await sb
    .from('workout_plans')
    .update({ active: false })
    .eq('tenant_id', args.tenantId)
    .eq('patient_id', args.patientId)
    .eq('active', true)

  const planRes = await sb
    .from('workout_plans')
    .insert({
      tenant_id: args.tenantId,
      patient_id: args.patientId,
      title: args.title.trim(),
      notes: args.notes?.trim() || null,
      active: true,
      created_by_user_id: args.actorUserId,
    })
    .select('id')
    .single()
  if (planRes.error) throw new Error(`createWorkoutPlan: ${planRes.error.message}`)
  const planId = (planRes.data as { id: string }).id

  for (let s = 0; s < args.sessions.length; s++) {
    const session = args.sessions[s]!
    const sessRes = await sb
      .from('workout_sessions')
      .insert({
        tenant_id: args.tenantId,
        plan_id: planId,
        position: s,
        name: session.name.trim(),
        focus: session.focus?.trim() || null,
      })
      .select('id')
      .single()
    if (sessRes.error) throw new Error(`createWorkoutPlan session: ${sessRes.error.message}`)
    const sessionId = (sessRes.data as { id: string }).id
    if (session.exercises.length > 0) {
      const rows = session.exercises.map((e, i) => ({
        tenant_id: args.tenantId,
        session_id: sessionId,
        position: i,
        name: e.name.trim(),
        sets: e.sets,
        reps: e.reps?.trim() || null,
        load_kg: e.loadKg,
        rest_seconds: e.restSeconds,
        notes: e.notes?.trim() || null,
      }))
      const exRes = await sb.from('workout_exercises').insert(rows)
      if (exRes.error) throw new Error(`createWorkoutPlan exercises: ${exRes.error.message}`)
    }
  }
  return { id: planId }
}

export async function listWorkoutPlanSummaries(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  patientId: string,
): Promise<WorkoutPlanSummary[]> {
  const { data, error } = await loose(supabase)
    .from('workout_plans')
    .select('id, title, active, created_at')
    .eq('tenant_id', tenantId)
    .eq('patient_id', patientId)
    .order('created_at', { ascending: false })
  if (error) throw new Error(`listWorkoutPlanSummaries: ${error.message}`)
  return ((data ?? []) as Array<{ id: string; title: string; active: boolean; created_at: string }>).map((r) => ({
    id: r.id,
    title: r.title,
    active: r.active,
    createdAt: r.created_at,
  }))
}

async function hydratePlan(supabase: SupabaseClient<Database>, planRow: { id: string; title: string; notes: string | null; active: boolean; created_at: string }): Promise<WorkoutPlan> {
  const sb = loose(supabase)
  const sessRes = await sb
    .from('workout_sessions')
    .select('id, name, focus, position')
    .eq('plan_id', planRow.id)
    .order('position', { ascending: true })
  const sessions = (sessRes.data ?? []) as Array<{ id: string; name: string; focus: string | null }>
  const out: WorkoutSession[] = []
  for (const s of sessions) {
    const exRes = await sb
      .from('workout_exercises')
      .select('name, sets, reps, load_kg, rest_seconds, notes, position')
      .eq('session_id', s.id)
      .order('position', { ascending: true })
    const exercises = ((exRes.data ?? []) as Array<{ name: string; sets: number | null; reps: string | null; load_kg: number | null; rest_seconds: number | null; notes: string | null }>).map((e) => ({
      name: e.name,
      sets: e.sets,
      reps: e.reps,
      loadKg: e.load_kg,
      restSeconds: e.rest_seconds,
      notes: e.notes,
    }))
    out.push({ name: s.name, focus: s.focus, exercises })
  }
  return { id: planRow.id, title: planRow.title, notes: planRow.notes, active: planRow.active, createdAt: planRow.created_at, sessions: out }
}

export async function getActiveWorkoutPlan(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  patientId: string,
): Promise<WorkoutPlan | null> {
  const { data } = await loose(supabase)
    .from('workout_plans')
    .select('id, title, notes, active, created_at')
    .eq('tenant_id', tenantId)
    .eq('patient_id', patientId)
    .eq('active', true)
    .maybeSingle()
  if (!data) return null
  return hydratePlan(supabase, data as { id: string; title: string; notes: string | null; active: boolean; created_at: string })
}

export async function getWorkoutPlan(
  supabase: SupabaseClient<Database>,
  tenantId: string,
  planId: string,
): Promise<WorkoutPlan | null> {
  const { data } = await loose(supabase)
    .from('workout_plans')
    .select('id, title, notes, active, created_at')
    .eq('tenant_id', tenantId)
    .eq('id', planId)
    .maybeSingle()
  if (!data) return null
  return hydratePlan(supabase, data as { id: string; title: string; notes: string | null; active: boolean; created_at: string })
}
