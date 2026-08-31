import { describe, expect, it } from 'vitest'
import { centsToReais, reaisToCents, splitAmountCents } from '@/lib/core/billing/asaas/money'
import { entitlementStatusFor, grantsAccess, mapAsaasStatus } from '@/lib/core/billing/status'
import { buildSplit, resolveSplitRule, type BillingPartner } from '@/lib/core/billing/partners'

/**
 * Aritmética de dinheiro e tradução de status da cobrança da plataforma.
 * Tudo puro: nada aqui toca banco nem rede.
 */

function partner(over: Partial<BillingPartner> = {}): BillingPartner {
  return {
    id: 'p1',
    name: 'zee.lu',
    slug: 'zeelu',
    asaasWalletId: 'wallet-1',
    splitPercentBps: 2500,
    splitFixedCents: null,
    status: 'active',
    notes: null,
    ...over,
  }
}

describe('conversão centavos ↔ reais', () => {
  it('converte centavos para reais com 2 casas', () => {
    expect(centsToReais(14990)).toBe(149.9)
    expect(centsToReais(0)).toBe(0)
    expect(centsToReais(1)).toBe(0.01)
  })

  it('recusa centavos fracionários — meio centavo não existe em cobrança', () => {
    expect(() => centsToReais(149.5)).toThrow()
  })

  it('não perde o centavo no caminho de volta (149.9 * 100 é 14989.99…)', () => {
    expect(reaisToCents(149.9)).toBe(14990)
    expect(reaisToCents('149.90')).toBe(14990)
    expect(reaisToCents(0)).toBe(0)
  })

  it('distingue ausente de zero — netValue nulo não é líquido zero', () => {
    expect(reaisToCents(null)).toBeNull()
    expect(reaisToCents(undefined)).toBeNull()
    expect(reaisToCents('')).toBeNull()
  })
})

describe('cálculo do split', () => {
  it('aplica percentual em pontos-base', () => {
    expect(splitAmountCents(20000, { splitPercentBps: 2500, splitFixedCents: null })).toBe(5000)
  })

  it('arredonda para BAIXO — o centavo da divisão inexata fica com a Clinni', () => {
    // 14990 × 33,33% = 4996,167 → 4996, nunca 4997.
    expect(splitAmountCents(14990, { splitPercentBps: 3333, splitFixedCents: null })).toBe(4996)
  })

  it('usa o valor fixo quando há um', () => {
    expect(splitAmountCents(14990, { splitPercentBps: null, splitFixedCents: 3000 })).toBe(3000)
  })

  it('recusa split fixo maior que a cobrança em vez de dividir tudo', () => {
    expect(() => splitAmountCents(1000, { splitPercentBps: null, splitFixedCents: 5000 })).toThrow()
  })

  it('sem regra devolve null, que é diferente de zero', () => {
    expect(splitAmountCents(14990, { splitPercentBps: null, splitFixedCents: null })).toBeNull()
  })
})

describe('resolveSplitRule — a regra da clínica manda (0216)', () => {
  const p = partner({ splitPercentBps: 2500, splitFixedCents: null })

  it('sem regra própria, a clínica herda o padrão do parceiro', () => {
    expect(resolveSplitRule(p, { percentBps: null, fixedCents: null })).toEqual({
      walletId: 'wallet-1',
      percentBps: 2500,
      fixedCents: null,
    })
  })

  it('com regra própria, a da clínica vence', () => {
    expect(resolveSplitRule(p, { percentBps: 1000, fixedCents: null }).percentBps).toBe(1000)
  })

  it('a escolha é por MODO, não campo a campo', () => {
    // Clínica define valor fixo; NÃO pode herdar o percentual do parceiro, ou
    // sairia uma regra híbrida que ninguém escreveu.
    const r = resolveSplitRule(p, { percentBps: null, fixedCents: 3000 })
    expect(r.fixedCents).toBe(3000)
    expect(r.percentBps).toBeNull()
  })

  it('sem parceiro não há repasse nenhum', () => {
    expect(resolveSplitRule(null, { percentBps: 5000, fixedCents: null })).toEqual({
      walletId: null,
      percentBps: null,
      fixedCents: null,
    })
  })

  it('parceiro sem padrão e clínica sem regra: não divide', () => {
    const semPadrao = partner({ splitPercentBps: null, splitFixedCents: null })
    const r = resolveSplitRule(semPadrao, { percentBps: null, fixedCents: null })
    expect(r.percentBps).toBeNull()
    expect(r.fixedCents).toBeNull()
    expect(buildSplit(semPadrao, r, 14990)).toBeNull()
  })
})

