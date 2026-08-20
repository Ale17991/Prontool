'use client'

/**
 * Feature 056 — o formulário da automação.
 *
 * Um ato só: nome, mensagem, quando, e (quando faz sentido) a que horas. O
 * gatilho continua existindo no banco, mas nasce por baixo — pedir que a clínica
 * criasse um gatilho nomeado, depois uma mensagem nomeada, e só então ligasse os
 * dois era pedir três atos para uma ideia só, e punha o nome no objeto errado:
 * quem a clínica procura, renomeia e desliga é a automação.
 *
 * Este componente não conhece nenhuma fonte. Ele recebe o catálogo, agrupa por
 * categoria e desenha os campos que a fonte escolhida declarou — número, texto,
 * escolha ou DURAÇÃO (número mais unidade). O aviso também vem da fonte, que é
 * quem conhece a limitação do próprio dado: fonte de ausência nova nasce com o
 * guarda-corpo junto.
 */

import { useMemo, useState } from 'react'
import { AlertTriangle, Eye, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface CampoDTO {
  name: string
  label: string
  kind: 'number' | 'text' | 'select' | 'duration'
  hint?: string
  min?: number
  max?: number
  defaultValue?: string | number
  optionsFrom?: 'habit_items' | 'metric_types'
  /** Escolhas fixas da fonte, quando não vêm do catálogo da clínica. */
  options?: ReadonlyArray<{ readonly value: string; readonly label: string }>
  /** Só aparece quando outro campo estiver num destes valores. */
  showWhen?: { readonly field: string; readonly equals: readonly string[] }
}

export interface FonteDTO {
  id: string
  label: string
  group: string
  groupLabel: string
  hint: string
  warning: string | null
  fields: readonly CampoDTO[]
  variables: string[]
}

export type OpcoesDTO = Record<string, Array<{ value: string; label: string }>>

export interface Previa {
  candidatosHoje: number
  tetoPorCiclo: number
  capacidadeDoDia: number
  minutosDeFila: number
  avisoVolume: boolean
}

export interface MensagemOpcao {
  id: string
  name: string
}

/**
 * Estado de partida quando o formulário abre para EDITAR. Ausente = criar.
 *
 * Os `params` chegam como vieram do banco (minutos, por exemplo) e a tela os
 * decompõe na maior unidade que divide exato — 120 volta como "2 horas", que é
 * como a clínica escreveu. Ver `decompor`.
 */
export interface ValorInicial {
  nome: string
  mensagemId: string
  horario: string
  source: string
  params: Record<string, unknown>
}

interface Props {
  fontes: FonteDTO[]
  opcoes: OpcoesDTO
  mensagens: MensagemOpcao[]
  ocupado: boolean
  /** Presente = edição de uma automação existente. */
  inicial?: ValorInicial
  /** Chamado ao cancelar a edição (só aparece quando `inicial` existe). */
  onCancelar?(): void
  onCriar(input: {
    name: string
    messageTemplateId: string
    source: string
    params: Record<string, unknown>
    sendAtLocal: string
  }): Promise<boolean>
  onPrevia(input: { source: string; params: Record<string, unknown> }): Promise<Previa | null>
}

const MINUTOS_POR_DIA = 1440
type Unidade = 'minutos' | 'horas' | 'dias'

/**
 * A maior unidade que divide exato — 120 volta como "2 horas", não "120 minutos".
 *
 * `ancorar` desempata o caso em que a maior unidade MENTE: 1440 minutos fecham
 * um dia, mas quem escreveu "24 horas" pediu um envio diferente de quem escreveu
 * "1 dia". Reabrir o formulário mostrando "1 dia" faria a clínica salvar de volta
 * a leitura que ela não escolheu.
 */
function decompor(minutos: number, ancorar?: boolean): { valor: number; unidade: Unidade } {
  if (ancorar !== true && minutos !== 0 && minutos % MINUTOS_POR_DIA === 0) {
    return { valor: minutos / MINUTOS_POR_DIA, unidade: 'dias' }
  }
  if (minutos !== 0 && minutos % 60 === 0) return { valor: minutos / 60, unidade: 'horas' }
  return { valor: minutos, unidade: 'minutos' }
}

function emMinutos(valor: number, unidade: Unidade): number {
  if (unidade === 'dias') return valor * MINUTOS_POR_DIA
  if (unidade === 'horas') return valor * 60
  return valor
}

/** "40 minutos", "1h40" — quanto tempo a fila leva para vazar inteira. */
function minutosEmTexto(minutos: number): string {
  if (minutos < 60) return `${minutos} minutos`
  const h = Math.floor(minutos / 60)
  const m = minutos % 60
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, '0')}`
}

/**
 * Uma antecedência que não fecha em dias inteiros manda no horário da âncora —
 * e, no empate de 1440, quem manda é a unidade que a clínica escolheu. Espelha
 * `ancorada()` do servidor.
 */
function ehAncorada(minutos: number, ancorar?: boolean): boolean {
  if (typeof ancorar === 'boolean') return ancorar
  return minutos % MINUTOS_POR_DIA !== 0
}

function valorInicial(fonte: FonteDTO, opcoes: OpcoesDTO): Record<string, string> {
  const out: Record<string, string> = {}
  for (const campo of fonte.fields) {
    if (campo.kind === 'duration') {
      const { valor, unidade } = decompor(Number(campo.defaultValue ?? MINUTOS_POR_DIA))
      out[campo.name] = String(valor)
      out[`${campo.name}__unidade`] = unidade
    } else if (campo.defaultValue !== undefined) out[campo.name] = String(campo.defaultValue)
    else if (campo.kind === 'select' && campo.options?.length) {
      out[campo.name] = campo.options[0]?.value ?? ''
    } else if (campo.kind === 'select' && campo.optionsFrom) {
      out[campo.name] = opcoes[campo.optionsFrom]?.[0]?.value ?? ''
    } else out[campo.name] = ''
  }
  return out
}

export function AutomacaoForm({
  fontes,
  opcoes,
  mensagens,
  ocupado,
  inicial,
  onCancelar,
  onCriar,
  onPrevia,
}: Props) {
  const editando = inicial !== undefined
  const [nome, setNome] = useState(inicial?.nome ?? '')
  const [mensagemId, setMensagemId] = useState(inicial?.mensagemId ?? '')
  const [horario, setHorario] = useState(inicial?.horario ?? '09:00')
  const [fonteId, setFonteId] = useState(inicial?.source ?? fontes[0]?.id ?? '')
  const fonte = useMemo(() => fontes.find((f) => f.id === fonteId) ?? null, [fontes, fonteId])
  const [valores, setValores] = useState<Record<string, string>>(() => {
    const fonteInicial = fontes.find((f) => f.id === (inicial?.source ?? fontes[0]?.id))
    if (!fonteInicial) return {}
    const base = valorInicial(fonteInicial, opcoes)
    if (!inicial) return base
    // Sobrepõe o que a automação tem gravado, mantendo o padrão da fonte para
    // qualquer campo que ela não preencheu.
    for (const [k, v] of Object.entries(inicial.params)) {
      // `ancorar` não é campo da tela: é a intenção de unidade, e reaparece pela
      // unidade escolhida no seletor ao lado do número.
      if (k === 'ancorar') continue
      const campo = fonteInicial.fields.find((c) => c.name === k)
      if (campo?.kind === 'duration') {
        const { valor, unidade } = decompor(
          Number(v),
          inicial.params.ancorar as boolean | undefined,
        )
        base[k] = String(valor)
        base[`${k}__unidade`] = unidade
      } else base[k] = String(v)
    }
    return base
  })
  const [previa, setPrevia] = useState<Previa | null>(null)

  // A lista fica agrupada porque são dezesseis fontes: sem os grupos, achar
  // "parcela a vencer" no meio de "aniversário de cadastro" é leitura linear.
  const grupos = useMemo(() => {
    const mapa = new Map<string, { label: string; itens: FonteDTO[] }>()
    for (const f of fontes) {
      const g = mapa.get(f.group) ?? { label: f.groupLabel, itens: [] }
      g.itens.push(f)
      mapa.set(f.group, g)
    }
    return [...mapa.values()]
  }, [fontes])

  function trocarFonte(id: string) {
    setFonteId(id)
    setPrevia(null)
    const nova = fontes.find((f) => f.id === id)
    setValores(nova ? valorInicial(nova, opcoes) : {})
  }

  /**
   * Converte o que o formulário guarda (string) para o que o schema da fonte
   * espera. Campo de número vazio vira ausente, e não `0`: zero é um valor
   * legítimo em alguns parâmetros ("avisar no próprio dia"), e transformar
   * "não preenchi" em zero mandaria a mensagem no dia errado em vez de recusar.
   */
  function montarParams(): Record<string, unknown> | null {
    if (!fonte) return null
    const params: Record<string, unknown> = {}
    for (const campo of fonte.fields) {
      // Campo escondido pela regra da fonte não vai no payload: mandar "7 dias"
      // junto de "no início do mês" gravaria um parâmetro que o motor ignora e
      // que reapareceria como valor válido se alguém trocasse a escolha depois.
      if (campo.showWhen && !campo.showWhen.equals.includes(valores[campo.showWhen.field] ?? '')) {
        continue
      }
      const bruto = (valores[campo.name] ?? '').trim()
      if (campo.kind === 'number' || campo.kind === 'duration') {
        if (bruto === '') return null
        const n = Number(bruto)
        if (!Number.isFinite(n)) return null
        if (campo.kind === 'duration') {
          const unidade = (valores[`${campo.name}__unidade`] as Unidade) ?? 'dias'
          params[campo.name] = emMinutos(n, unidade)
          // A UNIDADE é a intenção, e ela some na conversão para minutos: 24
          // horas e 1 dia chegam ao servidor como o mesmo 1440. Quem escreveu
          // horas quer a mensagem contada do horário do paciente; quem escreveu
          // dias quer o lote no horário da clínica. O servidor descarta esta
          // chave quando ela apenas repete o que a aritmética já diria.
          params.ancorar = unidade !== 'dias'
        } else params[campo.name] = n
      } else {
        // Opcional e vazio simplesmente não entra — é o caso de "qualquer
        // métrica" em `meta_atingida`, onde ausente e "todas" são a mesma coisa.
        if (bruto !== '') params[campo.name] = bruto
      }
    }
    return params
  }

  const params = montarParams()
  const faltaPreencher = params === null

  /**
   * Alguma duração escolhida cai abaixo de um dia? Então o instante do envio é o
   * da âncora de cada paciente ("2 horas antes DA CONSULTA DELE"), e o horário
   * do dia não se aplica. O campo é desabilitado em vez de escondido: sumir
   * deixaria a clínica sem entender por que a automação de ontem tinha horário e
   * a de hoje não.
   */
  const ancorada = useMemo(() => {
    if (!fonte || !params) return false
    return fonte.fields.some(
      (c) =>
        c.kind === 'duration' &&
        ehAncorada(Number(params[c.name] ?? 0), params.ancorar as boolean | undefined),
    )
  }, [fonte, params])

  return (
    <div className="space-y-4 rounded-md border p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="auto-nome">Nome da automação</Label>
          <Input
            id="auto-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Parabéns de aniversário"
          />
          <p className="text-xs text-muted-foreground">
            É o nome que aparece na sua lista. O paciente não vê.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="auto-mensagem">Mensagem que vai ser enviada</Label>
          <select
            id="auto-mensagem"
            className="h-9 w-full rounded-md border bg-background px-3 text-sm"
            value={mensagemId}
            onChange={(e) => setMensagemId(e.target.value)}
          >
            <option value="">Escolha…</option>
            {mensagens.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
          {mensagens.length === 0 && (
            <p className="text-xs text-amber-700">
              Crie uma mensagem abaixo antes — é ela que o paciente recebe.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-1">
        <Label htmlFor="auto-fonte">Quando disparar</Label>
        <select
          id="auto-fonte"
          className="h-9 w-full rounded-md border bg-background px-3 text-sm"
          value={fonteId}
          onChange={(e) => trocarFonte(e.target.value)}
        >
          {grupos.map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.itens.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        {fonte && <p className="text-sm text-muted-foreground">{fonte.hint}</p>}
      </div>

      {/* Os parâmetros DA FONTE. Nenhum deles está escrito neste arquivo. */}
      <div className="grid gap-3 md:grid-cols-2">
        {(fonte?.fields ?? [])
          .filter(
            (campo) =>
              !campo.showWhen ||
              campo.showWhen.equals.includes(valores[campo.showWhen.field] ?? ''),
          )
          .map((campo) => (
            <div key={campo.name} className="space-y-1">
              <Label htmlFor={`campo-${campo.name}`}>{campo.label}</Label>

              {campo.kind === 'duration' ? (
                <div className="flex gap-2">
                  <Input
                    id={`campo-${campo.name}`}
                    type="number"
                    min={0}
                    className="w-24"
                    value={valores[campo.name] ?? ''}
                    onChange={(e) => {
                      setPrevia(null)
                      setValores((v) => ({ ...v, [campo.name]: e.target.value }))
                    }}
                  />
                  <select
                    aria-label={`Unidade de ${campo.label}`}
                    className="h-9 flex-1 rounded-md border bg-background px-3 text-sm"
                    value={valores[`${campo.name}__unidade`] ?? 'dias'}
                    onChange={(e) => {
                      setPrevia(null)
                      setValores((v) => ({ ...v, [`${campo.name}__unidade`]: e.target.value }))
                    }}
                  >
                    <option value="minutos">minutos</option>
                    <option value="horas">horas</option>
                    <option value="dias">dias</option>
                  </select>
                </div>
              ) : campo.kind === 'select' ? (
                <select
                  id={`campo-${campo.name}`}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={valores[campo.name] ?? ''}
                  onChange={(e) => {
                    setPrevia(null)
                    setValores((v) => ({ ...v, [campo.name]: e.target.value }))
                  }}
                >
                  {/* Escolha fixa da fonte é obrigatória e não tem "qualquer":
                    "no dia OU antes OU depois" são alternativas, não um filtro
                    que pode ficar vazio. */}
                  {!campo.options?.length && <option value="">Qualquer / escolha…</option>}
                  {(campo.options ?? opcoes[campo.optionsFrom ?? ''] ?? []).map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              ) : (
                <Input
                  id={`campo-${campo.name}`}
                  type={campo.kind === 'number' ? 'number' : 'text'}
                  min={campo.min}
                  max={campo.max}
                  value={valores[campo.name] ?? ''}
                  onChange={(e) => {
                    setPrevia(null)
                    setValores((v) => ({ ...v, [campo.name]: e.target.value }))
                  }}
                />
              )}

              {campo.hint && <p className="text-xs text-muted-foreground">{campo.hint}</p>}
              {campo.kind === 'select' &&
                !campo.options?.length &&
                (opcoes[campo.optionsFrom ?? ''] ?? []).length === 0 && (
                  <p className="text-xs text-amber-700">
                    Nada cadastrado ainda para escolher aqui.
                  </p>
                )}
            </div>
          ))}

        <div className="space-y-1">
          <Label htmlFor="auto-horario">A que horas enviar</Label>
          <Input
            id="auto-horario"
            type="time"
            value={horario}
            disabled={ancorada}
            onChange={(e) => setHorario(e.target.value)}
          />
          <p className="text-xs text-muted-foreground">
            {ancorada
              ? 'Não se aplica: em horas ou minutos, a mensagem sai contada a partir do horário de cada paciente.'
              : 'No relógio da clínica, e é a hora em que a fila COMEÇA a sair — as mensagens vão uma a cada 5 minutos, para o número não ser bloqueado por disparo em massa. Vale a janela de horário configurada em Lembretes.'}
          </p>
        </div>
      </div>

      {/* O aviso vem DA FONTE. Ver o cabeçalho deste arquivo. */}
      {fonte?.warning && (
        <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>{fonte.warning}</span>
        </div>
      )}

      {fonte && (
        <p className="text-xs text-muted-foreground">
          Variáveis que esta fonte preenche:{' '}
          {fonte.variables.map((v) => (
            <code key={v} className="mr-1 rounded bg-muted px-1">{`{{${v}}}`}</code>
          ))}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {/* A prévia vem ANTES de criar, e não depois: é ela que informa a
            decisão de ligar uma fonte de estado contínuo numa base grande. */}
        <Button
          variant="outline"
          size="sm"
          disabled={!fonteId || faltaPreencher || ocupado}
          onClick={async () => {
            if (!params) return
            const r = await onPrevia({ source: fonteId, params })
            if (r) setPrevia(r)
          }}
        >
          <Eye className="mr-1 h-4 w-4" aria-hidden />
          Ver quantos pacientes isso atinge hoje
        </Button>
        <Button
          size="sm"
          disabled={!nome || !mensagemId || !fonteId || faltaPreencher || ocupado}
          onClick={async () => {
            if (!params) return
            const ok = await onCriar({
              name: nome,
              messageTemplateId: mensagemId,
              source: fonteId,
              params,
              sendAtLocal: horario,
            })
            // Na edição o formulário some ao salvar, então limpar não faz
            // sentido — e limpar o nome faria o campo piscar vazio antes disso.
            if (ok && !editando) {
              setNome('')
              setPrevia(null)
            }
          }}
        >
          <Plus className="mr-1 h-4 w-4" aria-hidden />
          {/* A automação editada NÃO é religada por salvar: se estava desligada,
              continua desligada. Ligar é decisão à parte, e é a mais
              consequente da feature. */}
          {editando ? 'Salvar alterações' : 'Criar automação (desligada)'}
        </Button>
        {editando && onCancelar ? (
          <Button variant="ghost" size="sm" disabled={ocupado} onClick={onCancelar}>
            Cancelar
          </Button>
        ) : null}
      </div>

      {previa && (
        <p className="text-sm">
          <strong>{previa.candidatosHoje}</strong> paciente(s) satisfazem isso hoje.
          {/* O tempo de fila é a informação que muda a decisão, e ela não é
              óbvia a partir do número de pacientes: com uma mensagem a cada 5
              minutos, 20 candidatos são quase duas horas de envio. Dizer só
              "20 pacientes" deixaria a clínica esperar que tudo saísse junto. */}
          {previa.candidatosHoje > 1 && (
            <>
              {' '}
              Vão sair espaçados, uma a cada 5 minutos — cerca de{' '}
              <strong>{minutosEmTexto(previa.minutosDeFila)}</strong> até a última.
            </>
          )}
          {previa.avisoVolume && (
            <span className="text-amber-700">
              {' '}
              Cabem {previa.capacidadeDoDia} por dia dentro da janela de horário da clínica, e isso
              passa disso. Quem sobrar é reavaliado no dia seguinte — e, no caso de aniversário,
              quem ficar de fora perde a data.
            </span>
          )}
        </p>
      )}

      {faltaPreencher && (
        <p className="text-xs text-muted-foreground">Preencha os campos acima para criar.</p>
      )}
    </div>
  )
}
