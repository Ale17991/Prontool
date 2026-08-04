/**
 * Feature 053 — placeholders do texto da regra.
 *
 * Motor de template deliberadamente burro: `{{campo}}` e nada mais. Sem
 * condicional, sem laço, sem expressão. O texto vai para o WhatsApp de um
 * paciente — não há caso de uso que justifique linguagem de programação num
 * campo que a recepção edita, e há muitos jeitos de uma linguagem dessas virar
 * mensagem quebrada na mão do paciente.
 *
 * A validação de placeholder acontece na ESCRITA (a clínica descobre o erro ao
 * salvar, com o nome do campo) e não na renderização, onde o erro apareceria
 * tarde demais — no meio do ciclo, para um paciente real.
 */

/** `{{ campo }}` com espaço opcional. Nome só com letra, número e underscore. */
const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g

/** Todos os campos citados pelo texto, sem repetição, na ordem de aparição. */
export function extractPlaceholders(template: string): string[] {
  const out: string[] = []
  for (const m of template.matchAll(PLACEHOLDER_RE)) {
    const nome = m[1]
    if (nome && !out.includes(nome)) out.push(nome)
  }
  return out
}

/**
 * Campos citados que a família não oferece. Vazio significa texto válido.
 *
 * Devolve a lista e não um booleano porque a mensagem de erro precisa dizer
 * QUAL campo não existe — "texto inválido" faz a clínica caçar no escuro.
 */
export function findUnknownPlaceholders(
  template: string,
  allowed: readonly string[],
): string[] {
  return extractPlaceholders(template).filter((p) => !allowed.includes(p))
}

/**
 * Substitui os campos pelos valores.
 *
 * Campo sem valor vira string vazia, **não** fica como `{{campo}}` na mensagem:
 * um paciente que recebe "Oi {{paciente}}" vê o sistema por trás da clínica, o
 * que é pior que uma saudação sem nome. Como a validação de escrita já garante
 * que todo campo é conhecido, a ausência aqui significa dado faltando naquele
 * paciente — caso raro que degrada, não quebra.
 */
export function renderTemplate(
  template: string,
  values: Record<string, string>,
): string {
  return template
    .replace(PLACEHOLDER_RE, (_full, nome: string) => values[nome] ?? '')
    // Espaço duplo sobra quando um campo vazio fica entre duas palavras.
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}
