/**
 * Helper puro de formatacao de telefone para link wa.me. Feature 007.
 *
 * Regras (FR-016/FR-017):
 *   - Remove tudo que nao e digito (exceto + inicial).
 *   - Se a string limpa comeca com `+`, devolve sem o `+` (numero
 *     internacional ja explicito — nao prefixa 55 de novo).
 *   - Caso contrario, prefixa `55` (Brasil — fluxo dominante do sistema).
 *   - Telefones com menos de 8 digitos ou mais de 15 digitos retornam null
 *     (provavelmente lixo no cadastro; melhor desabilitar o botao).
 *
 * Retorna `null` quando nao e possivel parsear — UI deve renderizar
 * o botao desabilitado com tooltip "Sem telefone cadastrado".
 */
export function formatPhoneForWhatsApp(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null
  const trimmed = raw.trim()
  if (trimmed.length === 0) return null

  const startsWithPlus = trimmed.startsWith('+')
  const digitsOnly = trimmed.replace(/\D/g, '')
  if (digitsOnly.length === 0) return null

  const final = startsWithPlus ? digitsOnly : `55${digitsOnly}`
  if (final.length < 8 || final.length > 15) return null

  return final
}

/** Constroi a URL final do wa.me a partir de um telefone bruto. */
export function buildWhatsAppUrl(raw: string | null | undefined): string | null {
  const formatted = formatPhoneForWhatsApp(raw)
  return formatted ? `https://wa.me/${formatted}` : null
}
