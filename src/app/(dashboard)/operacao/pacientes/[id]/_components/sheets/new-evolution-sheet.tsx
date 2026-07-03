'use client'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { ClinicalRecordsSection } from '../../clinical-records-section'
import type { ClinicalRecordRow } from '@/lib/core/clinical-records/create'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  patientId: string
  patientName: string | null
  initialRecords: ClinicalRecordRow[]
  canWrite: boolean
  canDeleteAnamnese: boolean
}

/**
 * Sheet dedicado para registrar evolução SOAP. Mounta a section existente
 * em modo "pane=evolucao" para reusar todo o form sem duplicar código.
 */
export function NewEvolutionSheet({
  open,
  onOpenChange,
  patientId,
  patientName,
  initialRecords,
  canWrite,
  canDeleteAnamnese,
}: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Nova evolução SOAP</SheetTitle>
          <SheetDescription>
            Registre uma evolução clínica do paciente. Subjetivo e Avaliação são obrigatórios; CIDs
            podem ser vinculados na seção A.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <ClinicalRecordsSection
            patientId={patientId}
            patientName={patientName}
            initialRecords={initialRecords}
            canWrite={canWrite}
            canApplyAnamnesis={false}
            canDeleteAnamnese={canDeleteAnamnese}
            defaultPane="evolucao"
            onSaved={() => onOpenChange(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
