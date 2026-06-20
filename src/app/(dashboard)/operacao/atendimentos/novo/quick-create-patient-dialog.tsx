'use client'

import { useState } from 'react'
import { Loader2, UserPlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { PatientTypeaheadValue } from '@/components/patients/patient-typeahead'

export interface QuickCreatePatientDialogProps {
  /** Convênios ativos (id + nome). */
  plans: Array<{ id: string; label: string }>
  /** Chamado com o paciente recém-criado (para selecioná-lo no form). */
  onCreated: (patient: PatientTypeaheadValue) => void
  disabled?: boolean
}

const PARTICULAR = '__particular__'

/**
 * Backlog 1/2 — criação rápida de paciente a partir do agendamento:
 * nome, convênio e telefone. Cria via POST /api/pacientes e devolve o paciente
 * para o form selecioná-lo. Cadastro completo continua em /operacao/pacientes.
 */
export function QuickCreatePatientDialog({ plans, onCreated, disabled }: QuickCreatePatientDialogProps) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [planId, setPlanId] = useState<string>(PARTICULAR)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function submit() {
    setError(null)
    if (name.trim().length < 2) {
      setError('Informe o nome (mínimo 2 caracteres).')
      return
    }
    setPending(true)
    try {
      const resolvedPlan = planId === PARTICULAR ? null : planId
      const res = await fetch('/api/pacientes', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          full_name: name.trim(),
          phone: phone.trim() || null,
          plan_id: resolvedPlan,
        }),
      })
      if (!res.ok) {
        const b = (await res.json().catch(() => ({}))) as { error?: { message?: string } }
        setError(b.error?.message ?? 'Falha ao cadastrar o paciente.')
        return
      }
      const body = (await res.json().catch(() => ({}))) as { patientId?: string }
      if (!body.patientId) {
        setError('Resposta inesperada do servidor.')
        return
      }
      onCreated({
        id: body.patientId,
        fullName: name.trim(),
        cpf: '',
        planId: resolvedPlan,
        planName: resolvedPlan ? plans.find((p) => p.id === resolvedPlan)?.label ?? null : null,
        tags: [],
      })
      setName('')
      setPhone('')
      setPlanId(PARTICULAR)
      setOpen(false)
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="ghost" size="sm" className="h-7 gap-1.5 px-2 text-xs" disabled={disabled}>
          <UserPlus className="h-3.5 w-3.5" /> Cadastrar novo
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Cadastro rápido de paciente</DialogTitle>
          <DialogDescription>
            Cadastre o essencial para agendar agora. Os demais dados podem ser completados
            depois na ficha do paciente.
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label htmlFor="qc-name">Nome</Label>
            <Input id="qc-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <Label htmlFor="qc-phone">Telefone</Label>
            <Input id="qc-phone" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="(00) 00000-0000" />
          </div>
          <div>
            <Label>Convênio</Label>
            <Select value={planId} onValueChange={setPlanId}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={PARTICULAR}>Particular</SelectItem>
                {plans.map((p) => (
                  <SelectItem key={p.id} value={p.id}>{p.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {error ? <p className="text-xs font-semibold text-destructive">{error}</p> : null}
        </div>
        <DialogFooter className="gap-2 sm:gap-2">
          <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={pending}>
            Cancelar
          </Button>
          <Button type="button" onClick={submit} disabled={pending} className="gap-2">
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Cadastrar e selecionar
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
