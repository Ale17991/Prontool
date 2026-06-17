'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { Check, CreditCard, Loader2, Pencil, X } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/**
 * Feature 029 (US2) — captura da carteira do beneficiário para o plano atual.
 * O número completo nunca volta ao browser: a API devolve apenas mascarado
 * (últimos 4) + validade. Para atualizar, digita-se o número de novo (cartão
 * em mãos). Aparece só quando o paciente tem um convênio selecionado.
 */

interface CardStatus {
  hasCard: boolean
  cardNumberMasked: string | null
  cardValidUntil: string | null
}

export function PatientCardEditor({
  patientId,
  healthPlanId,
  canEdit,
}: {
  patientId: string
  healthPlanId: string
  canEdit: boolean
}) {
  const router = useRouter()
  const [status, setStatus] = useState<CardStatus | null>(null)
  const [editing, setEditing] = useState(false)
  const [cardNumber, setCardNumber] = useState('')
  const [validUntil, setValidUntil] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let active = true
    setStatus(null)
    fetch(
      `/api/pacientes/${patientId}/health-plan-cards?health_plan_id=${healthPlanId}`,
    )
      .then((r) => (r.ok ? r.json() : null))
      .then((data: CardStatus | null) => {
        if (active && data) {
          setStatus(data)
          setValidUntil(data.cardValidUntil ?? '')
        }
      })
      .catch(() => {})
    return () => {
      active = false
    }
  }, [patientId, healthPlanId])

  async function save() {
    setError(null)
    if (cardNumber.trim().length === 0) {
      setError('Informe o número da carteira.')
      return
    }
    setSaving(true)
    try {
      const res = await fetch(`/api/pacientes/${patientId}/health-plan-cards`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          health_plan_id: healthPlanId,
          card_number: cardNumber.trim(),
          card_valid_until: validUntil || null,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(body.error?.message ?? 'Falha ao salvar a carteira.')
        return
      }
      setEditing(false)
      setCardNumber('')
      router.refresh()
      // Re-busca status mascarado.
      const fresh = await fetch(
        `/api/pacientes/${patientId}/health-plan-cards?health_plan_id=${healthPlanId}`,
      )
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
      if (fresh) setStatus(fresh as CardStatus)
    } finally {
      setSaving(false)
    }
  }

  if (!editing) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-100 pt-3">
        <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-widest text-slate-400">
          <CreditCard className="h-3.5 w-3.5" /> Carteira (TISS)
        </span>
        {status?.hasCard ? (
          <Badge variant="secondary" className="font-mono text-xs">
            {status.cardNumberMasked}
            {status.cardValidUntil ? ` · val. ${formatDate(status.cardValidUntil)}` : ''}
          </Badge>
        ) : (
          <Badge variant="warning" className="text-xs">
            Sem carteira
          </Badge>
        )}
        {canEdit ? (
          <button
            type="button"
            onClick={() => setEditing(true)}
            className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-widest text-slate-400 hover:text-slate-700"
          >
            <Pencil className="h-3 w-3" /> {status?.hasCard ? 'Atualizar' : 'Cadastrar'}
          </button>
        ) : null}
      </div>
    )
  }

  return (
    <div className="mt-3 space-y-2 border-t border-slate-100 pt-3">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
        <div className="space-y-1">
          <Label htmlFor="card-number" className="text-xs">
            Número da carteira
          </Label>
          <Input
            id="card-number"
            value={cardNumber}
            onChange={(e) => setCardNumber(e.target.value)}
            placeholder="Número impresso no cartão do convênio"
            autoFocus
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="card-valid" className="text-xs">
            Validade (opcional)
          </Label>
          <Input
            id="card-valid"
            type="date"
            value={validUntil}
            onChange={(e) => setValidUntil(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => void save()}
            disabled={saving}
            className="inline-flex h-9 items-center gap-1 rounded-md bg-slate-900 px-3 text-[11px] font-bold text-white hover:bg-slate-800 disabled:opacity-60"
          >
            {saving ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Check className="h-3 w-3" />
            )}
            Salvar
          </button>
          <button
            type="button"
            onClick={() => {
              setEditing(false)
              setCardNumber('')
              setValidUntil(status?.cardValidUntil ?? '')
              setError(null)
            }}
            className="inline-flex h-9 items-center rounded-md border border-slate-200 bg-white px-2 text-[11px] font-bold text-slate-600 hover:bg-slate-50"
          >
            <X className="h-3 w-3" />
          </button>
        </div>
      </div>
      {error ? <p className="text-[11px] font-semibold text-destructive">{error}</p> : null}
    </div>
  )
}

function formatDate(ymd: string): string {
  const [y, m, d] = ymd.split('-')
  if (!y || !m || !d) return ymd
  return `${d}/${m}/${y}`
}
