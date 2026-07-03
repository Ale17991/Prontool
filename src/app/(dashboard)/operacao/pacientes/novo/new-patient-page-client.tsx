'use client'

import { useState } from 'react'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { NewPatientForm } from './new-patient-form'
import { NewPatientWithAnamneseForm } from './new-patient-with-anamnese-form'

export type FieldType =
  | 'texto_curto'
  | 'texto_longo'
  | 'checkbox'
  | 'radio'
  | 'select'
  | 'data'
  | 'numero'

export interface AnamnesisField {
  id: string
  type: FieldType
  label: string
  required: boolean
  options?: string[]
  is_default?: boolean
}

export interface HealthPlanOption {
  id: string
  name: string
}

export interface AnamnesisTemplateOption {
  id: string
  title: string
  description: string | null
  version: number
  fields: AnamnesisField[]
}

interface Props {
  healthPlans: HealthPlanOption[]
  templates: AnamnesisTemplateOption[]
}

const BLANK = '__blank__'

export function NewPatientPageClient({ healthPlans, templates }: Props) {
  const [selected, setSelected] = useState<string>(BLANK)
  const template = templates.find((t) => t.id === selected) ?? null

  return (
    <div className="space-y-6">
      <div className="space-y-1.5">
        <Label htmlFor="template_select">Usar modelo de anamnese</Label>
        <Select value={selected} onValueChange={setSelected}>
          <SelectTrigger id="template_select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={BLANK}>Em branco — só dados cadastrais</SelectItem>
            {templates.length === 0 ? (
              <SelectItem value="__none_disabled__" disabled>
                Nenhum modelo ativo cadastrado
              </SelectItem>
            ) : (
              templates.map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.title}
                  <span className="ml-1 text-[10px] text-slate-400">v{t.version}</span>
                </SelectItem>
              ))
            )}
          </SelectContent>
        </Select>
        {template?.description ? (
          <p className="text-[11px] text-slate-500">{template.description}</p>
        ) : null}
      </div>

      {template ? (
        <NewPatientWithAnamneseForm template={template} healthPlans={healthPlans} />
      ) : (
        <NewPatientForm healthPlans={healthPlans} />
      )}
    </div>
  )
}