describe('buildSplit', () => {
  const regra = (over = {}) => ({
    walletId: 'wallet-1',
    percentBps: 2500,
    fixedCents: null,
    ...over,
  })

  it('monta o objeto do Asaas em reais, com o valor já arredondado aqui', () => {
    const out = buildSplit(partner(), regra(), 14990)
    expect(out).not.toBeNull()
    expect(out!.amountCents).toBe(3747) // 25% de 14990 = 3747,5 → 3747
    expect(out!.split).toEqual([{ walletId: 'wallet-1', fixedValue: 37.47 }])
  })

  it('usa a regra da clínica, não a do parceiro', () => {
    // Parceiro com padrão de 25%, clínica num plano de 10%.
    const out = buildSplit(partner(), regra({ percentBps: 1000 }), 20000)
    expect(out!.amountCents).toBe(2000)
  })

  it('parceiro sem carteira não divide — a cobrança sai inteira, não falha', () => {
    expect(
      buildSplit(partner({ asaasWalletId: null }), regra({ walletId: null }), 14990),
    ).toBeNull()
  })

  it('parceiro inativo não divide', () => {
    expect(buildSplit(partner({ status: 'inactive' }), regra(), 14990)).toBeNull()
  })

  it('sem parceiro não divide', () => {
    expect(buildSplit(null, regra(), 14990)).toBeNull()
  })

  it('split que arredonda para zero não vira split de zero reais', () => {
    // 1 centavo × 25% = 0,25 → floor 0. Mandar fixedValue 0 ao Asaas seria
    // registrar uma divisão de nada.
    expect(buildSplit(partner(), regra(), 1)).toBeNull()
  })
})

describe('tradução de status do Asaas', () => {
  it('mantém CONFIRMED e RECEIVED distintos', () => {
    expect(mapAsaasStatus('CONFIRMED')).toBe('confirmado')
    expect(mapAsaasStatus('RECEIVED')).toBe('recebido')
  })

  it('os dois liberam acesso — o cliente cumpriu a parte dele', () => {
    expect(grantsAccess('confirmado')).toBe(true)
    expect(grantsAccess('recebido')).toBe(true)
    expect(grantsAccess('pendente')).toBe(false)
    expect(grantsAccess('vencido')).toBe(false)
  })

  it('status desconhecido cai no seguro — pendente, nunca recebido', () => {
    expect(mapAsaasStatus('ALGO_NOVO_DO_ASAAS')).toBe('pendente')
  })

  it('chargeback e estorno viram estornado', () => {
    expect(mapAsaasStatus('REFUNDED')).toBe('estornado')
    expect(mapAsaasStatus('CHARGEBACK_REQUESTED')).toBe('estornado')
  })
})

describe('efeito sobre a assinatura da clínica', () => {
  it('pagamento ativa', () => {
    expect(entitlementStatusFor('recebido')).toBe('active')
    expect(entitlementStatusFor('confirmado')).toBe('active')
  })

  it('vencimento rebaixa para inadimplente', () => {
    expect(entitlementStatusFor('vencido')).toBe('past_due')
  })

  it('estorno rebaixa, mas NÃO cancela — cancelar é decisão comercial', () => {
    expect(entitlementStatusFor('estornado')).toBe('past_due')
  })

  it('fatura pendente não mexe no status — senão suspenderia clínica adimplente todo mês', () => {
    expect(entitlementStatusFor('pendente')).toBeNull()
  })
})
