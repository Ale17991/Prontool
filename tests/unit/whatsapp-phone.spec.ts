/**
 * T012 (Feature 051) — normalização de telefone BR, testes puros (sem DB).
 *
 * O caso que justifica o arquivo inteiro é o último bloco: número de 13
 * dígitos cujo 9 é seguido de 0-5. Uma implementação ingênua "corrige" isso
 * removendo o 9, e o paciente nunca recebe a mensagem.
 */
import { describe, it, expect } from 'vitest'
import {
  getOnlyNumbers,
  normalizePhone,
  isSendablePhone,
  toSendableNumber,
  toWhatsAppJid,
  fromTypedInput,
  toBrazilianLocal,
} from '@/lib/core/whatsapp/phone'

describe('Feature 051 — getOnlyNumbers', () => {
  it('remove máscara', () => {
    expect(getOnlyNumbers('+55 (11) 99999-8888')).toBe('5511999998888')
  })

  it('descarta o sufixo de JID', () => {
    expect(getOnlyNumbers('5511999998888@s.whatsapp.net')).toBe('5511999998888')
  })

  it('entrada vazia devolve string vazia', () => {
    expect(getOnlyNumbers('')).toBe('')
  })
})

describe('Feature 051 — normalizePhone', () => {
  it('celular completo (13 dígitos) passa intacto', () => {
    expect(normalizePhone('5511999998888')).toBe('5511999998888')
  })

  it('celular de 8 dígitos sem o 9 ganha o 9', () => {
    // 55 + 11 + 88887777 → primeiro dígito 8 (fora de 2-5) = celular antigo
    expect(normalizePhone('551188887777')).toBe('5511988887777')
  })

  it('fixo de 8 dígitos NÃO ganha o 9', () => {
    // primeiro dígito 3 está na faixa 2-5 = fixo
    expect(normalizePhone('551133334444')).toBe('551133334444')
  })

  it.each(['2', '3', '4', '5'])('fixo começando em %s permanece fixo', (d) => {
    const input = `5511${d}1112222`
    expect(normalizePhone(input)).toBe(input)
  })

  it('aceita entrada com máscara', () => {
    expect(normalizePhone('(11) 99999-8888')).toBe('11999998888')
  })
})

describe('Feature 051 — nunca remove o 9 de número de 13 dígitos', () => {
  // Faixas novas emitem 9 seguido de 0-5. Remover o 9 aqui quebra o envio.
  it.each(['0', '1', '2', '3', '4', '5'])(
    'celular 9%s… de 13 dígitos permanece com 13 dígitos',
    (second) => {
      const input = `55119${second}1112222`
      expect(input).toHaveLength(13)
      const out = normalizePhone(input)
      expect(out).toBe(input)
      expect(out).toHaveLength(13)
    },
  )
})

describe('Feature 051 — isSendablePhone', () => {
  it('celular BR de 13 dígitos é enviável', () => {
    expect(isSendablePhone('5511999998888')).toBe(true)
  })

  it('fixo BR de 12 dígitos é enviável', () => {
    expect(isSendablePhone('551133334444')).toBe(true)
  })

  it('número BR truncado não é enviável', () => {
    expect(isSendablePhone('5511999')).toBe(false)
  })

  it('string vazia não é enviável', () => {
    expect(isSendablePhone('')).toBe(false)
  })

  it('só a máscara, sem dígitos, não é enviável', () => {
    expect(isSendablePhone('() -')).toBe(false)
  })
})

describe('Feature 051 — fromTypedInput (envio de teste)', () => {
  it('acrescenta o 55 no celular digitado com máscara', () => {
    expect(fromTypedInput('(11) 98888-7777')).toBe('5511988887777')
  })

  it('acrescenta o 55 no fixo de 10 dígitos', () => {
    expect(fromTypedInput('11 3333-4444')).toBe('551133334444')
  })

  it('celular de 10 dígitos ganha o 9 junto com o 55', () => {
    expect(fromTypedInput('11 8888-7777')).toBe('5511988887777')
  })

  it('não duplica o 55 de quem já digitou o país', () => {
    expect(fromTypedInput('+55 (11) 98888-7777')).toBe('5511988887777')
  })

  // 11 dígitos é celular BR (DDD+9+8) E número americano com país. O `+` é o
  // único sinal que separa os dois — sem ele a regra brasileira ganha.
  it('o + protege o número estrangeiro de ganhar 55', () => {
    expect(fromTypedInput('+1 415 555 2671')).toBe('14155552671')
  })

  it('sem o +, onze dígitos são lidos como celular brasileiro', () => {
    expect(fromTypedInput('11 98888-7777')).toBe('5511988887777')
  })

  it('o resultado de um celular digitado é enviável', () => {
    expect(isSendablePhone(fromTypedInput('(11) 98888-7777'))).toBe(true)
  })

  it('campo vazio não vira número enviável', () => {
    expect(isSendablePhone(fromTypedInput(''))).toBe(false)
  })
})

