/**
 * Feature 056 — o registro de fontes de gatilho.
 *
 * ESTE ARQUIVO É O PONTO DE EXTENSÃO DA FEATURE, e a regra que o governa é
 * curta: ele não conhece nenhuma fonte nominalmente. Fontes se registram; o
 * registro apenas guarda e devolve.
 *
 * Isso não é purismo. A feature nasceu com a decisão de o lembrete de consulta
 * seguir com motor próprio e ser absorvido depois (FR-024/025). Se o registro
 * — ou o motor — souber que existem exatamente cinco fontes e quais são, a tal
 * absorção deixa de ser "adicionar um arquivo" e vira reescrita, que é
 * exatamente o que a decisão quis evitar.
 *
 * Teste que trava isto: nenhum identificador de fonte pode aparecer neste
 * arquivo nem em `evaluate.ts`.
 */

import type { AutomationSourceDef } from '../types'

const registry = new Map<string, AutomationSourceDef>()

/**
 * Registra uma fonte. Chamado pelo módulo de cada fonte no import — ver
 * `sources/index.ts`, que existe só para garantir que todos sejam importados.
 */
export function registerSource(def: AutomationSourceDef): void {
  if (registry.has(def.id)) {
    throw new Error(`fonte de automação duplicada: ${def.id}`)
  }
  registry.set(def.id, def)
}

export function getSource(id: string): AutomationSourceDef | null {
  return registry.get(id) ?? null
}

/**
 * Catálogo para a tela montar o formulário sem hardcodar nada.
 *
 * `hasModule` chega como função e não como lista de módulos para o registro
 * seguir sem saber que módulos existem — ele checa `requiresModule` contra o que
 * lhe deram e pronto. Omitido, devolve tudo (é o caso do motor, que resolve
 * fonte por id e não precisa filtrar).
 */
export function listSources(hasModule?: (moduleId: string) => boolean): AutomationSourceDef[] {
  return [...registry.values()]
    .filter((s) => !s.requiresModule || !hasModule || hasModule(s.requiresModule))
    .sort((a, b) => a.label.localeCompare(b.label, 'pt-BR'))
}

/** Só para teste — o registro é global e sobrevive entre casos. */
export function _resetRegistry(): void {
  registry.clear()
}
