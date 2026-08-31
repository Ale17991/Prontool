'use client'

import { useState, useTransition } from 'react'
import { Handshake, Loader2, Plus, Wallet } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatCurrency } from '@/lib/utils'
import type { BillingPartner } from '@/lib/core/billing/partners'
import { adminSavePartnerAction } from './billing-actions'
import { PartnerKeysPanel } from './partner-keys'

/**
 * Parceiros que recebem split da assinatura (ex.: zee.lu).
 *
 * A tela oferece percentual OU valor fixo, nunca os dois — a exclusão existe no
 * banco (CHECK) e no serviço, e repeti-la aqui evita que quem cadastra escreva
 * duas regras e descubra o conflito só no erro de constraint.
 */

interface PartnerTotals {
  partnerId: string
  charges: number
  splitCents: number
  grossCents: number
}

type SplitMode = 'percent' | 'fixed'

const EMPTY = {
  id: undefined as string | undefined,
  name: '',
  slug: '',
  wallet: '',
  mode: 'percent' as SplitMode,
  percent: '',
  fixed: '',
  status: 'active' as 'active' | 'inactive',
}

export function PartnersSection({
  partners,
  totals,
}: {
  partners: BillingPartner[]
  totals: PartnerTotals[]
}) {
  const [form, setForm] = useState({ ...EMPTY })
  const [open, setOpen] = useState(false)
  const [pending, start] = useTransition()
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  const totalsById = new Map(totals.map((t) => [t.partnerId, t]))

  function edit(p: BillingPartner) {
    setForm({
      id: p.id,
      name: p.name,
      slug: p.slug,
      wallet: p.asaasWalletId ?? '',
      mode: p.splitFixedCents !== null ? 'fixed' : 'percent',
      percent: p.splitPercentBps !== null ? (p.splitPercentBps / 100).toFixed(2) : '',
      fixed: p.splitFixedCents !== null ? (p.splitFixedCents / 100).toFixed(2) : '',
      status: p.status,
    })
    setMsg(null)
    setOpen(true)
  }

  function save() {
    setMsg(null)
    start(async () => {
      const percentBps =
        form.mode === 'percent' && form.percent.trim()
          ? Math.round(Number(form.percent.replace(',', '.')) * 100)
          : null
      const fixedCents =
        form.mode === 'fixed' && form.fixed.trim()
          ? Math.round(Number(form.fixed.replace(',', '.')) * 100)
          : null

      const res = await adminSavePartnerAction({
        id: form.id,
        name: form.name,
        slug: form.slug.trim().toLowerCase(),
        asaasWalletId: form.wallet.trim() || null,
        splitPercentBps: percentBps,
        splitFixedCents: fixedCents,
        status: form.status,
      })
      if (!res.ok) {
        setMsg({ kind: 'err', text: res.error })
        return
      }
      setMsg({ kind: 'ok', text: 'Parceiro salvo.' })
      setForm({ ...EMPTY })
      setOpen(false)
    })
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900">
          <Handshake className="h-4 w-4" />
          Parceiros e split
        </h3>
        <Button
          size="sm"
          variant="outline"
          onClick={() => {
            setForm({ ...EMPTY })
            setMsg(null)
            setOpen((v) => !v)
          }}
        >
          <Plus className="mr-1 h-3.5 w-3.5" />
          Novo parceiro
        </Button>
      </div>

      <p className="mb-3 text-xs text-slate-500">
        Parte da assinatura vai direto para a carteira do parceiro, dividida pelo próprio Asaas.{' '}
        <strong className="text-slate-700">
          Quanto cada clínica repassa é definido na página dela
        </strong>
        , porque depende do plano que ela contratou do parceiro — o valor abaixo é só o padrão,
        usado quando a clínica não tem o próprio. O que foi dividido fica gravado na fatura: mudar a
        regra não altera o que já foi cobrado.
      </p>

      {partners.length === 0 ? (
        <p className="text-xs text-slate-400">Nenhum parceiro cadastrado.</p>
      ) : (
        <ul className="divide-y divide-slate-100">
          {partners.map((p) => {
            const t = totalsById.get(p.id)
            return (
              <li key={p.id} className="py-2 text-sm">
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium text-slate-900">
                      {p.name}
                      <span className="ml-2 text-xs font-normal text-slate-400">{p.slug}</span>
                      {p.status === 'inactive' && (
                        <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-500">
                          inativo
                        </span>
                      )}
                    </p>
                    <p className="flex items-center gap-1 text-xs text-slate-500">
                      <Wallet className="h-3 w-3" />
                      {p.asaasWalletId ? (
                        <span className="font-mono text-[11px]">
                          {p.asaasWalletId.slice(0, 12)}…
                        </span>
                      ) : (
                        <span className="text-[hsl(var(--warning-foreground))]">
                          sem carteira — não recebe split
                        </span>
                      )}
                      <span className="text-slate-300">·</span>
                      {p.splitFixedCents !== null
                        ? `${formatCurrency(p.splitFixedCents)} por cobrança`
                        : p.splitPercentBps !== null
                          ? `${(p.splitPercentBps / 100).toFixed(2).replace('.', ',')}%`
                          : 'sem regra'}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    {t && (
                      <span className="text-right text-xs text-slate-500">
                        <span className="block font-semibold tabular-nums text-slate-900">
                          {formatCurrency(t.splitCents)}
                        </span>
                        {t.charges} cobrança{t.charges === 1 ? '' : 's'} paga
                        {t.charges === 1 ? '' : 's'}
                      </span>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => edit(p)}>
                      Editar
                    </Button>
                  </div>
                </div>
                <PartnerKeysPanel partnerId={p.id} partnerName={p.name} />
              </li>
            )
          })}
        </ul>
      )}

      {open && (
        <div className="mt-4 space-y-3 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <Label className="text-[11px] font-bold uppercase text-slate-500">Nome</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="zee.lu"
              />
            </div>
            <div>
              <Label className="text-[11px] font-bold uppercase text-slate-500">
                Identificador
              </Label>
              <Input
                value={form.slug}
                onChange={(e) => setForm({ ...form, slug: e.target.value })}
                placeholder="zeelu"
                disabled={Boolean(form.id)}
              />
              <p className="mt-1 text-[10px] text-slate-400">
                Usado pela integração. Não muda depois de criado.
              </p>
            </div>
          </div>

          <div>
            <Label className="text-[11px] font-bold uppercase text-slate-500">
              Carteira Asaas (walletId)
            </Label>
            <Input
              value={form.wallet}
              onChange={(e) => setForm({ ...form, wallet: e.target.value })}
              placeholder="00000000-0000-0000-0000-000000000000"
              className="font-mono text-xs"
            />
            <p className="mt-1 text-[10px] text-slate-400">
              Sem carteira o parceiro fica cadastrado mas nada é dividido para ele.
            </p>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <Label className="text-[11px] font-bold uppercase text-slate-500">
                Tipo do padrão
              </Label>
              <select
                value={form.mode}
                onChange={(e) => setForm({ ...form, mode: e.target.value as SplitMode })}
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
              >
                <option value="percent">Percentual</option>
                <option value="fixed">Valor fixo</option>
              </select>
            </div>
            {form.mode === 'percent' ? (
              <div>
                <Label className="text-[11px] font-bold uppercase text-slate-500">
                  % por cobrança
                </Label>
                <Input
                  value={form.percent}
                  onChange={(e) => setForm({ ...form, percent: e.target.value })}
                  placeholder="25,00"
                  inputMode="decimal"
                />
              </div>
            ) : (
              <div>
                <Label className="text-[11px] font-bold uppercase text-slate-500">R$ padrão</Label>
                <Input
                  value={form.fixed}
                  onChange={(e) => setForm({ ...form, fixed: e.target.value })}
                  placeholder="30,00"
                  inputMode="decimal"
                />
              </div>
            )}
            <div>
              <Label className="text-[11px] font-bold uppercase text-slate-500">Situação</Label>
              <select
                value={form.status}
                onChange={(e) =>
                  setForm({ ...form, status: e.target.value as 'active' | 'inactive' })
                }
                className="h-9 w-full rounded-md border border-slate-200 bg-white px-2 text-sm"
              >
                <option value="active">Ativo</option>
                <option value="inactive">Inativo (não divide)</option>
              </select>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <Button size="sm" onClick={save} disabled={pending}>
              {pending && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" />}
              Salvar parceiro
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancelar
            </Button>
            {msg && (
              <span
                className={
                  msg.kind === 'ok' ? 'text-xs text-success-text' : 'text-xs text-destructive'
                }
              >
                {msg.text}
              </span>
            )}
          </div>
        </div>
      )}
    </section>
  )
}
