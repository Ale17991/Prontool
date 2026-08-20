import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import { DomainError, NotFoundError } from '@/lib/observability/errors'
import { normalizeFoodNutrients, FoodInputError } from './atwater'
import { MICRONUTRIENT_KEYS } from '../micronutrients'

/** Mantém só chaves conhecidas do catálogo, valores numéricos ≥ 0. */
function sanitizeMicros(
  micros: Record<string, number> | null | undefined,
): Record<string, number> | null {
  if (!micros) return null
  const out: Record<string, number> = {}
  for (const k of MICRONUTRIENT_KEYS) {
    const v = micros[k]
    if (typeof v === 'number' && Number.isFinite(v) && v >= 0) out[k] = v
  }
  return Object.keys(out).length ? out : null
}

/**
 * Feature 047 — cadastro de alimentos próprios da clínica (US1).
 *
 * Alimento próprio = linha em `foods` com `tenant_id` setado e `source:'custom'`.
 * O caller garante RBAC (admin/profissional_saude) e passa o `tenantId` da
 * sessão. Editar/desativar a base GLOBAL é impossível (RLS + trigger da 0176) —
 * aqui só se mexe no que é da clínica. Desativar é lógico (planos prescritos
 * que usam o alimento preservam o valor congelado; FR-017).
 */

export interface CustomFoodMeasureInput {
  label: string
  grams: number
  isDefault?: boolean
}

export interface CreateCustomFoodInput {
  tenantId: string
  actorUserId: string
  name: string
  groupSlug?: string | null
  referenceGrams: number
  energyKcal?: number | null
  proteinG: number
  carbG: number
  fatG: number
  fiberG?: number | null
  /** Micronutrientes por porção de referência (opcionais). */
  micronutrients?: Record<string, number> | null
  measures?: CustomFoodMeasureInput[]
}

export interface CustomFoodResult {
  id: string
  energyKcal: number
}

function run<T>(fn: () => T): T {
  try {
    return fn()
  } catch (err) {
    if (err instanceof FoodInputError) throw new DomainError(err.code, err.message, { status: 422 })
    throw err
  }
}

async function resolveGroupId(
  supabase: SupabaseClient<Database>,
  slug: string | null | undefined,
): Promise<string | null> {
  if (!slug) return null
  const { data } = await supabase.from('food_groups').select('id').eq('slug', slug).maybeSingle()
  return (data as { id: string } | null)?.id ?? null
}

export async function createCustomFood(
  supabase: SupabaseClient<Database>,
  input: CreateCustomFoodInput,
): Promise<CustomFoodResult> {
  const name = input.name.trim()
  if (name.length < 1 || name.length > 200) {
    throw new DomainError('INVALID_FOOD', 'O nome do alimento deve ter entre 1 e 200 caracteres.', {
      status: 422,
    })
  }
  const nutrients = run(() =>
    normalizeFoodNutrients({
      referenceGrams: input.referenceGrams,
      energyKcal: input.energyKcal ?? null,
      proteinG: input.proteinG,
      carbG: input.carbG,
      fatG: input.fatG,
      fiberG: input.fiberG ?? null,
    }),
  )
  const groupId = await resolveGroupId(supabase, input.groupSlug)

  const { data, error } = await supabase
    .from('foods')
    .insert({
      tenant_id: input.tenantId,
      source: 'custom',
      name,
      group_id: groupId,
      reference_grams: nutrients.referenceGrams,
      energy_kcal: nutrients.energyKcal,
      protein_g: nutrients.proteinG,
      carb_g: nutrients.carbG,
      fat_g: nutrients.fatG,
      fiber_g: nutrients.fiberG,
      micronutrients: sanitizeMicros(input.micronutrients),
      created_by_user_id: input.actorUserId,
    } as never)
    .select('id')
    .single()
  if (error || !data) throw new Error(`createCustomFood failed: ${error?.message}`)
  const id = (data as { id: string }).id

  const measures = (input.measures ?? []).filter((m) => m.label.trim() && m.grams > 0)
  if (measures.length > 0) {
    const { error: mErr } = await supabase.from('food_household_measures').insert(
      measures.map((m) => ({
        food_id: id,
        tenant_id: input.tenantId,
        label: m.label.trim(),
        grams: m.grams,
        is_default: m.isDefault ?? false,
      })) as never,
    )
    if (mErr) throw new Error(`createCustomFood measures failed: ${mErr.message}`)
  }

  return { id, energyKcal: nutrients.energyKcal }
}

