'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Loader2, Trash2 } from 'lucide-react'
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

export function PatientCleanupButton({ patientId }: { patientId: string }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [removeAnamneses, setRemoveAnamneses] = useState(false)
  const [removeRecords, setRemoveRecords] = useState(false)
  const [removeSteps, setRemoveSteps] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    anamneses: number
    records: number
    steps: number
  } | null>(null)

  const anyChecked = removeAnamneses || removeRecords || removeSteps

  function reset() {
    setRemoveAnamneses(false)
    setRemoveRecords(false)
    setRemoveSteps(false)
    setError(null)
    setResult(null)
  }

  async function onConfirm() {
    setError(null)
    setResult(null)
    setPending(true)
    try {
      const res = await fetch(`/api/pacientes/${patientId}/limpar`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          remove_anamneses: removeAnamneses,
          remove_records: removeRecords,
          remove_steps: removeSteps,
        }),
      })
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as {
          error?: { message?: string }
        }
        setError(body.error?.message ?? 'Falha ao limpar dados.')
        return
      }
      const body = (await res.json()) as {
        anamneses: number
        records: number
        steps: number
      }
      setResult(body)
      router.refresh()
    } finally {
      setPending(false)
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) reset()
      }}
    >
      <DialogTrigger asChild>
        <Button
          size="sm"
          variant="outline"
          className="gap-1.5 text-destructive hover:bg-destructive/10 hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
          Limpar dados
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 text-destructive" />
            Limpar dados do paciente
          </DialogTitle>
          <DialogDescription>
            Remove dados clínicos selecionados via soft-delete (deleted_at). Cada remoção é
            registrada na trilha de auditoria.
          </DialogDescription>
        </DialogHeader>

        {result ? (
          <div className="space-y-2 rounded-md border border-success/30 bg-success-bg px-4 py-3 text-sm text-success-text">
            <p className="font-bold">Limpeza concluída.</p>
            <ul className="list-disc pl-5 text-xs">
              {removeAnamneses ? <li>{result.anamneses} anamnese(s) removida(s)</li> : null}
              {removeRecords ? <li>{result.records} registro(s) removido(s)</li> : null}
              {removeSteps ? <li>{result.steps} etapa(s) removida(s)</li> : null}
            </ul>
          </div>
        ) : (
          <div className="space-y-3">
            <CleanupCheckbox
              id="cleanup_anamneses"
              checked={removeAnamneses}
              onChange={setRemoveAnamneses}
              label="Remover anamneses preenchidas"
              description="Soft-delete em clinical_records type='anamnese'."
            />
            <CleanupCheckbox
              id="cleanup_records"
              checked={removeRecords}
              onChange={setRemoveRecords}
              label="Remover registros da ficha clínica"
              description="Soft-delete em clinical_records type='texto' ou 'arquivo'."
            />
            <CleanupCheckbox
              id="cleanup_steps"
              checked={removeSteps}
              onChange={setRemoveSteps}
              label="Remover etapas do plano de tratamento"
              description="Soft-delete em treatment_plan_steps."
            />

            <div className="rounded-md border border-warning/30 bg-[hsl(var(--warning)/0.1)] px-3 py-2 text-[11px] text-[hsl(var(--warning-foreground))]">
              Os dados de atendimento e faturamento <strong>NÃO</strong> serão removidos pois são
              protegidos por lei.
            </div>

            {error ? (
              <div className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs font-semibold text-destructive">
                {error}
              </div>
            ) : null}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {result ? (
            <Button variant="outline" onClick={() => setOpen(false)}>
              Fechar
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => setOpen(false)} disabled={pending}>
                Cancelar
              </Button>
              <Button
                onClick={() => void onConfirm()}
                disabled={!anyChecked || pending}
                className="gap-2 bg-rose-600 hover:bg-rose-700"
              >
                {pending ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="h-4 w-4" />
                )}
                Confirmar limpeza
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

function CleanupCheckbox({
  id,
  checked,
  onChange,
  label,
  description,
}: {
  id: string
  checked: boolean
  onChange: (v: boolean) => void
  label: string
  description: string
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-3 rounded-md border border-slate-200 bg-white px-3 py-2 transition-colors hover:bg-slate-50"
    >
      <input
        id={id}
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-1 h-4 w-4"
      />
      <div className="space-y-0.5">
        <p className="text-sm font-semibold text-slate-900">{label}</p>
        <p className="text-[11px] text-slate-500">{description}</p>
      </div>
    </label>
  )
}
