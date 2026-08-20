import type { SupabaseClient } from '@supabase/supabase-js'
import type { Database } from '@/lib/db/types'
import type { FoodRef } from '../diet/totals'
import { composeLabel, type LabelIngredient, type LabelResult } from './compose'
import { NORMATIVE_VERSION, type LabelBasis } from './reference'

/**
 * Feature 052 — persistência do rótulo nutricional.
 *
 * O rótulo não pertence a paciente nenhum: é o produto de um cliente da
 * clínica, então tudo aqui é escopado só por `tenantId`.
 *
 * A tabela calculada NUNCA é gravada — só os insumos (ingredientes, rendimento,
 * porção e as sobrescritas manuais). O `LabelResult` é recomposto a cada
 * leitura, para que uma correção na base de alimentos ou na norma se reflita no
 * rótulo em vez de ficar congelada num número velho. Isto é o oposto da
 * prescrição da 047, que congela snapshot de propósito: lá o documento foi
 * entregue ao paciente, aqui é rascunho de trabalho até virar embalagem.
 */

function loose(sb: SupabaseClient<Database>): SupabaseClient {
  return sb as unknown as SupabaseClient
}

export interface LabelIngredientInput {
  foodId: string
  grams: number
  position?: number
}

export interface LabelFields {
  productName: string
  clientName?: string | null
  basis: LabelBasis
  totalYield: number
  portionSize: number
  householdMeasure?: string | null
  portionsPerPackage?: number | null
  ingredientsText?: string | null
  allergensText?: string | null
  storageText?: string | null
}

export interface CreateLabelArgs extends LabelFields {
  tenantId: string
  actorUserId: string
  ingredients: LabelIngredientInput[]
}

export interface UpdateLabelArgs extends Partial<LabelFields> {
  tenantId: string
  labelId: string
  actorUserId: string
  ingredients?: LabelIngredientInput[]
  /** Mapa parcial: número define a sobrescrita, `null` remove. */
  manualValues?: Record<string, number | null>
}

export interface LabelIngredientView {
  foodId: string
  name: string
  grams: number
  /**
   * Nutrientes do alimento por porção de referência. Vão junto porque a tela
   * recompõe a tabela ao vivo com a mesma função do servidor — sem isso, reabrir
   * um rótulo exigiria uma busca por ingrediente só para redescobrir o que a
   * consulta já tinha em mãos.
   */
  food: FoodRef
}

export interface LabelView {
  id: string
  productName: string
  clientName: string | null
  basis: LabelBasis
  totalYield: number
  portionSize: number
  householdMeasure: string | null
  portionsPerPackage: number | null
  ingredientsText: string | null
  allergensText: string | null
  storageText: string | null
  manualValues: Record<string, number>
  normativeVersion: string
  updatedAt: string
  ingredients: LabelIngredientView[]
}

export interface LabelSummary {
  id: string
  productName: string
  clientName: string | null
  basis: LabelBasis
  incomplete: boolean
  updatedAt: string
}

interface LabelRow {
  id: string
  product_name: string
  client_name: string | null
  basis: LabelBasis
  total_yield: number | string
  portion_size: number | string
  household_measure: string | null
  portions_per_package: number | string | null
  ingredients_text: string | null
  allergens_text: string | null
  storage_text: string | null
  manual_values: Record<string, number> | null
  normative_version: string
  updated_at: string
}

const LABEL_COLUMNS =
  'id, product_name, client_name, basis, total_yield, portion_size, household_measure, ' +
  'portions_per_package, ingredients_text, allergens_text, storage_text, manual_values, ' +
  'normative_version, updated_at'

function num(v: number | string): number {
  return typeof v === 'number' ? v : Number(v)
}

function toView(row: LabelRow, ingredients: LabelIngredientView[]): LabelView {
  return {
    id: row.id,
    productName: row.product_name,
    clientName: row.client_name,
    basis: row.basis,
    totalYield: num(row.total_yield),
    portionSize: num(row.portion_size),
    householdMeasure: row.household_measure,
    portionsPerPackage: row.portions_per_package === null ? null : num(row.portions_per_package),
    ingredientsText: row.ingredients_text,
    allergensText: row.allergens_text,
    storageText: row.storage_text,
    manualValues: row.manual_values ?? {},
    normativeVersion: row.normative_version,
    updatedAt: row.updated_at,
    ingredients,
  }
}

/** Colunas do rótulo a partir dos campos de entrada — só o que veio definido. */
function fieldsToColumns(f: Partial<LabelFields>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (f.productName !== undefined) out.product_name = f.productName.trim()
  if (f.clientName !== undefined) out.client_name = f.clientName?.trim() || null
  if (f.basis !== undefined) out.basis = f.basis
  if (f.totalYield !== undefined) out.total_yield = f.totalYield
  if (f.portionSize !== undefined) out.portion_size = f.portionSize
  if (f.householdMeasure !== undefined) out.household_measure = f.householdMeasure?.trim() || null
  if (f.portionsPerPackage !== undefined) out.portions_per_package = f.portionsPerPackage ?? null
  if (f.ingredientsText !== undefined) out.ingredients_text = f.ingredientsText?.trim() || null
  if (f.allergensText !== undefined) out.allergens_text = f.allergensText?.trim() || null
  if (f.storageText !== undefined) out.storage_text = f.storageText?.trim() || null
  return out
}

