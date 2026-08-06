/**
 * Feature 051 — Normalização de telefone BR para envio por WhatsApp.
 *
 * Portado de `supabase/functions/_shared/phone.ts` do serviço de envio (repo
 * Homio-CRM/clinni-whatsapp), que já tinha a regra correta. O Clinni precisa
 * da mesma regra para decidir se o telefone é sequer enviável ANTES de gastar
 * uma chamada ao serviço.
 *
 * Regra:
 *   - celular: 55 + DDD + 9 + 8 dígitos (o 9 é obrigatório)
 *   - fixo:    55 + DDD + 8 dígitos, começando em 2-5
 *
 * ARMADILHA (a razão de portar em vez de reescrever): NUNCA remover o 9 de um
 * número de 13 dígitos. As faixas novas de celular emitem 9 seguido de 0-5, o
 * que faz o número "parecer" um fixo com DDD errado. Só ADICIONAMOS o 9 quando
 * ele falta num número de 12 dígitos que não é fixo.
 */

/** Extrai só os dígitos, descartando sufixo de JID (`...@s.whatsapp.net`). */
export function getOnlyNumbers(input: string): string {
  if (!input) return ''
  const beforeJid = input.split('@')[0] ?? input
  return beforeJid.replace(/\D/g, '')
}

/**
 * Normaliza para o formato que o WhatsApp aceita. Não valida — devolve o que
 * conseguir. Use `isSendablePhone` para decidir se vale tentar o envio.
 */
export function normalizePhone(phone: string): string {
  let p = getOnlyNumbers(phone)
  if (p.startsWith('55')) {
    const ddd = p.substring(2, 4)
    const rest = p.substring(4)
    const firstChar = rest[0]
    if (rest.length === 8 && firstChar !== undefined) {
      const firstDigit = Number.parseInt(firstChar, 10)
      // 2-5 = fixo, fica como está. Fora disso é celular sem o 9 → acrescenta.
      if (!Number.isNaN(firstDigit) && (firstDigit < 2 || firstDigit > 5)) {
        p = `55${ddd}9${rest}`
      }
    }
  }
  return p
}

/**
 * Um número brasileiro normalizado é enviável quando tem 12 dígitos (fixo:
 * 55 + DDD + 8) ou 13 (celular: 55 + DDD + 9 + 8).
 *
 * Números sem o prefixo 55 são aceitos se tiverem comprimento plausível de
 * E.164 — o serviço pode estar mandando para fora do Brasil no futuro, e
 * rejeitar aqui seria decidir cedo demais.
 */
export function isSendablePhone(phone: string): boolean {
  const p = normalizePhone(phone)
  if (p.length < 10 || p.length > 15) return false
  if (p.startsWith('55')) return p.length === 12 || p.length === 13
  return true
}

/**
 * Aceita o número do jeito que se escreve no Brasil — "(11) 98888-7777" — e
 * devolve o formato que o serviço espera.
 *
 * O 55 é acrescentado quando falta: 10 ou 11 dígitos é DDD + número, e sem o
 * código do país o serviço monta um JID que não existe. O envio não dá erro —
 * ele simplesmente não chega, que é o desfecho mais caro de diagnosticar.
 *
 * Separado de `normalizePhone` de propósito: aquele é a regra portada do serviço
 * e trata o que já vem de um cadastro; este é a tradução do que uma pessoa
 * DIGITA num campo.
 *
 * O `+` inicial desliga a regra: 11 dígitos tanto é celular brasileiro (DDD + 9
 * + 8) quanto número americano com o código do país, e o comprimento sozinho não
 * separa os dois. Quem escreveu "+" já declarou o país, e prefixar 55 ali
 * mandaria a mensagem para um destino inexistente.
 */
export function fromTypedInput(raw: string): string {
  const digits = getOnlyNumbers(raw)
  if (raw.trim().startsWith('+')) return normalizePhone(digits)
  if (digits.length === 10 || digits.length === 11) return normalizePhone(`55${digits}`)
  return normalizePhone(digits)
}

/** Monta o JID de contato individual. */
export function toWhatsAppJid(phone: string): string {
  return `${normalizePhone(phone)}@s.whatsapp.net`
}
