'use client'

import { useState } from 'react'
import { Activity, ChevronDown, ChevronUp } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { cn, formatDateTime } from '@/lib/utils'
import type { VitalSignsDTO } from '@/lib/core/patient-medical/vital-signs'

interface Props {
  /** Já vem ordenado por measured_at desc do helper listVitalSigns. */
  measurements: VitalSignsDTO[]
}

function bmiBadge(bmi: number | null): { label: string; className: string } | null {
  if (bmi === null) return null
  if (bmi < 18.5) return { label: 'Abaixo', className: 'bg-info-bg text-info-text' }
  if (bmi < 25) return { label: 'Normal', className: 'bg-success-bg text-success-text' }
  if (bmi < 30)
    return {
      label: 'Sobrepeso',
      className: 'bg-[hsl(var(--warning)/0.2)] text-[hsl(var(--warning-foreground))]',
    }
  return {
    label: 'Obeso',
    className: 'bg-[hsl(var(--alert)/0.15)] text-[hsl(var(--alert))]',
  }
}

const INITIAL_VISIBLE = 5

/**
 * Card compacto, read-only, mostrando o histórico completo de sinais
 * vitais registrados, em ordem cronológica decrescente. Renderizado
 * dentro de MedicalHistorySection (antecedentes) — para o profissional
 * ter o histórico de medições no mesmo bloco visual do histórico clínico
 * sem precisar rolar até a section completa de sinais vitais. Sem schema,
 * sem nova query — consome o array já carregado pela page.
 */
export function VitalHistoryCompactCard({ measurements }: Props) {
  const [expanded, setExpanded] = useState(false)
  const total = measurements.length
  const visible = expanded ? measurements : measurements.slice(0, INITIAL_VISIBLE)
  const hasMore = total > INITIAL_VISIBLE

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-4">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Activity className="h-4 w-4 text-rose-500" />
          Sinais vitais (histórico)
          {total > 0 ? (
            <Badge variant="secondary" className="h-5 px-1.5 text-[10px]">
              {total}
            </Badge>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="text-xs text-slate-500">Nenhum sinal vital registrado ainda.</p>
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border border-slate-200">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-[10px] uppercase tracking-widest">Data</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-widest">PA</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-widest">FC</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-widest">Peso</TableHead>
                    <TableHead className="text-[10px] uppercase tracking-widest">IMC</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((v) => {
                    const bmiInfo = bmiBadge(v.bmi)
                    return (
                      <TableRow key={v.id}>
                        <TableCell className="whitespace-nowrap text-[11px] font-mono text-slate-700">
                          {formatDateTime(v.measuredAt)}
                        </TableCell>
                        <TableCell className="text-xs text-slate-700">
                          {v.systolicBp && v.diastolicBp ? `${v.systolicBp}/${v.diastolicBp}` : '—'}
                        </TableCell>
                        <TableCell className="text-xs text-slate-700">
                          {v.heartRate ?? '—'}
                        </TableCell>
                        <TableCell className="text-xs text-slate-700">
                          {v.weightGrams !== null ? `${(v.weightGrams / 1000).toFixed(1)} kg` : '—'}
                        </TableCell>
                        <TableCell className="text-xs">
                          <span className="font-bold text-slate-700">
                            {v.bmi?.toFixed(1) ?? '—'}
                          </span>
                          {bmiInfo ? (
                            <span
                              className={cn(
                                'ml-1.5 rounded px-1 py-0.5 text-[8px] font-bold uppercase',
                                bmiInfo.className,
                              )}
                            >
                              {bmiInfo.label}
                            </span>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>
            {hasMore ? (
              <button
                type="button"
                onClick={() => setExpanded((v) => !v)}
                className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-primary hover:underline"
              >
                {expanded ? (
                  <>
                    <ChevronUp className="h-3 w-3" />
                    Mostrar apenas {INITIAL_VISIBLE} mais recentes
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3 w-3" />
                    Ver todos os {total} registros
                  </>
                )}
              </button>
            ) : null}
          </>
        )}
      </CardContent>
    </Card>
  )
}
