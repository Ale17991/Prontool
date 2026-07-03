/**
 * Backlog 3 — substituição de placeholders nos modelos de documento.
 * Sintaxe: {{chave}} (ex.: {{paciente.nome}}). Chave desconhecida → vazio.
 */

/** Placeholders disponíveis, para ajuda no editor de modelos. */
export const AVAILABLE_PLACEHOLDERS: Array<{ key: string; label: string }> = [
  { key: 'paciente.nome', label: 'Nome do paciente' },
  { key: 'paciente.cpf', label: 'CPF' },
  { key: 'paciente.nascimento', label: 'Data de nascimento' },
  { key: 'paciente.idade', label: 'Idade' },
  { key: 'paciente.email', label: 'E-mail' },
  { key: 'paciente.telefone', label: 'Telefone' },
  { key: 'clinica.nome', label: 'Nome da clínica' },
  { key: 'data', label: 'Data de hoje' },
]

export function substitutePlaceholders(body: string, vars: Record<string, string>): string {
  return body.replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_m, key: string) => {
    const v = vars[key]
    return v === undefined || v === null ? '' : v
  })
}
