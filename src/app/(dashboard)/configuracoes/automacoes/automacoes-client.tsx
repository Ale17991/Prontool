'use client'

/**
 * Feature 056 — a tela de automações.
 *
 * Orquestra três coisas que a clínica pensa separadamente e que o modelo trata
 * separadamente: a MENSAGEM (o que), o GATILHO (quando) e a AUTOMAÇÃO (o
 * vínculo entre os dois, que liga e desliga).
 *
 * A ordem na tela é a ordem de montagem — mensagem, gatilho, ligar —, e a
 * automação nasce DESLIGADA. Ativar exige passar pela prévia, porque ligar um
 * gatilho de estado contínuo numa base grande é o erro que mais custa caro
 * nesta feature: todo mundo que já está na condição entra de uma vez.
 */

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { AlertTriangle, Eye, Plus, Power, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { GatilhoForm, type FonteDTO, type OpcoesDTO } from './gatilho-form'
import { MensagensClient, type MensagemDTO } from './mensagens-client'
import { OcorrenciasPanel } from './ocorrencias-panel'

export type { FonteDTO } from './gatilho-form'

export interface AutomacaoDTO {
  id: string
  active: boolean
  gatilhoNome: string
  mensagemNome: string
  enviados30d: number
  entregues30d: number
  lidos30d: number
  suprimidos30d: number
}

interface Props {
  automacoesIniciais: AutomacaoDTO[]
  mensagensIniciais: MensagemDTO[]
  gatilhosIniciais: Array<{ id: string; name: string; source: string; fonteLabel: string }>
  fontes: FonteDTO[]
  opcoes: OpcoesDTO
}

export function AutomacoesClient({
  automacoesIniciais,
  mensagensIniciais,
  gatilhosIniciais,
  fontes,
  opcoes,
}: Props) {
  const router = useRouter()
  const [erro, setErro] = useState<string | null>(null)
  const [ocupado, setOcupado] = useState(false)

  const [assocGatilho, setAssocGatilho] = useState('')
  const [assocMensagem, setAssocMensagem] = useState('')
  const [previa, setPrevia] = useState<{
    candidatosHoje: number
    tetoPorCiclo: number
    avisoVolume: boolean
  } | null>(null)

  async function chamar(url: string, init: RequestInit): Promise<unknown | null> {
    setErro(null)
    setOcupado(true)
    try {
      const res = await fetch(url, { headers: { 'Content-Type': 'application/json' }, ...init })
      const body = res.status === 204 ? {} : await res.json().catch(() => ({}))
      if (!res.ok) {
        const b = body as { error?: string; detail?: string }
        setErro(b.detail ?? b.error ?? 'Não foi possível concluir.')
        return null
      }
      router.refresh()
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
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Automações</h2>
        {automacoesIniciais.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhuma ainda. Crie uma mensagem e um gatilho abaixo, depois ligue os dois.
          </p>
        ) : (
          <ul className="divide-y rounded-md border">
            {automacoesIniciais.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium">
                    {a.gatilhoNome} → {a.mensagemNome}
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
        <h2 className="text-lg font-medium">Ligar um gatilho a uma mensagem</h2>
        <div className="grid gap-3 md:grid-cols-2">
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="assoc-gatilho">
              Gatilho
            </label>
            <select
              id="assoc-gatilho"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={assocGatilho}
              onChange={(e) => {
                setAssocGatilho(e.target.value)
                setPrevia(null)
              }}
            >
              <option value="">Escolha…</option>
              {gatilhosIniciais.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name} ({g.fonteLabel})
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1">
            <label className="text-sm font-medium" htmlFor="assoc-mensagem">
              Mensagem
            </label>
            <select
              id="assoc-mensagem"
              className="h-9 w-full rounded-md border bg-background px-3 text-sm"
              value={assocMensagem}
              onChange={(e) => setAssocMensagem(e.target.value)}
            >
              <option value="">Escolha…</option>
              {mensagensIniciais.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!assocGatilho || ocupado}
            onClick={async () => {
              const r = (await chamar(`/api/automacoes/gatilhos/${assocGatilho}/previa`, {
                method: 'GET',
              })) as { candidatosHoje: number; tetoPorCiclo: number; avisoVolume: boolean } | null
              if (r) setPrevia(r)
            }}
          >
            <Eye className="mr-1 h-4 w-4" aria-hidden />
            Ver quantos pacientes isso atinge hoje
          </Button>
          <Button
            size="sm"
            disabled={!assocGatilho || !assocMensagem || ocupado}
            onClick={() =>
              chamar('/api/automacoes', {
                method: 'POST',
                body: JSON.stringify({
                  triggerId: assocGatilho,
                  messageTemplateId: assocMensagem,
                }),
              })
            }
          >
            <Plus className="mr-1 h-4 w-4" aria-hidden />
            Criar automação (desligada)
          </Button>
        </div>

        {previa && (
          <p className="text-sm">
            <strong>{previa.candidatosHoje}</strong> paciente(s) satisfazem esse gatilho hoje.
            {previa.avisoVolume && (
              <span className="text-amber-700">
                {' '}
                Acima do teto de {previa.tetoPorCiclo} por ciclo — o envio vai levar mais de um dia
                para vazar a fila.
              </span>
            )}
          </p>
        )}
      </section>

      {/* ---------------------------------------------------------------- */}
      <section className="space-y-3">
        <h2 className="text-lg font-medium">Gatilhos</h2>
        <p className="text-sm text-muted-foreground">
          O <strong>quando</strong>. Cada fonte tem seus próprios parâmetros.
        </p>

        <GatilhoForm
          fontes={fontes}
          opcoes={opcoes}
          ocupado={ocupado}
          onCriar={async (input) => {
            const ok = await chamar('/api/automacoes/gatilhos', {
              method: 'POST',
              body: JSON.stringify(input),
            })
            return Boolean(ok)
          }}
        />

        {gatilhosIniciais.length > 0 && (
          <ul className="divide-y rounded-md border text-sm">
            {gatilhosIniciais.map((g) => (
              <li key={g.id} className="flex items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate font-medium">{g.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{g.fonteLabel}</p>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={ocupado}
                  onClick={() => chamar(`/api/automacoes/gatilhos/${g.id}`, { method: 'DELETE' })}
                >
                  <Trash2 className="h-4 w-4" aria-hidden />
                  <span className="sr-only">Excluir gatilho</span>
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="text-xs text-muted-foreground">
          Excluir um gatilho leva junto as automações que o usam. A mensagem, não — ela é insumo
          compartilhado e a exclusão é recusada enquanto estiver em uso.
        </p>
      </section>

      {/* ---------------------------------------------------------------- */}
      <MensagensClient mensagens={mensagensIniciais} ocupado={ocupado} chamar={chamar} />

      {/* ---------------------------------------------------------------- */}
      <OcorrenciasPanel />
    </div>
  )
}