async function replaceIngredients(
  sb: SupabaseClient<Database>,
  tenantId: string,
  labelId: string,
  ingredients: LabelIngredientInput[],
): Promise<void> {
  const c = loose(sb)
  await c
    .from('nutrition_label_ingredients')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('label_id', labelId)
  if (ingredients.length === 0) return
  const rows = ingredients.map((ing, i) => ({
    label_id: labelId,
    tenant_id: tenantId,
    food_id: ing.foodId,
    grams: ing.grams,
    position: ing.position ?? i,
  }))
  const ins = await c.from('nutrition_label_ingredients').insert(rows)
  if (ins.error) throw new Error(`label ingredients: ${ins.error.message}`)
}

async function audit(
  sb: SupabaseClient<Database>,
  args: {
    tenantId: string
    labelId: string
    field: string
    from: string | null
    to: string | null
    reason: string
  },
): Promise<void> {
  await sb.rpc(
    'log_audit_event' as never,
    {
      p_tenant_id: args.tenantId,
      p_entity: 'nutrition_labels',
      p_entity_id: args.labelId,
      p_field: args.field,
      p_old: args.from,
      p_new: args.to,
      p_reason: args.reason,
    } as never,
  )
}

export async function createLabel(
  sb: SupabaseClient<Database>,
  args: CreateLabelArgs,
): Promise<{ id: string }> {
  const c = loose(sb)
  const created = await c
    .from('nutrition_labels')
    .insert({
      tenant_id: args.tenantId,
      ...fieldsToColumns(args),
      // Gravada na criação (FR-021): quando a norma mudar, o rótulo antigo
      // continua explicável por qual referência ele foi calculado.
      normative_version: NORMATIVE_VERSION,
      created_by_user_id: args.actorUserId,
    })
    .select('id')
    .single()
  if (created.error) throw new Error(`createLabel: ${created.error.message}`)
  const id = (created.data as { id: string }).id

  await replaceIngredients(sb, args.tenantId, id, args.ingredients)
  await audit(sb, {
    tenantId: args.tenantId,
    labelId: id,
    field: 'created',
    from: null,
    to: args.productName,
    reason: `rótulo nutricional criado (${NORMATIVE_VERSION})`,
  })
  return { id }
}

/**
 * Carrega o rótulo com os nutrientes dos alimentos já resolvidos, prontos para
 * o motor — quem chama recebe view e resultado de uma vez só.
 */
export async function getLabel(
  sb: SupabaseClient<Database>,
  tenantId: string,
  labelId: string,
): Promise<{ label: LabelView; result: LabelResult } | null> {
  const c = loose(sb)
  const head = await c
    .from('nutrition_labels')
    .select(LABEL_COLUMNS)
    .eq('tenant_id', tenantId)
    .eq('id', labelId)
    .maybeSingle()
  const row = head.data as LabelRow | null
  if (!row) return null

  const { views, refs } = await loadIngredients(sb, labelId)
  const label = toView(row, views)
  const result = composeLabel({
    ingredients: refs,
    totalYield: label.totalYield,
    portionSize: label.portionSize,
    basis: label.basis,
    manualValues: label.manualValues,
  })
  return { label, result }
}

async function loadIngredients(
  sb: SupabaseClient<Database>,
  labelId: string,
): Promise<{ views: LabelIngredientView[]; refs: LabelIngredient[] }> {
  const byLabel = await loadIngredientsForLabels(sb, [labelId])
  return byLabel.get(labelId) ?? { views: [], refs: [] }
}

/**
 * Carrega os ingredientes de VÁRIOS rótulos de uma vez. A listagem precisa do
 * estado de completude de cada rótulo, e resolver isso um a um custaria duas
 * consultas por linha da lista.
 */
async function loadIngredientsForLabels(
  sb: SupabaseClient<Database>,
  labelIds: string[],
): Promise<Map<string, { views: LabelIngredientView[]; refs: LabelIngredient[] }>> {
  const out = new Map<string, { views: LabelIngredientView[]; refs: LabelIngredient[] }>()
  if (labelIds.length === 0) return out

  const c = loose(sb)
  const res = await c
    .from('nutrition_label_ingredients')
    .select('label_id, food_id, grams, position')
    .in('label_id', labelIds)
    .order('position', { ascending: true })
  const items = (res.data ?? []) as Array<{
    label_id: string
    food_id: string
    grams: number | string
    position: number
  }>
  if (items.length === 0) return out

  const foods = await c
    .from('foods')
    .select(
      'id, name, reference_grams, energy_kcal, protein_g, carb_g, fat_g, fiber_g, micronutrients',
    )
    .in(
      'id',
      items.map((i) => i.food_id),
    )
  const byId = new Map<string, { name: string; ref: FoodRef }>()
  for (const f of (foods.data ?? []) as Array<{
    id: string
    name: string
    reference_grams: number | string
    energy_kcal: number | string
    protein_g: number | string
    carb_g: number | string
    fat_g: number | string
    fiber_g: number | string | null
    micronutrients: Record<string, number> | null
  }>) {
    byId.set(f.id, {
      name: f.name,
      ref: {
        referenceGrams: num(f.reference_grams),
        energyKcal: num(f.energy_kcal),
        proteinG: num(f.protein_g),
        carbG: num(f.carb_g),
        fatG: num(f.fat_g),
        fiberG: f.fiber_g === null ? null : num(f.fiber_g),
        micros: f.micronutrients ?? null,
      },
    })
  }

  for (const it of items) {
    const food = byId.get(it.food_id)
    if (!food) continue
    const grams = num(it.grams)
    const entry = out.get(it.label_id) ?? { views: [], refs: [] }
    entry.views.push({ foodId: it.food_id, name: food.name, grams, food: food.ref })
    entry.refs.push({ foodId: it.food_id, name: food.name, grams, food: food.ref })
    out.set(it.label_id, entry)
  }
  return out
}

