'use client'

/**
 * Feature 056 — o formulário de gatilho.
 *
 * Este componente não conhece nenhuma fonte. Ele recebe o catálogo, agrupa por
 * categoria e desenha os campos que a fonte escolhida declarou — número, texto
 * ou escolha, com as opções resolvidas no servidor.
 *
 * Antes disso a tela mandava `params: {}` fixo, e a consequência não era
 * cosmética: das fontes que existiam, só as duas sem parâmetro eram criáveis
 * pela interface. "Sem retorno há N meses" não tinha onde receber o N e era
 * recusada pelo schema da própria fonte — a clínica via "parâmetros inválidos"
 * num formulário que não tinha parâmetro nenhum para preencher.
 *
 * O aviso da fonte (FR-009 e parentes) aparece aqui mas NÃO é escrito aqui:
 * vem no catálogo, declarado pela fonte que conhece a limitação do próprio
 * dado. Fonte de ausência nova nasce com o guarda-corpo junto.
 */

import { useMemo, useState } from 'react'
import { AlertTriangle, Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

export interface CampoDTO {
  name: string
  label: string
  kind: 'number' | 'text' | 'select'
  hint?: string
  min?: number
  max?: number
  defaultValue?: string | number
  optionsFrom?: 'habit_items' | 'metric_types'
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

interface Props {
  fontes: FonteDTO[]
  opcoes: OpcoesDTO
  ocupado: boolean
  onCriar(input: { name: string; source: string; params: Record<string, unknown> }): Promise<boolean>
}

function valorInicial(fonte: FonteDTO, opcoes: OpcoesDTO): Record<string, string> {
  const out: Record<string, string> = {}
  for (const campo of fonte.fields) {
    if (campo.defaultValue !== undefined) out[campo.name] = String(campo.defaultValue)
    else if (campo.kind === 'select' && campo.optionsFrom) {
      out[campo.name] = opcoes[campo.optionsFrom]?.[0]?.value ?? ''
    } else out[campo.name] = ''
  }
  return out
}

export function GatilhoForm({ fontes, opcoes, ocupado, onCriar }: Props) {
  const [nome, setNome] = useState('')
  const [fonteId, setFonteId] = useState(fontes[0]?.id ?? '')
  const fonte = useMemo(() => fontes.find((f) => f.id === fonteId) ?? null, [fontes, fonteId])
  const [valores, setValores] = useState<Record<string, string>>(() =>
    fontes[0] ? valorInicial(fontes[0], opcoes) : {},
  )

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
      const bruto = (valores[campo.name] ?? '').trim()
      if (campo.kind === 'number') {
        if (bruto === '') return null
        const n = Number(bruto)
        if (!Number.isFinite(n)) return null
        params[campo.name] = n
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

  return (
    <div className="space-y-3 rounded-md border p-4">
      <div className="grid gap-3 md:grid-cols-2">
        <div className="space-y-1">
          <Label htmlFor="gat-nome">Nome do gatilho</Label>
          <Input
            id="gat-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Aniversário dos pacientes"
          />
          <p className="text-xs text-muted-foreground">
            É o nome que aparece na sua lista. O paciente não vê.
          </p>
        </div>
        <div className="space-y-1">
          <Label htmlFor="gat-fonte">Quando disparar</Label>
          <select
            id="gat-fonte"
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
        </div>
      </div>

      {fonte && <p className="text-sm text-muted-foreground">{fonte.hint}</p>}

      {/* Os parâmetros DA FONTE. Nenhum deles está escrito neste arquivo. */}
      {fonte && fonte.fields.length > 0 && (
        <div className="grid gap-3 md:grid-cols-2">
          {fonte.fields.map((campo) => (
            <div key={campo.name} className="space-y-1">
              <Label htmlFor={`campo-${campo.name}`}>{campo.label}</Label>
              {campo.kind === 'select' ? (
                <select
                  id={`campo-${campo.name}`}
                  className="h-9 w-full rounded-md border bg-background px-3 text-sm"
                  value={valores[campo.name] ?? ''}
                  onChange={(e) =>
                    setValores((v) => ({ ...v, [campo.name]: e.target.value }))
                  }
                >
                  <option value="">Qualquer / escolha…</option>
                  {(opcoes[campo.optionsFrom ?? ''] ?? []).map((o) => (
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
                  onChange={(e) =>
                    setValores((v) => ({ ...v, [campo.name]: e.target.value }))
                  }
                />
              )}
              {campo.hint && <p className="text-xs text-muted-foreground">{campo.hint}</p>}
              {campo.kind === 'select' &&
                (opcoes[campo.optionsFrom ?? ''] ?? []).length === 0 && (
                  <p className="text-xs text-amber-700">
                    Nada cadastrado ainda para escolher aqui.
                  </p>
                )}
            </div>
          ))}
        </div>
      )}

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

      <Button
        size="sm"
        disabled={!nome || !fonteId || faltaPreencher || ocupado}
        onClick={async () => {
          if (!params) return
          const ok = await onCriar({ name: nome, source: fonteId, params })
          if (ok) setNome('')
        }}
      >
        <Plus className="mr-1 h-4 w-4" aria-hidden />
        Criar gatilho
      </Button>
      {faltaPreencher && (
        <p className="text-xs text-muted-foreground">Preencha os campos acima para criar.</p>
      )}
    </div>
  )
}
