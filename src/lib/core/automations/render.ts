/**
 * Feature 056 — variáveis → texto.
 *
 * A sintaxe é `{{variavel}}`, a mesma de `render-whatsapp.ts`, para a clínica
 * não aprender duas gramáticas dentro do mesmo produto.
 *
 * A validação acontece em DOIS momentos distintos, e a diferença entre eles é o
 * que impede mensagem torta chegar no celular do paciente:
 *
 *   - ao ASSOCIAR gatilho e mensagem, `variablesNotProvidedBy` recusa texto que
 *     peça dado que a fonte não sabe preencher. O erro aparece para quem está
 *     montando, na tela, no momento da decisão.
 *   - ao ENVIAR, `render` devolve `null` se algum valor estiver ausente para
 *     aquele paciente específico. Melhor não mandar do que mandar
 *     "Feliz aniversário, !".
 */

const PLACEHOLDER = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

/** Todas as variáveis citadas no corpo, sem repetição. */
export function extractVariables(body: string): string[] {
  const found = new Set<string>()
  for (const m of body.matchAll(PLACEHOLDER)) {
    if (m[1]) found.add(m[1])
  }
  return [...found]
}

/**
 * Quais variáveis do corpo a fonte NÃO fornece. Vazio = a dupla pode ser
 * associada.
 */
export function variablesNotProvidedBy(body: string, provided: readonly string[]): string[] {
  const set = new Set(provided)
  return extractVariables(body).filter((v) => !set.has(v))
}

export interface RenderResult {
  /** `null` quando alguma variável não tinha valor — o envio deve ser pulado. */
  text: string | null
  /** Quais faltaram, para o registro dizer o motivo. */
  missing: string[]
}

export function render(body: string, values: Record<string, string>): RenderResult {
  const missing: string[] = []

  const text = body.replace(PLACEHOLDER, (_full, name: string) => {
    const v = values[name]
    // String vazia conta como ausente: uma clínica sem nome cadastrado produz
    // "A equipe da  deseja" — que denuncia o defeito para o paciente.
    if (v === undefined || v === null || v.trim() === '') {
      missing.push(name)
      return ''
    }
    return v
  })

  return missing.length > 0 ? { text: null, missing } : { text, missing: [] }
}
