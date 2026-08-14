import { Beaker } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { LabResultItem } from '@/lib/core/labs/classify'
import { cn } from '@/lib/utils'

/**
 * Feature 050 US3 — exames laboratoriais no portal do paciente.
 *
 * Postura da seção (já registrada na def em `sections.ts`): resultado COM
 * interpretação, nunca o valor cru isolado. O paciente vê valor, data e
 * "normal" ou "alterado" — sem percentual, sem a faixa crua e sem alarmismo.
 * Quem explica o que fazer é a equipe, não a tela.
 */

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/\.?0+$/, '')
}

function formatDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso
}

export function LabResultsCard({ items }: { items: LabResultItem[] }) {
  if (items.length === 0) return null

  // Sem referência não vira "alterado" — fica sem selo, para não assustar.
  const alterados = items.filter((i) => i.class === 'baixo' || i.class === 'alto').length

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="flex items-center gap-2 text-sm">
          <Beaker className="h-4 w-4 text-primary" />
          Meus exames
        </CardTitle>
        <p className="text-xs text-muted-foreground">
          {alterados === 0
            ? 'Seus resultados mais recentes.'
            : `${alterados} resultado${alterados > 1 ? 's' : ''} fora da faixa de referência. Converse com a equipe na próxima consulta.`}
        </p>
      </CardHeader>
      <CardContent className="space-y-1.5">
        {items.map((it) => {
          const alterado = it.class === 'baixo' || it.class === 'alto'
          return (
            <div
              key={it.analyteKey}
              className="flex items-center gap-2 border-b border-border pb-1.5 last:border-0 last:pb-0"
            >
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-foreground">{it.label}</p>
                <p className="text-[10px] text-muted-foreground">{formatDate(it.measuredAt)}</p>
              </div>
              <p className="tabular-nums text-sm font-bold text-foreground">
                {fmt(it.value)} <span className="text-[10px] font-normal text-muted-foreground">{it.unit}</span>
              </p>
              {it.class === 'sem_referencia' ? null : (
                <span
                  className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-bold',
                    alterado
                      ? 'bg-[hsl(var(--warning)/0.2)] text-[hsl(var(--warning-foreground))]'
                      : 'bg-success-bg text-success-text',
                  )}
                >
                  {alterado ? 'Alterado' : 'Normal'}
                </span>
              )}
            </div>
          )
        })}
      </CardContent>
    </Card>
  )
}
