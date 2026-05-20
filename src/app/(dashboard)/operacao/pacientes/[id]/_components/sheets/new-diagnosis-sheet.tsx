'use client'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { DiagnosticsSection } from '../../diagnosticos-section'
import type { PatientDiagnosisDTO } from '@/lib/core/patient-medical/diagnoses'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  patientId: string
  initialDiagnoses: PatientDiagnosisDTO[]
  canWrite: boolean
  canDelete: boolean
}

export function NewDiagnosisSheet({
  open,
  onOpenChange,
  patientId,
  initialDiagnoses,
  canWrite,
  canDelete,
}: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full overflow-y-auto sm:max-w-xl"
      >
        <SheetHeader>
          <SheetTitle>Novo diagnóstico</SheetTitle>
          <SheetDescription>
            Vincule um código CID-10. Diagnósticos ativos e em
            acompanhamento aparecem na sidebar.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <DiagnosticsSection
            patientId={patientId}
            initialDiagnoses={initialDiagnoses}
            canWrite={canWrite}
            canDelete={canDelete}
            defaultShowForm
            onSaved={() => onOpenChange(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