describe('Feature 051 — toWhatsAppJid', () => {
  it('monta o JID individual a partir do número normalizado', () => {
    expect(toWhatsAppJid('55 (11) 8888-7777')).toBe('5511988887777@s.whatsapp.net')
  })

  it('sem o prefixo 55 o número passa intacto — a regra do 9 é brasileira', () => {
    expect(toWhatsAppJid('(11) 8888-7777')).toBe('1188887777@s.whatsapp.net')
  })
})

/**
 * O defeito de 14/08/2026, travado por teste.
 *
 * Duas mensagens saíram como "enviadas", com id devolvido pela Evolution, e o
 * destinatário nunca recebeu nada. O telefone do cadastro era `(27) 99273-4155`
 * — sem o código do país — e os motores chamavam `normalizePhone`, que só age em
 * número que JÁ começa com 55. O destino virava `27992734155@s.whatsapp.net`,
 * que não existe: a Evolution aceita, responde com id, e a mensagem some.
 */
describe('telefone de cadastro pronto para envio', () => {
  it('acrescenta o 55 no celular escrito como se escreve no Brasil', () => {
    expect(toSendableNumber('(27) 99273-4155')).toBe('5527992734155')
  })

  it('não mexe no que já vem completo', () => {
    expect(toSendableNumber('5527992734155')).toBe('5527992734155')
  })

  it('acrescenta o 9 que falta e o 55, juntos', () => {
    expect(toSendableNumber('(27) 9273-4155')).toBe('5527992734155')
  })

  it('o resultado é enviável — era isto que passava batido', () => {
    expect(isSendablePhone(toSendableNumber('(27) 99273-4155'))).toBe(true)
    // O valor CRU também é aceito pelo guard, e é justamente por isso que o
    // guard sozinho não protegia: 11 dígitos passam por "E.164 plausível".
    expect(isSendablePhone('27992734155')).toBe(true)
    expect(normalizePhone('27992734155')).toBe('27992734155')
  })

  it('quem declarou o país com + não recebe 55 na frente', () => {
    expect(toSendableNumber('+1 202 555 0143')).toBe('12025550143')
  })
})

/**
 * O telefone é gravado canônico no CADASTRO, e não só normalizado no envio.
 *
 * Corrigir apenas na saída deixaria o dado errado no banco — e cada canal novo
 * (e cada exportação, e cada integração) teria que lembrar de normalizar de
 * novo. Estes casos travam o contrato que os três caminhos de escrita usam.
 */
describe('telefone canônico na gravação', () => {
  it('o que a recepção digita vira número completo', () => {
    expect(fromTypedInput('(27) 99273-4155')).toBe('5527992734155')
    expect(fromTypedInput('27 99273 4155')).toBe('5527992734155')
    expect(fromTypedInput('27992734155')).toBe('5527992734155')
  })

  it('fixo de 10 dígitos também ganha o país', () => {
    expect(fromTypedInput('(27) 3227-4155')).toBe('552732274155')
  })

  it('quem já veio completo não é mexido', () => {
    expect(fromTypedInput('5527992734155')).toBe('5527992734155')
  })

  it('gravar duas vezes não acumula prefixo', () => {
    const uma = fromTypedInput('(27) 99273-4155')
    expect(fromTypedInput(uma)).toBe(uma)
  })
})

/**
 * O canônico serve ao WhatsApp; sistema brasileiro nenhum pede o 55 num campo
 * de celular. A Memed recebia `5511988887777` desde que o cadastro passou a
 * gravar canônico — sem ninguém mexer no código dela.
 */
describe('telefone no formato local brasileiro', () => {
  it('tira o país do celular e do fixo', () => {
    expect(toBrazilianLocal('5527992734155')).toBe('27992734155')
    expect(toBrazilianLocal('552732274155')).toBe('2732274155')
  })

  it('parte do que a recepção digitou, não só do já canônico', () => {
    expect(toBrazilianLocal('(27) 99273-4155')).toBe('27992734155')
    expect(toBrazilianLocal('27992734155')).toBe('27992734155')
  })

  it('número estrangeiro passa intacto — ali o país é parte do endereço', () => {
    expect(toBrazilianLocal('+14155552671')).toBe('14155552671')
  })

  it('aplicar duas vezes não come o DDD', () => {
    const uma = toBrazilianLocal('5527992734155')
    expect(toBrazilianLocal(uma)).toBe(uma)
  })
})
