'use client'

import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { VitalSignsSection } from '../../vital-signs-section'
import type { VitalSignsDTO } from '@/lib/core/patient-medical/vital-signs'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  patientId: string
  initialVitalSigns: VitalSignsDTO[]
  canWrite: boolean
}

export function NewVitalSheet({
  open,
  onOpenChange,
  patientId,
  initialVitalSigns,
  canWrite,
}: Props) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Registrar sinais vitais</SheetTitle>
          <SheetDescription>
            Pressão arterial, frequência cardíaca, peso, altura — IMC é calculado automaticamente.
          </SheetDescription>
        </SheetHeader>
        <div className="mt-4">
          <VitalSignsSection
            patientId={patientId}
            initial={initialVitalSigns}
            canWrite={canWrite}
            defaultShowForm
            onSaved={() => onOpenChange(false)}
          />
        </div>
      </SheetContent>
    </Sheet>
  )
}
