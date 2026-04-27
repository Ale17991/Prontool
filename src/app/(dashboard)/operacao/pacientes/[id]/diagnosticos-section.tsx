import { Stethoscope } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDate } from '@/lib/utils'
import type { ClinicalRecordRow } from '@/lib/core/clinical-records/create'

/**
 * Mostra todos os CIDs registrados em evoluções SOAP do paciente,
 * deduplicados por code mantendo a ocorrência mais recente. Server
 * component — recebe os clinical_records já carregados pela página.
 */
export function DiagnosticsSection({ records }: { records: ClinicalRecordRow[] }) {
  const evolucoes = records.filter(
    (r) => r.type === 'evolucao' && r.soapData && !r.deletedAt,
  )

  const map = new Map<
    string,
    { code: string; description: string; latestAt: string; count: number }
  >()
  for (const r of evolucoes) {
    const cids = r.soapData?.assessment_cids ?? []
    for (const c of cids) {
      const existing = map.get(c.code)
      if (!existing) {
        map.set(c.code, {
          code: c.code,
          description: c.description,
          latestAt: r.createdAt,
          count: 1,
        })
      } else {
        existing.count += 1
        if (r.createdAt > existing.latestAt) existing.latestAt = r.createdAt
      }
    }
  }
  const items = Array.from(map.values()).sort((a, b) =>
    a.latestAt > b.latestAt ? -1 : a.latestAt < b.latestAt ? 1 : 0,
  )

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <Stethoscope className="h-4 w-4 text-primary" />
          Diagnósticos (CID-10)
        </CardTitle>
      </CardHeader>
      <CardContent className="p-0">
        {items.length === 0 ? (
          <p className="px-6 pb-6 text-sm text-slate-500">
            Nenhum CID registrado em evoluções. Vincule códigos no campo Avaliação
            ao registrar uma evolução SOAP.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Código</TableHead>
                <TableHead>Descrição</TableHead>
                <TableHead className="text-right">Ocorrências</TableHead>
                <TableHead>Última anotação</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {items.map((c) => (
                <TableRow key={c.code}>
                  <TableCell>
                    <span className="rounded-md bg-blue-100 px-2 py-1 font-mono text-[11px] font-bold text-blue-800">
                      {c.code}
                    </span>
                  </TableCell>
                  <TableCell className="text-sm text-slate-700">
                    {c.description}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">{c.count}</TableCell>
                  <TableCell className="text-xs text-slate-500">
                    {formatDate(c.latestAt)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  )
}
