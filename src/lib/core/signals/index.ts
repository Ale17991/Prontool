/**
 * Feature 053 — barrel da cápsula de sinais.
 *
 * `occurrences.ts` e `gates.ts` NÃO são reexportados: são internos do ciclo, e
 * expô-los convidaria a gravar ocorrência de fora do motor, onde os portões não
 * rodaram. Mesmo critério que `whatsapp/index.ts` usa com `delivery.ts`.
 */

export * from './types'
export { CATALOG, familyById, familiesByNature } from './catalog'
