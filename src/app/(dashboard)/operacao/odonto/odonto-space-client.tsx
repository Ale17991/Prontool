'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { PatientTypeahead, type PatientTypeaheadValue } from '@/components/patients/patient-typeahead'
import { OdontoSpace } from '@/app/(dashboard)/operacao/pacientes/[id]/_components/odontogram/odonto-space'

/**
 * Feature 039/041 — entrada dedicada do Odonto-Space pela sidebar (gated por
 * `odonto`). Seleciona o paciente e renderiza o mesmo hub (odontograma / plano
 * de tratamento / periograma) que existe no prontuário.
 */
export function OdontoSpaceClient({
  canWriteClinical,
  canWriteTreatment,
}: {
  canWriteClinical: boolean
  canWriteTreatment: boolean
}) {
  const [patient, setPatient] = useState<PatientTypeaheadValue | null>(null)

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Paciente</CardTitle>
        </CardHeader>
        <CardContent>
          <PatientTypeahead value={patient?.id ?? null} onChange={setPatient} />
        </CardContent>
      </Card>

      {patient ? (
        <OdontoSpace
          patientId={patient.id}
          canWriteClinical={canWriteClinical}
          canWriteTreatment={canWriteTreatment}
        />
      ) : (
        <p className="text-sm text-slate-400">Selecione um paciente para ver o odontograma, plano e periograma.</p>
      )}
    </div>
  )
}
