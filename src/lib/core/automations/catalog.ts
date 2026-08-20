/**
 * Feature 056 — o catálogo que a tela usa para montar o formulário de gatilho.
 *
 * A tela não conhece nenhuma fonte nominalmente: pergunta ao registro quais
 * existem, e cada fonte declara os campos que precisa. É a mesma ignorância que
 * o motor tem, pelo mesmo motivo — fonte nova é um arquivo em `sources/`, e nada
 * mais.
 *
 * As opções de campo de escolha (qual hábito, qual métrica) são resolvidas AQUI,
 * no servidor, e não no componente. Duas razões: são dados da clínica, com RLS e
 * tenant a respeitar; e resolvê-las na tela obrigaria o componente a conhecer as
 * tabelas de domínio de cada vertical, que é exatamente o acoplamento que o
 * descritor de campo existe para evitar.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { listSources } from './sources'
import {
  SOURCE_GROUP_LABEL,
  UNIVERSAL_VARIABLES,
  type SourceGroup,
  type SourceOptionSet,
  type SourceParamField,
} from './types'

export interface SourceOption {
  value: string
  label: string
}

export interface SourceDTO {
  id: string
  label: string
  group: SourceGroup
  groupLabel: string
  hint: string
  warning: string | null
  fields: readonly SourceParamField[]
  /** Universais + as da fonte — é a lista que a tela mostra a quem escreve. */
  variables: string[]
}

export interface SourceCatalog {
  fontes: SourceDTO[]
  /** Opções por conjunto, para os campos `select`. */
  opcoes: Record<SourceOptionSet, SourceOption[]>
}

export async function buildSourceCatalog(
  supabase: SupabaseClient,
  tenantId: string,
  hasModule: (moduleId: string) => boolean,
): Promise<SourceCatalog> {
  const fontes: SourceDTO[] = listSources(hasModule).map((s) => ({
    id: s.id,
    label: s.label,
    group: s.group,
    groupLabel: SOURCE_GROUP_LABEL[s.group],
    hint: s.hint,
    warning: s.warning ?? null,
    fields: s.fields ?? [],
    variables: [...UNIVERSAL_VARIABLES, ...s.variables],
  }))

  // Só busca o que alguma fonte visível pede. Uma clínica sem o módulo de
  // hábitos não paga por uma consulta de hábitos.
  const pedidos = new Set<SourceOptionSet>()
  for (const f of fontes) {
    for (const campo of f.fields) {
      if (campo.optionsFrom) pedidos.add(campo.optionsFrom)
    }
  }

  const opcoes: Record<SourceOptionSet, SourceOption[]> = {
    habit_items: [],
    metric_types: [],
  }
  if (pedidos.has('habit_items')) {
    opcoes.habit_items = await habitItems(supabase, tenantId)
  }
  if (pedidos.has('metric_types')) {
    opcoes.metric_types = await metricTypes(supabase, tenantId)
  }

  return { fontes, opcoes }
}

interface ItemJson {
  id?: unknown
  label?: unknown
}

/**
 * Os hábitos que existem nesta clínica, vindos dos MODELOS e das GRADES.
 *
 * As duas pontas, e não só o modelo: a grade de cada paciente nasce como cópia
 * do modelo mas segue a vida própria (a 0189 permite ajustar por paciente).
 * Listar só os modelos esconderia justamente o hábito que alguém acrescentou
 * para um grupo de pacientes — e o gatilho casa por `itemId`, que é o que a
 * grade guarda.
 */
async function habitItems(supabase: SupabaseClient, tenantId: string): Promise<SourceOption[]> {
  const vistos = new Map<string, string>()

  for (const tabela of ['habit_checklist_templates', 'patient_habit_checklists'] as const) {
    const { data, error } = await supabase
      .from(tabela)
      .select('items')
      .eq('tenant_id', tenantId)
      .eq('active', true)
      .limit(500)
    if (error) continue

    for (const linha of (data ?? []) as Array<{ items: unknown }>) {
      const itens = Array.isArray(linha.items) ? (linha.items as ItemJson[]) : []
      for (const item of itens) {
        const id = typeof item?.id === 'string' ? item.id : null
        const label = typeof item?.label === 'string' ? item.label : null
        if (!id || !label) continue
        // O primeiro rótulo encontrado vence. Se duas grades renomearam o mesmo
        // item, qualquer um dos dois identifica a coisa certa — o que casa é o
        // id, e é ele que vai para os parâmetros.
        if (!vistos.has(id)) vistos.set(id, label)
      }
    }
  }

  return [...vistos.entries()]
    .map(([value, label]) => ({ value, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
}

/** As métricas de acompanhamento: catálogo global mais as da clínica. */
async function metricTypes(supabase: SupabaseClient, tenantId: string): Promise<SourceOption[]> {
  const { data, error } = await supabase
    .from('patient_metric_types')
    .select('metric_type, label, unit')
    .or(`tenant_id.is.null,tenant_id.eq.${tenantId}`)
    .eq('active', true)
    .order('display_order')
    .limit(500)
  if (error) return []

  const vistos = new Map<string, string>()
  for (const t of (data ?? []) as Array<{ metric_type: string; label: string; unit: string }>) {
    if (!vistos.has(t.metric_type)) {
      vistos.set(t.metric_type, t.unit ? `${t.label} (${t.unit})` : t.label)
    }
  }
  return [...vistos.entries()].map(([value, label]) => ({ value, label }))
}
