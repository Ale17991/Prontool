'use client'

import { useState, useTransition } from 'react'
import { CreditCard, ExternalLink, Loader2, RefreshCw, Trash2, Zap } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCurrency } from '@/lib/utils'
import type { AsaasBillingType, AsaasCycle } from '@/lib/core/billing/asaas/types'
import { CHARGE_STATUS_LABEL } from '@/lib/core/billing/status'
import type { BillingCharge } from '@/lib/core/billing/charges'
import type { TenantBilling } from '@/lib/core/billing/subscription'
import type { BillingPartner } from '@/lib/core/billing/partners'
import {
  adminCancelSubscriptionAction,
  adminSaveTenantBillingAction,
  adminStartSubscriptionAction,
  adminSyncChargesAction,
} from '../../financeiro/billing-actions'

/**
 * Cobrança da assinatura desta clínica (o que a Clinni recebe dela).
 *
 * Duas ações deliberadamente separadas: SALVAR só grava aqui, ATIVAR fala com o
 * Asaas. Juntar as duas faria corrigir uma anotação disparar chamada externa e
 * possivelmente reemitir fatura — efeito que ninguém espera de um botão
 * "salvar".
 */

const CYCLES: Array<{ v: AsaasCycle; l: string }> = [
  { v: 'MONTHLY', l: 'Mensal' },
  { v: 'QUARTERLY', l: 'Trimestral' },
  { v: 'SEMIANNUALLY', l: 'Semestral' },
  { v: 'YEARLY', l: 'Anual' },
]

const TYPES: Array<{ v: AsaasBillingType; l: string }> = [
  { v: 'UNDEFINED', l: 'Cliente escolhe (PIX, boleto ou cartão)' },
  { v: 'PIX', l: 'Somente PIX' },
  { v: 'BOLETO', l: 'Somente boleto' },
  { v: 'CREDIT_CARD', l: 'Somente cartão' },
]

const STATUS_TONE: Record<string, string> = {
  recebido: 'text-success-text',
  confirmado: 'text-success-text',
  pendente: 'text-slate-500',
  vencido: 'text-destructive',
  estornado: 'text-destructive',
  cancelado: 'text-slate-400',
  falhou: 'text-destructive',
}

