'use client'

import { useState, useTransition } from 'react'
import { Sparkles, Bell } from 'lucide-react'

export interface FamilyOption {
  id: string
  nature: 'celebracao' | 'ausencia'
  label: string
  description: string
  placeholders: string[]
  defaultTemplate: string
  defaultSilenceDays: number
}

interface Props {
  families: FamilyOption[]
  onSaved: () => void
}

/**
 * Feature 053 — formulário de uma regra nova.
 *
 * As famílias de CELEBRAÇÃO aparecem primeiro e com destaque próprio. Não é
 * decoração: se as regras de reconhecimento ficam no fim de uma lista de
 * catorze, ninguém liga, e a clínica acaba com um sistema que só sabe cobrar —
 * exatamente o que a feature foi desenhada para evitar (SC-009).
 */
export function RuleForm({ families, onSaved }: Props) {
  const [familyId, setFamilyId] = useState<string>('')
  const [dias, setDias] = useState<number>(3)
  const [template, setTemplate] = useState<string>('')
  const [channel, setChannel] = useState<'preferencial' | 'whatsapp' | 'email'>('preferencial')
  const [silence, setSilence] = useState<number>(7)
  const [erro, setErro] = useState<string | null>(null)
  const [pending, startTransition] = useTransition()

  const familia = families.find((f) => f.id === familyId) ?? null

  function escolher(id: string) {
    setFamilyId(id)
    setErro(null)
    const f = families.find((x) => x.id === id)
    if (f) {
      setTemplate(f.defaultTemplate)
      setSilence(f.defaultSilenceDays)
    }
  }

  function salvar() {
    if (!familia) return
    setErro(null)
    startTransition(async () => {
      const res = await fetch('/api/notificacoes-automaticas', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          family: familia.id,
          params: { days: dias },
          audience: 'todos_ativos',
          channel,
          messageTemplate: template,
          silenceDays: silence,
        }),
      })
      if (res.ok) {
        setFamilyId('')
        setTemplate('')
        onSaved()
        return
      }
      const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
      setErro(mensagemDeErro(body))
    })
  }

  const celebracao = families.filter((f) => f.nature === 'celebracao')
  const ausencia = families.filter((f) => f.nature === 'ausencia')

  return (
    <section className="space-y-4 rounded-xl border border-slate-200 bg-white p-5">
      <h2 className="text-lg font-semibold text-slate-900">Nova notificação automática</h2>

      {celebracao.length > 0 && (
        <Grupo
          titulo="Reconhecer"
          subtitulo="Mensagens que celebram algo que o paciente fez."
          icone={<Sparkles className="h-4 w-4 text-primary" />}
          familias={celebracao}
          selecionada={familyId}
          onEscolher={escolher}
        />
      )}

      <Grupo
        titulo="Retomar contato"
        subtitulo="Mensagens para quando falta registro há algum tempo."
        icone={<Bell className="h-4 w-4 text-slate-500" />}
        familias={ausencia}
        selecionada={familyId}
        onEscolher={escolher}
      />

      {familia && (
        <div className="space-y-4 border-t border-slate-100 pt-4">
          <label className="block text-sm">
            <span className="font-medium text-slate-900">Depois de quantos dias</span>
            <input
              type="number"
              min={2}
              max={180}
              value={dias}
              onChange={(e) => setDias(Number(e.target.value))}
              className="mt-1 w-24 rounded-md border border-slate-300 px-2 py-1"
            />
          </label>

          <label className="block text-sm">
            <span className="font-medium text-slate-900">Mensagem</span>
            <p className="text-xs text-slate-500">
              Campos disponíveis: {familia.placeholders.map((p) => `{{${p}}}`).join(', ')}
            </p>
            <textarea
              value={template}
              onChange={(e) => setTemplate(e.target.value)}
              rows={5}
              className="mt-1 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </label>

          <div className="flex flex-wrap gap-4">
            <label className="block text-sm">
              <span className="font-medium text-slate-900">Canal</span>
              <select
                value={channel}
                onChange={(e) => setChannel(e.target.value as typeof channel)}
                className="mt-1 block rounded-md border border-slate-300 px-2 py-1"
              >
                <option value="preferencial">WhatsApp, ou e-mail se não der</option>
                <option value="whatsapp">Só WhatsApp</option>
                <option value="email">Só e-mail</option>
              </select>
            </label>

            <label className="block text-sm">
              <span className="font-medium text-slate-900">Não repetir por</span>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="number"
                  min={1}
                  max={90}
                  value={silence}
                  onChange={(e) => setSilence(Number(e.target.value))}
                  className="w-20 rounded-md border border-slate-300 px-2 py-1"
                />
                <span className="text-slate-500">dias</span>
              </div>
            </label>
          </div>

          {erro && (
            <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{erro}</p>
          )}

          <button
            type="button"
            onClick={salvar}
            disabled={pending}
            className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
          >
            {pending ? 'Salvando…' : 'Ligar esta notificação'}
          </button>
        </div>
      )}
    </section>
  )
}

function Grupo({
  titulo,
  subtitulo,
  icone,
  familias,
  selecionada,
  onEscolher,
}: {
  titulo: string
  subtitulo: string
  icone: React.ReactNode
  familias: FamilyOption[]
  selecionada: string
  onEscolher: (id: string) => void
}) {
  if (familias.length === 0) return null
  return (
    <div>
      <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        {icone}
        {titulo}
      </h3>
      <p className="text-xs text-slate-500">{subtitulo}</p>
      <div className="mt-2 grid gap-2 sm:grid-cols-2">
        {familias.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => onEscolher(f.id)}
            className={`rounded-lg border p-3 text-left text-sm transition ${
              selecionada === f.id
                ? 'border-primary bg-primary/5'
                : 'border-slate-200 hover:border-slate-300'
            }`}
          >
            <span className="block font-medium text-slate-900">{f.label}</span>
            <span className="mt-0.5 block text-xs text-slate-500">{f.description}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Erro precisa dizer o que consertar. "Texto inválido" faz a clínica caçar no
 * escuro; apontar a frase e sugerir a reescrita faz ela consertar sozinha.
 */
function mensagemDeErro(body: Record<string, unknown>): string {
  switch (body.code) {
    case 'FORBIDDEN_PHRASE':
      return `A mensagem afirma algo que não sabemos: "${String(body.trecho)}". ${String(
        body.sugestao,
      )} O sistema vê que faltou registro, não que o paciente deixou de fazer.`
    case 'UNKNOWN_PLACEHOLDER':
      return `Estes campos não existem nesta notificação: ${(body.campos as string[]).join(', ')}.`
    case 'INVALID_PARAMS':
      return `Parâmetro inválido: ${String(body.detail)}`
    case 'INVALID_SILENCE':
      return 'O intervalo sem repetir precisa ficar entre 1 e 90 dias.'
    default:
      return 'Não foi possível salvar. Confira os campos e tente de novo.'
  }
}