export interface UpdateCustomFoodInput extends Partial<
  Omit<CreateCustomFoodInput, 'tenantId' | 'actorUserId'>
> {
  tenantId: string
  foodId: string
}

/** Edita um alimento PRÓPRIO. Recusa alimento global ou de outra clínica. */
export async function updateCustomFood(
  supabase: SupabaseClient<Database>,
  input: UpdateCustomFoodInput,
): Promise<void> {
  const existing = await supabase
    .from('foods')
    .select('tenant_id, reference_grams, energy_kcal, protein_g, carb_g, fat_g, fiber_g')
    .eq('id', input.foodId)
    .maybeSingle()
  if (existing.error) throw new Error(`updateCustomFood lookup failed: ${existing.error.message}`)
  const row = existing.data as {
    tenant_id: string | null
    reference_grams: number
    energy_kcal: number
    protein_g: number
    carb_g: number
    fat_g: number
    fiber_g: number | null
  } | null
  if (!row) throw new NotFoundError('food', input.foodId)
  if (row.tenant_id !== input.tenantId) {
    // Global (NULL) ou de outra clínica — indistinguível de inexistente.
    throw new DomainError('FOOD_NOT_EDITABLE', 'Alimento não editável.', { status: 403 })
  }

  const nutrients = run(() =>
    normalizeFoodNutrients({
      referenceGrams: input.referenceGrams ?? Number(row.reference_grams),
      energyKcal: input.energyKcal ?? null,
      proteinG: input.proteinG ?? Number(row.protein_g),
      carbG: input.carbG ?? Number(row.carb_g),
      fatG: input.fatG ?? Number(row.fat_g),
      fiberG: input.fiberG ?? (row.fiber_g === null ? null : Number(row.fiber_g)),
    }),
  )
  const patch: Record<string, unknown> = {
    reference_grams: nutrients.referenceGrams,
    energy_kcal: nutrients.energyKcal,
    protein_g: nutrients.proteinG,
    carb_g: nutrients.carbG,
    fat_g: nutrients.fatG,
    fiber_g: nutrients.fiberG,
    updated_at: new Date().toISOString(),
  }
  if (input.name !== undefined) patch.name = input.name.trim()
  if (input.groupSlug !== undefined)
    patch.group_id = await resolveGroupId(supabase, input.groupSlug)

  const { error } = await supabase
    .from('foods')
    .update(patch as never)
    .eq('id', input.foodId)
    .eq('tenant_id', input.tenantId)
  if (error) throw new Error(`updateCustomFood failed: ${error.message}`)
}

/** Desativação lógica (nunca remoção física — planos prescritos preservam valor). */
export async function deactivateCustomFood(
  supabase: SupabaseClient<Database>,
  args: { tenantId: string; foodId: string },
): Promise<void> {
  const { data, error } = await supabase
    .from('foods')
    .update({ active: false, updated_at: new Date().toISOString() } as never)
    .eq('id', args.foodId)
    .eq('tenant_id', args.tenantId)
    .select('id')
  if (error) throw new Error(`deactivateCustomFood failed: ${error.message}`)
  if (!data || (data as unknown[]).length === 0) {
    throw new DomainError('FOOD_NOT_EDITABLE', 'Alimento não encontrado ou não editável.', {
      status: 404,
    })
  }
}
