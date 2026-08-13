'use client'

/**
 * Feature 056 — a tela de automações.
 *
 * Duas coisas, e não três: a MENSAGEM (o que o paciente recebe) e a AUTOMAÇÃO
 * (o nome, o quando e o a que horas). O gatilho continua existindo no banco,
 * porque é a unidade de enumeração do motor e duas automações com o mesmo
 * "quando" devem compartilhar a mesma varredura — mas deixou de ser um objeto
 * que a clínica cria, nomeia e administra. Ele nasce junto com a automação e é
 * reaproveitado quando já existe um idêntico.
 *
 * A automação nasce DESLIGADA. Ativar exige passar pela prévia, porque ligar um
 * gatilho de estado contínuo numa base grande é o erro que mais custa caro nesta
 * feature: todo mundo que já está na condição entra de uma vez.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Clock, Power, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  AutomacaoForm,
  type FonteDTO,
  type OpcoesDTO,
  type Previa,
} from './automacao-form'
import { JanelaEnvio } from './janela-envio'
import { MensagensClient, type MensagemDTO } from './mensagens-client'
import { OcorrenciasPanel } from './ocorrencias-panel'

export type { FonteDTO } from './automacao-form'

export interface AutomacaoDTO {
  id: string
  active: boolean
  nome: string
  fonteLabel: string
  mensagemNome: string
  horario: string
  ancorada: boolean
  enviados30d: number
  entregues30d: number
  lidos30d: number
  suprimidos30d: number
}

export interface JanelaDTO {
  inicio: string
  fim: string
  dias: number[]
}

interface Props {
  automacoesIniciais: AutomacaoDTO[]
  mensagensIniciais: MensagemDTO[]
  fontes: FonteDTO[]
  opcoes: OpcoesDTO
  janela: JanelaDTO
}

export function AutomacoesClient({
  automacoesIniciais,
  mensagensIniciais,
  fontes,
  opcoes,
  janela,
}: Props) {
  const router = useRouter()
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  async function chamar(
    url: string,
    init: RequestInit,
    // A prévia não muda nada no servidor: recarregar a página depois dela seria
    // pagar uma volta inteira de dados para redesenhar o mesmo estado.
    opts: { semRefresh?: boolean } = {},
  ): Promise<unknown | null> {
    setErro(null)
    setOcupado(true)
    try {
      const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init })
      const body = res.status === 204 ? {} : await res.json().catch(() => ({}))
      if (!res.ok) {
        const b = body as { error?: string; detail?: string }
        setErro(
          b.detail ??
            (b.error === 'NOME_DUPLICADO'
              ? 'Já existe uma automação com esse nome.'
              : b.error === 'JA_EXISTE'
                ? 'Já existe uma automação com esse mesmo quando e essa mesma mensagem.'
                : (b.error ?? 'Não foi possível concluir.')),
        )
        return null
      }
      if (!opts.semRefresh) router.refresh()
      return body
    } finally {
      setOcupado(false)
    }
  }

  return (
    <div className="space-y-8">
      {erro && (
        <div className="flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{erro}</span>
        </div>
      )}

      {/* ---------------------------------------------------------------- */}
      <JanelaEnvio
        janelaInicio={janela.inicio}
        janelaFim={janela.fim}
        dias={janela.dias}
        ocupado={ocupado}
        chamar={chamar}
      />

      {/* ---------------------------------------------------------------- */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Automações</h2>
        {automacoesIniciais.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma ainda. Crie uma mensagem e monte a primeira automação abaixo.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {automacoesIniciais.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">{a.nome}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {a.fonteLabel} → {a.mensagemNome}
                    {' · '}
                    <Clock className="mr-0.5 inline h-3 w-3" aria-hidden />
                    {/* Automação ancorada não tem hora do dia: o instante é o de
                        cada paciente, e mostrar "09:00" ali seria mentira. */}
                    {a.ancorada ? 'no horário de cada paciente' : a.horario}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {a.active ? 'Ativa' : 'Desligada'}
                    {/* Os números são recompostos a cada leitura, nunca
                        gravados: corrigir a regra reapura o histórico. */}
                    {' · '}
                    {a.enviados30d} enviada(s) em 30 dias
                    {a.enviados30d > 0 && ` · ${a.entregues30d} entregue(s) · ${a.lidos30d} lida(s)`}
                    {a.suprimidos30d > 0 && ` · ${a.suprimidos30d} segurada(s) pelo limite`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <Button
                    variant={a.active ? 'outline' : 'default'}
                    size="sm"
                    disabled={ocupado}
                    onClick={() =>
                      chamar(`/api/automacoes/${a.id}`, {
                        method: 'PATCH',
                        body: JSON.stringify({ active: !a.active }),
                      })
                    }
                  >
                    <Power className="mr-1 h-4 w-4" aria-hidden />
                    {a.active ? 'Desligar' : 'Ativar'}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={ocupado}
                    onClick={() => chamar(`/api/automacoes/${a.id}`, { method: 'DELETE' })}
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                    <span className="sr-only">Excluir automação</span>
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Nova automação</h2>
        <p className="text-sm text-muted-foreground">
          Escolha a mensagem e o momento. Ela nasce desligada — ligar é um ato à parte, depois de
          ver quantos pacientes isso alcança.
        </p>

        <AutomacaoForm
          fontes={fontes}
          opcoes={opcoes}
          mensagens={mensagensIniciais}
          ocupado={ocupado}
          onCriar={async (input) =>
            Boolean(
              await chamar('/api/automacoes', { method: 'POST', body: JSON.stringify(input) }),
            )
          }
          onPrevia={async (input) =>
            (await chamar(
              '/api/automacoes/previa',
              { method: 'POST', body: JSON.stringify(input) },
              { semRefresh: true },
            )) as Previa | null
          }
        />
      </section>

      {/* ---------------------------------------------------------------- */}
      <MensagensClient mensagens={mensagensIniciais} ocupado={ocupado} chamar={chamar} />

      {/* ---------------------------------------------------------------- */}
      <OcorrenciasPanel />
    </div>
  )
}
