'use client'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { ClinicalRecordsSection, type AnamnesePatientPrefill } from '../../clinical-records-section'
import type { ClinicalRecordRow } from '@/lib/core/clinical-records/create'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  patientId: string
  patientName: string | null
  patientPrefill?: AnamnesePatientPrefill
  initialRecords: ClinicalRecordRow[]
  canApplyAnamnesis: boolean
  canDeleteAnamnese: boolean
}

export function NewAnamneseSheet({
  open,
  onOpenChange,
  patientId,
  patientName,
  patientPrefill,
  initialRecords,
  canApplyAnamnesis,
  canDeleteAnamnese,
}: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Nova anamnese</SheetTitle>
          <SheetDescription>
            Aplique um modelo de anamnese ao paciente. Campos padrão são pré-preenchidos com os
            dados do cadastro.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <ClinicalRecordsSection
            patientId={patientId}
            patientName={patientName}
            patientPrefill={patientPrefill}
            initialRecords={initialRecords}
            canWrite={false}
            canApplyAnamnesis={canApplyAnamnesis}
            canDeleteAnamnese={canDeleteAnamnese}
            defaultPane="anamnese"
            onSaved={() => onOpenChange(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
