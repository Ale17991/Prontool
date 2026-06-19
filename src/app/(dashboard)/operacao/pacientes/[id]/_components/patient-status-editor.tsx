'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2, ShieldAlert } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

type PatientStatus = 'ativo' | 'inativo' | 'obito'

const STATUS_LABEL: Record<PatientStatus, string> = {
  ativo: 'Ativo',
  inativo: 'Inativo',
  obito: 'Óbito',
}

/**
 * Backlog 1/5 + 1/11 — define o status do paciente (ativo/inativo/óbito) e o
 * aviso (pop-up) por paciente. Status != ativo bloqueia agendamentos e
 * mensagens automáticas.
 */
export function PatientStatusEditor({
  patientId,
  status: initialStatus,
  alertNote: initialAlert,
  canEdit,
}: {
  patientId: string
  status: PatientStatus
  alertNote: string | null
  canEdit: boolean
}) {
  const router = useRouter()
  const [status, setStatus] = useState<PatientStatus>(initialStatus)
  const [alert, setAlert] = useState(initialAlert ?? '')
  const [pending, setPending] = useState(false)
  const [msg, setMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const dirty = status !== initialStatus || (alert.trim() || '') !== (initialAlert ?? '')

  async function save() {
    setError(null)
    setMsg(null)
    setPending(true)
    try {
      const res = await fetch(`/api/pacientes/${patientId}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status, alert_note: alert.trim() || null }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(body.error?.message ?? 'Falha ao salvar.')
        return
      }
      setMsg('Salvo.')
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <ShieldAlert className="h-4 w-4 text-primary" />
          Situação e aviso do paciente
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <Label className="text-[11px] font-bold uppercase text-slate-500">Situação</Label>
          {canEdit ? (
            <Select value={status} onValueChange={(v) => setStatus(v as PatientStatus)}>
              <SelectTrigger className="w-48">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="ativo">Ativo</SelectItem>
                <SelectItem value="inativo">Inativo</SelectItem>
                <SelectItem value="obito">Óbito</SelectItem>
              </SelectContent>
            </Select>
          ) : (
            <p className="text-sm font-semibold text-slate-800">{STATUS_LABEL[status]}</p>
          )}
          <p className="mt-1 text-[11px] text-slate-500">
            Inativo ou óbito bloqueia novos agendamentos e mensagens automáticas.
          </p>
        </div>

        <div>
          <Label className="text-[11px] font-bold uppercase text-slate-500">
            Aviso (aparece ao abrir a ficha)
          </Label>
          {canEdit ? (
            <Textarea
              value={alert}
              onChange={(e) => setAlert(e.target.value)}
              maxLength={1000}
              rows={3}
              placeholder="Ex.: paciente alérgico a látex; sempre confirmar acompanhante."
            />
          ) : (
            <p className="whitespace-pre-wrap text-sm text-slate-700">{alert || '—'}</p>
          )}
        </div>

        {error ? <p className="text-xs font-semibold text-destructive">{error}</p> : null}
        {msg ? <p className="text-xs font-semibold text-success-text">{msg}</p> : null}

        {canEdit ? (
          <Button type="button" onClick={save} disabled={pending || !dirty} className="gap-2">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Salvar
          </Button>
        ) : null}
      </CardContent>
    </Card>
  )
}