export async function listLabels(
  sb: SupabaseClient<Database>,
  tenantId: string,
): Promise<LabelSummary[]> {
  const c = loose(sb)
  const res = await c
    .from('nutrition_labels')
    .select(LABEL_COLUMNS)
    .eq('tenant_id', tenantId)
    .order('updated_at', { ascending: false })
    .limit(200)
  const rows = (res.data ?? []) as unknown as LabelRow[]
  const ingredientsByLabel = await loadIngredientsForLabels(
    sb,
    rows.map((r) => r.id),
  )

  const out: LabelSummary[] = []
  for (const row of rows) {
    // A lista mostra quais rótulos ainda não servem para embalagem, então o
    // `incomplete` precisa ser real — vem do motor, não de um flag gravado que
    // envelheceria assim que a base de alimentos mudasse.
    const refs = ingredientsByLabel.get(row.id)?.refs ?? []
    const result = composeLabel({
      ingredients: refs,
      totalYield: num(row.total_yield),
      portionSize: num(row.portion_size),
      basis: row.basis,
      manualValues: row.manual_values ?? {},
    })
    out.push({
      id: row.id,
      productName: row.product_name,
      clientName: row.client_name,
      basis: row.basis,
      incomplete: result.incomplete,
      updatedAt: row.updated_at,
    })
  }
  return out
}

/**
 * Mescla as sobrescritas: chave com número define, chave com `null` REMOVE.
 * Remover precisa apagar a chave do JSONB — gravar `null` deixaria o motor com
 * um valor presente-porém-nulo e o desfazer não voltaria ao calculado.
 */
function mergeManualValues(
  current: Record<string, number>,
  patch: Record<string, number | null>,
): Record<string, number> {
  const out = { ...current }
  for (const [key, value] of Object.entries(patch)) {
    if (value === null || value === undefined) delete out[key]
    else if (Number.isFinite(value)) out[key] = value
  }
  return out
}

export async function updateLabel(
  sb: SupabaseClient<Database>,
  args: UpdateLabelArgs,
): Promise<{ label: LabelView; result: LabelResult } | null> {
  const c = loose(sb)
  const existing = await c
    .from('nutrition_labels')
    .select('id, manual_values')
    .eq('tenant_id', args.tenantId)
    .eq('id', args.labelId)
    .maybeSingle()
  const prev = existing.data as { id: string; manual_values: Record<string, number> | null } | null
  if (!prev) return null

  const patch = fieldsToColumns(args)
  if (args.manualValues) {
    patch.manual_values = mergeManualValues(prev.manual_values ?? {}, args.manualValues)
  }

  if (Object.keys(patch).length > 0) {
    const upd = await c
      .from('nutrition_labels')
      .update(patch)
      .eq('tenant_id', args.tenantId)
      .eq('id', args.labelId)
    if (upd.error) throw new Error(`updateLabel: ${upd.error.message}`)
  }

  if (args.ingredients) {
    await replaceIngredients(sb, args.tenantId, args.labelId, args.ingredients)
  }

  if (args.manualValues && Object.keys(args.manualValues).length > 0) {
    await audit(sb, {
      tenantId: args.tenantId,
      labelId: args.labelId,
      field: 'manual_values',
      from: JSON.stringify(prev.manual_values ?? {}),
      to: JSON.stringify(patch.manual_values ?? prev.manual_values ?? {}),
      reason: 'valores informados à mão no rótulo',
    })
  }

  return getLabel(sb, args.tenantId, args.labelId)
}

export async function deleteLabel(
  sb: SupabaseClient<Database>,
  tenantId: string,
  labelId: string,
): Promise<boolean> {
  const c = loose(sb)
  const res = await c
    .from('nutrition_labels')
    .delete()
    .eq('tenant_id', tenantId)
    .eq('id', labelId)
    .select('id')
  const rows = (res.data ?? []) as Array<{ id: string }>
  if (rows.length === 0) return false
  await audit(sb, {
    tenantId,
    labelId,
    field: 'deleted',
    from: labelId,
    to: null,
    reason: 'rótulo nutricional removido',
  })
  return true
}
