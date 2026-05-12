'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

interface Props {
  procedureId: string
  active: boolean
  displayName: string | null
  defaultAmountCents: number | null
  coveredByPlan: boolean
  /** Codigo exibido (TUSS ou personalizado ou "Não listado") — somente
   * pra confirmacao da remocao. */
  codeLabel: string
}

/**
 * Acoes da linha do procedimento na pagina /configuracoes/procedimentos.
 * Agrupa Editar, Desativar/Ativar e Remover no canto direito da linha.
 *
 *  - Editar abre um Dialog com display_name, valor particular e cobertura.
 *  - Desativar/Ativar e um toggle imediato (PATCH active).
 *  - Remover faz soft delete via DELETE — bloqueado por window.confirm pra
 *    evitar acidente. Soft-deleted some das listagens (procedimentos,
 *    atendimentos, convenios, planos de tratamento) preservando os FKs
 *    historicos (appointments, price_versions).
 */
export function ProcedureRowActions({
  procedureId,
  active,
  displayName,
  defaultAmountCents,
  coveredByPlan,
  codeLabel,
}: Props) {
  const router = useRouter()
  const [editing, setEditing] = useState(false)
  const [pendingToggle, setPendingToggle] = useState(false)
  const [pendingDelete, setPendingDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onToggle() {
    setPendingToggle(true)
    setError(null)
    try {
      const res = await fetch(`/api/procedimentos/${procedureId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ active: !active }),
      })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        throw new Error(payload.error?.message ?? `HTTP ${res.status}`)
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPendingToggle(false)
    }
  }

  async function onDelete() {
    const confirmed = window.confirm(
      `Remover o procedimento ${codeLabel}?\n\n` +
        `Atendimentos e preços históricos são preservados, mas ele não aparecerá ` +
        `mais nas listas de seleção. Esta ação só pode ser desfeita pelo administrador no banco de dados.`,
    )
    if (!confirmed) return
    setPendingDelete(true)
    setError(null)
    try {
      const res = await fetch(`/api/procedimentos/${procedureId}`, { method: 'DELETE' })
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        throw new Error(payload.error?.message ?? `HTTP ${res.status}`)
      }
      router.refresh()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setPendingDelete(false)
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center justify-end gap-1.5">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => setEditing(true)}
          className="h-8 gap-1.5 px-2 text-slate-600 hover:text-primary"
          title="Editar procedimento"
        >
          <Pencil className="h-3.5 w-3.5" />
          Editar
        </Button>
        <Button
          type="button"
          variant={active ? 'outline' : 'default'}
          size="sm"
          onClick={onToggle}
          disabled={pendingToggle || pendingDelete}
          className="h-8"
        >
          {pendingToggle ? '…' : active ? 'Desativar' : 'Ativar'}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onDelete}
          disabled={pendingDelete || pendingToggle}
          className="h-8 gap-1.5 px-2 text-rose-600 hover:bg-rose-50 hover:text-rose-700"
          title="Remover procedimento"
        >
          {pendingDelete ? (
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
          ) : (
            <Trash2 className="h-3.5 w-3.5" />
          )}
          Remover
        </Button>
      </div>
      {error ? (
        <span className="text-[10px] text-rose-600" title={error}>
          {error}
        </span>
      ) : null}

      <EditProcedureDialog
        open={editing}
        onOpenChange={setEditing}
        procedureId={procedureId}
        initialDisplayName={displayName}
        initialDefaultAmountCents={defaultAmountCents}
        initialCoveredByPlan={coveredByPlan}
        onSaved={() => {
          setEditing(false)
          router.refresh()
        }}
      />
    </div>
  )
}

function EditProcedureDialog({
  open,
  onOpenChange,
  procedureId,
  initialDisplayName,
  initialDefaultAmountCents,
  initialCoveredByPlan,
  onSaved,
}: {
  open: boolean
  onOpenChange: (v: boolean) => void
  procedureId: string
  initialDisplayName: string | null
  initialDefaultAmountCents: number | null
  initialCoveredByPlan: boolean
  onSaved: () => void
}) {
  const [displayName, setDisplayName] = useState(initialDisplayName ?? '')
  const [amount, setAmount] = useState(
    initialDefaultAmountCents !== null
      ? (initialDefaultAmountCents / 100).toFixed(2).replace('.', ',')
      : '',
  )
  const [covered, setCovered] = useState(initialCoveredByPlan)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function save() {
    setError(null)
    let amountCents: number | null = null
    const trimmed = amount.trim().replace(',', '.')
    if (trimmed.length > 0) {
      const parsed = Number(trimmed)
      if (!Number.isFinite(parsed) || parsed < 0) {
        setError('Valor particular inválido.')
        return
      }
      amountCents = Math.round(parsed * 100)
    }
    setPending(true)
    try {
      const res = await fetch(`/api/procedimentos/${procedureId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          display_name: displayName.trim() || null,
          default_amount_cents: amountCents,
          covered_by_plan: covered,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(body.error?.message ?? 'Falha ao salvar')
        return
      }
      onSaved()
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Editar procedimento</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="edit-display-name" className="text-xs">
              Nome de exibição
            </Label>
            <Input
              id="edit-display-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Ex.: Consulta oftalmológica"
              maxLength={120}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="edit-amount" className="text-xs">
              Valor particular (R$){' '}
              <span className="text-slate-400">(opcional)</span>
            </Label>
            <Input
              id="edit-amount"
              inputMode="decimal"
              placeholder="Ex.: 180,00"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>
          <label className="flex items-start gap-2 rounded-md border border-slate-200 bg-slate-50/50 px-3 py-2 text-xs">
            <input
              type="checkbox"
              checked={covered}
              onChange={(e) => setCovered(e.target.checked)}
              className="mt-0.5 h-4 w-4"
            />
            <span>
              <span className="font-semibold text-slate-900">
                Coberto pelo plano de saúde
              </span>
              <span className="block text-slate-500">
                Quando desmarcado, este procedimento é sempre particular.
              </span>
            </span>
          </label>

          {error ? (
            <p className="rounded-md border border-rose-100 bg-rose-50 p-2 text-xs font-medium text-rose-700">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => onOpenChange(false)}
              disabled={pending}
            >
              Cancelar
            </Button>
            <Button type="button" size="sm" onClick={save} disabled={pending}>
              {pending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : 'Salvar'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
