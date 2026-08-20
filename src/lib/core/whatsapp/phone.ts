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

/**
 * O número de um CADASTRO, pronto para virar destino de envio.
 *
 * É o mesmo que `fromTypedInput`, com outro nome, e a duplicação é deliberada:
 * o nome daquela função descreve a origem do dado ("alguém digitou"), e por isso
 * ninguém a procurava na hora de mandar mensagem a partir de um telefone já
 * gravado. Os dois motores chamavam `normalizePhone` direto — que só age em
 * número que JÁ começa com 55 e devolve o resto intacto.
 *
 * O estrago era invisível: `(27) 99273-4155` virava `27992734155`, o serviço
 * montava o JID `27992734155@s.whatsapp.net`, a Evolution ACEITAVA e devolvia um
 * id de mensagem, e nada chegava. Sem erro, sem confirmação de entrega, sem
 * nada — descoberto em 14/08/2026, depois de duas mensagens "enviadas" que o
 * destinatário nunca recebeu.
 *
 * Chame ESTA função em todo ponto de envio. `normalizePhone` continua existindo
 * para o que já vem completo, do serviço.
 */
export function toSendableNumber(stored: string): string {
  return fromTypedInput(stored)
}

/** Monta o JID de contato individual. */
export function toWhatsAppJid(phone: string): string {
  return `${normalizePhone(phone)}@s.whatsapp.net`
}

/**
 * O mesmo número, no formato LOCAL brasileiro — DDD + assinante, sem o 55.
 *
 * O oposto de `toSendableNumber`, e existe para os destinos que NÃO são o
 * WhatsApp. Desde que o cadastro passou a gravar o telefone canônico (`cf69453`),
 * quem lê `patients.phone` recebe `5511988887777`; um sistema brasileiro que
 * espera `11988887777` num campo de celular pode recusar, truncar ou guardar
 * um DDD que não existe.
 *
 * Número estrangeiro passa intacto: ali o código do país é parte do endereço, e
 * removê-lo produziria um número que não liga para lugar nenhum.
 */
export function toBrazilianLocal(stored: string): string {
  const p = toSendableNumber(stored)
  if (p.startsWith('55') && (p.length === 12 || p.length === 13)) return p.slice(2)
  return p
}
