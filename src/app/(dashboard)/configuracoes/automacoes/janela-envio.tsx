'use client'

/**
 * Feature 056 — a janela em que as automações podem sair.
 *
 * Fica no topo da tela, antes das automações em si, porque é a regra que vale
 * para todas: adiantar isso evita a clínica montar seis automações e só depois
 * descobrir que elas saem de madrugada.
 *
 * O texto diz o que acontece com o excedente ("continua amanhã") porque a
 * pergunta seguinte a "posso limitar o horário?" é sempre "e o que não deu
 * tempo?" — e a resposta muda a decisão de quem tem base grande.
 */

import { useState } from 'react'
import { Clock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

/** Domingo primeiro, como no calendário — e o índice é o do `Date.getDay()`. */
const DIAS = [
  { valor: 0, curto: 'Dom' },
  { valor: 1, curto: 'Seg' },
  { valor: 2, curto: 'Ter' },
  { valor: 3, curto: 'Qua' },
  { valor: 4, curto: 'Qui' },
  { valor: 5, curto: 'Sex' },
  { valor: 6, curto: 'Sáb' },
] as const

interface Props {
  janelaInicio: string
  janelaFim: string
  dias: number[]
  ocupado: boolean
  chamar(url: string, init: RequestInit): Promise<unknown | null>
}

export function JanelaEnvio({ janelaInicio, janelaFim, dias, ocupado, chamar }: Props) {
  const [inicio, setInicio] = useState(janelaInicio)
  const [fim, setFim] = useState(janelaFim)
  const [selecionados, setSelecionados] = useState<number[]>(dias)
  const [salvo, setSalvo] = useState(false)

  const mudou =
    inicio !== janelaInicio ||
    fim !== janelaFim ||
    selecionados.length !== dias.length ||
    selecionados.some((d) => !dias.includes(d))

  const invalido = fim <= inicio

  function alternar(dia: number) {
    setSalvo(false)
    setSelecionados((atual) =>
      atual.includes(dia) ? atual.filter((d) => d !== dia) : [...atual, dia].sort((a, b) => a - b),
    )
  }

  return (
    <section className="space-y-3 rounded-md border p-4">
      <div className="flex items-start gap-3">
        <Clock className="mt-0.5 h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />
        <div>
          <h2 className="text-lg font-medium">Quando podemos enviar</h2>
          <p className="text-sm text-muted-foreground">
            As mensagens saem uma a cada 5 minutos, só dentro desta janela. O que não couber
            continua no próximo dia permitido — nada é enviado de madrugada nem em dia bloqueado.
          </p>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 md:max-w-md">
        <div className="space-y-1">
          <Label htmlFor="janela-inicio">A partir de</Label>
          <Input
            id="janela-inicio"
            type="time"
            value={inicio}
            onChange={(e) => {
              setSalvo(false)
              setInicio(e.target.value)
            }}
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="janela-fim">Até</Label>
          <Input
            id="janela-fim"
            type="time"
            value={fim}
            onChange={(e) => {
              setSalvo(false)
              setFim(e.target.value)
            }}
          />
        </div>
      </div>

      <div className="space-y-1">
        <span className="text-sm font-medium">Dias permitidos</span>
        <div className="flex flex-wrap gap-2">
          {DIAS.map((d) => {
            const ativo = selecionados.includes(d.valor)
            return (
              <button
                key={d.valor}
                type="button"
                aria-pressed={ativo}
                onClick={() => alternar(d.valor)}
                className={
                  ativo
                    ? 'rounded-md border border-primary bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground'
                    : 'rounded-md border bg-background px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-muted'
                }
              >
                {d.curto}
              </button>
            )
          })}
        </div>
        {/* Nenhum dia marcado é uma escolha válida (pausa tudo), mas silenciosa
            demais para não ser dita: a clínica veria as automações ligadas e
            nada saindo. */}
        {selecionados.length === 0 && (
          <p className="text-xs text-amber-700">
            Sem nenhum dia marcado, nenhuma automação será enviada — as ativas ficam paradas até
            você marcar algum dia.
          </p>
        )}
      </div>

      <div className="flex items-center gap-3">
        <Button
          size="sm"
          disabled={!mudou || invalido || ocupado}
          onClick={async () => {
            const ok = await chamar('/api/automacoes/configuracao', {
              method: 'PATCH',
              body: JSON.stringify({ janelaInicio: inicio, janelaFim: fim, dias: selecionados }),
            })
            if (ok) setSalvo(true)
          }}
        >
          Salvar janela
        </Button>
        {invalido && (
          <span className="text-xs text-destructive">O fim precisa ser depois do início.</span>
        )}
        {salvo && !mudou && <span className="text-xs text-muted-foreground">Salvo.</span>}
      </div>
    </section>
  )
}