export function BillingCard({
  tenantId,
  billing,
  charges,
  partners,
  planPriceCents,
  asaasConfigured,
}: {
  tenantId: string
  billing: TenantBilling | null
  charges: BillingCharge[]
  partners: BillingPartner[]
  planPriceCents: number
  asaasConfigured: boolean
}) {
  const [cycle, setCycle] = useState<AsaasCycle>(billing?.billingCycle ?? 'MONTHLY')
  const [type, setType] = useState<AsaasBillingType>(billing?.billingType ?? 'UNDEFINED')
  const [partnerId, setPartnerId] = useState<string>(billing?.partnerId ?? '')
  const [price, setPrice] = useState<string>(
    billing?.priceCents !== null && billing?.priceCents !== undefined
      ? (billing.priceCents / 100).toFixed(2)
      : '',
  )
  const [dueDate, setDueDate] = useState<string>(billing?.nextDueDate ?? '')
  const [reissue, setReissue] = useState(false)
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const effective =
    price.trim() === '' ? planPriceCents : Math.round(Number(price.replace(',', '.')) * 100)

  function run(fn: () => Promise<{ ok: boolean; error?: string }>, okText: string) {
    setMsg(null)
    start(async () => {
      const res = await fn()
      setMsg(res.ok ? { kind: 'ok', text: okText } : { kind: 'err', text: res.error ?? 'Falha.' })
    })
  }

  return (
    <div className="rounded-xl border border-slate-200 bg-white p-4">
      <h3 className="mb-1 flex items-center gap-2 text-sm font-bold text-slate-900">
        <CreditCard className="h-4 w-4" />
        Cobrança da assinatura
      </h3>
      <p className="mb-4 text-xs text-slate-500">
        O que esta clínica paga à Clinni, cobrado pelo Asaas. Não confundir com o financeiro da
        clínica, que registra o que os pacientes pagam a ela.
      </p>

      {!asaasConfigured && (
        <p className="mb-3 rounded-md bg-[hsl(var(--warning))] px-3 py-2 text-xs text-[hsl(var(--warning-foreground))]">
          Asaas não configurado nesta instalação (<code>ASAAS_API_KEY</code>). Dá para salvar a
          configuração abaixo, mas nenhuma cobrança será emitida.
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div>
          <Label className="text-[11px] font-bold uppercase text-slate-500">Periodicidade</Label>
          <select
            value={cycle}
            onChange={(e) => setCycle(e.target.value as AsaasCycle)}
            className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
          >
            {CYCLES.map((c) => (
              <option key={c.v} value={c.v}>
                {c.l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-[11px] font-bold uppercase text-slate-500">
            Forma de pagamento
          </Label>
          <select
            value={type}
            onChange={(e) => setType(e.target.value as AsaasBillingType)}
            className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
          >
            {TYPES.map((t) => (
              <option key={t.v} value={t.v}>
                {t.l}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label className="text-[11px] font-bold uppercase text-slate-500">
            Valor negociado (opcional)
          </Label>
          <div className="flex items-center gap-1">
            <span className="text-xs text-slate-400">R$</span>
            <Input
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder={(planPriceCents / 100).toFixed(2)}
              inputMode="decimal"
            />
          </div>
          <p className="mt-1 text-[10px] text-slate-400">
            Vazio = preço de tabela do plano ({formatCurrency(planPriceCents)}). Vai cobrar{' '}
            <strong>{formatCurrency(Number.isFinite(effective) ? effective : 0)}</strong>.
          </p>
        </div>
        <div>
          <Label className="text-[11px] font-bold uppercase text-slate-500">
            Primeiro vencimento
          </Label>
          <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          <p className="mt-1 text-[10px] text-slate-400">Vazio = 7 dias a partir da ativação.</p>
        </div>
        <div className="md:col-span-2">
          <Label className="text-[11px] font-bold uppercase text-slate-500">Parceiro (split)</Label>
          <select
            value={partnerId}
            onChange={(e) => setPartnerId(e.target.value)}
            className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
          >
            <option value="">Sem parceiro — a Clinni recebe tudo</option>
            {partners.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
                {p.splitFixedCents !== null
                  ? ` — ${formatCurrency(p.splitFixedCents)} por cobrança`
                  : p.splitPercentBps !== null
                    ? ` — ${(p.splitPercentBps / 100).toFixed(2).replace('.', ',')}%`
                    : ' — sem regra de split'}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={pending}
          onClick={() =>
            run(
              () =>
                adminSaveTenantBillingAction(tenantId, {
                  billingCycle: cycle,
                  billingType: type,
                  priceCents: price.trim() === '' ? null : effective,
                  nextDueDate: dueDate || null,
                  partnerId: partnerId || null,
                }),
              'Configuração salva.',
            )
          }
        >
          {pending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
          Salvar configuração
        </Button>

        <Button
          size="sm"
          disabled={pending || !asaasConfigured}
          onClick={() =>
            run(
              () => adminStartSubscriptionAction(tenantId, reissue),
              billing?.asaasSubscriptionId
                ? 'Assinatura atualizada no Asaas.'
                : 'Assinatura criada no Asaas.',
            )
          }
        >
          <Zap className="mr-1 h-3.5 w-3.5" />
          {billing?.asaasSubscriptionId ? 'Atualizar no Asaas' : 'Ativar cobrança'}
        </Button>

        {billing?.asaasSubscriptionId && (
          <>
            <Button
              size="sm"
              variant="ghost"
              disabled={pending}
              onClick={() => run(() => adminSyncChargesAction(tenantId), 'Faturas reconciliadas.')}
            >
              <RefreshCw className="mr-1 h-3.5 w-3.5" />
              Reconciliar
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="text-destructive"
              disabled={pending}
              onClick={() =>
                run(() => adminCancelSubscriptionAction(tenantId), 'Assinatura cancelada.')
              }
            >
              <Trash2 className="mr-1 h-3.5 w-3.5" />
              Cancelar assinatura
            </Button>
          </>
        )}
      </div>

      {billing?.asaasSubscriptionId && (
        <label className="mt-2 flex items-center gap-2 text-xs text-slate-500">
          <input
            type="checkbox"
            checked={reissue}
            onChange={(e) => setReissue(e.target.checked)}
            className="h-3.5 w-3.5"
          />
          Reemitir também as faturas já geradas e ainda não pagas com o novo valor
        </label>
      )}

      {msg && (
        <p
          className={`mt-3 text-xs ${msg.kind === 'ok' ? 'text-success-text' : 'text-destructive'}`}
        >
          {msg.text}
        </p>
      )}

      <div className="mt-5">
        <h4 className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-500">Faturas</h4>
        {charges.length === 0 ? (
          <p className="text-xs text-slate-400">
            Nenhuma fatura ainda
            {billing?.asaasSubscriptionId ? ' — a primeira aparece quando o Asaas a gerar.' : '.'}
          </p>
        ) : (
          <ul className="divide-y divide-slate-100">
            {charges.map((c) => (
              <li key={c.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                <div className="min-w-0">
                  <p className="font-medium tabular-nums text-slate-900">
                    {formatCurrency(c.amountCents)}
                    <span className="ml-2 text-xs font-normal text-slate-400">
                      vence {c.dueDate.split('-').reverse().join('/')}
                    </span>
                  </p>
                  <p className="text-xs">
                    <span className={STATUS_TONE[c.status] ?? 'text-slate-500'}>
                      {CHARGE_STATUS_LABEL[c.status]}
                    </span>
                    {c.splitAmountCents !== null && (
                      <span className="text-slate-400">
                        {' '}
                        · split {formatCurrency(c.splitAmountCents)}
                      </span>
                    )}
                    {c.netAmountCents !== null && (
                      <span className="text-slate-400">
                        {' '}
                        · líquido {formatCurrency(c.netAmountCents)}
                      </span>
                    )}
                  </p>
                </div>
                {c.invoiceUrl && (
                  <a
                    href={c.invoiceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary hover:underline"
                  >
                    Fatura
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
