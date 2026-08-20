'use client'

/**
 * Feature 056 — o catálogo de mensagens.
 *
 * Criar, EDITAR e excluir. A edição faltava, e a falta doía exatamente onde o
 * catálogo deveria brilhar: o FR-003 promete que a mesma mensagem serve vários
 * gatilhos e que corrigir o texto uma vez alcança todos eles — mas sem botão de
 * editar, corrigir uma vírgula significava criar mensagem nova, religar cada
 * gatilho e excluir a antiga, que a rota recusa enquanto estiver em uso.
 *
 * A recusa de exclusão NOMEIA os gatilhos dependentes (FR-004), e a tela mostra
 * "em uso por N" antes mesmo da tentativa — para a clínica não descobrir o
 * problema clicando.
 */

import { useState } from 'react'
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { Label } from '@/components/ui/label'

export interface MensagemDTO {
  id: string
  name: string
  body: string
  usadaPor: number
}

interface Props {
  mensagens: MensagemDTO[]
  ocupado: boolean
  chamar(url: string, init: RequestInit): Promise<unknown | null>
}

export function MensagensClient({ mensagens, ocupado, chamar }: Props) {
  const [nome, setNome] = useState('')
  const [corpo, setCorpo] = useState('')
  const [editando, setEditando] = useState<string | null>(null)
  const [rascunho, setRascunho] = useState<{ name: string; body: string }>({ name: '', body: '' })

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">Mensagens</h2>
      <p className="text-sm text-muted-foreground">
        O texto que o paciente recebe. A mesma mensagem pode servir vários gatilhos — editar aqui
        vale para todos eles a partir do próximo disparo.
      </p>

      <div className="space-y-3 rounded-md border p-4">
        <div className="space-y-1">
          <Label htmlFor="msg-nome">Nome interno</Label>
          <Input
            id="msg-nome"
            value={nome}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Aniversário padrão"
          />
        </div>
        <div className="space-y-1">
          <Label htmlFor="msg-corpo">Texto</Label>
          <Textarea
            id="msg-corpo"
            rows={4}
            value={corpo}
            onChange={(e) => setCorpo(e.target.value)}
            placeholder="Feliz aniversário, {{paciente}}! A equipe da {{clinica}} deseja um ótimo dia."
          />
          <p className="text-xs text-muted-foreground">
            Use <code>{'{{paciente}}'}</code> e <code>{'{{clinica}}'}</code> em qualquer mensagem.
            As demais variáveis dependem do gatilho — a lista de cada um aparece no formulário de
            gatilho, e avisamos na hora de ligar os dois se a mensagem pedir algo que ele não sabe
            preencher.
          </p>
        </div>
        <Button
          size="sm"
          disabled={!nome || !corpo || ocupado}
          onClick={async () => {
            const ok = await chamar('/api/automacoes/mensagens', {
              method: 'POST',
              body: JSON.stringify({ name: nome, body: corpo }),
            })
            if (ok) {
              setNome('')
              setCorpo('')
            }
          }}
        >
          <Plus className="mr-1 h-4 w-4" aria-hidden />
          Criar mensagem
        </Button>
      </div>

      {mensagens.length > 0 && (
        <ul className="divide-y rounded-md border text-sm">
          {mensagens.map((m) => (
            <li key={m.id} className="space-y-2 p-3">
              {editando === m.id ? (
                <div className="space-y-2">
                  <Input
                    value={rascunho.name}
                    onChange={(e) => setRascunho((r) => ({ ...r, name: e.target.value }))}
                    aria-label="Nome da mensagem"
                  />
                  <Textarea
                    rows={4}
                    value={rascunho.body}
                    onChange={(e) => setRascunho((r) => ({ ...r, body: e.target.value }))}
                    aria-label="Texto da mensagem"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={ocupado || !rascunho.name || !rascunho.body}
                      onClick={async () => {
                        const ok = await chamar(`/api/automacoes/mensagens/${m.id}`, {
                          method: 'PATCH',
                          body: JSON.stringify(rascunho),
                        })
                        if (ok) setEditando(null)
                      }}
                    >
                      <Check className="mr-1 h-4 w-4" aria-hidden />
                      Salvar
                    </Button>
                    <Button variant="ghost" size="sm" onClick={() => setEditando(null)}>
                      <X className="mr-1 h-4 w-4" aria-hidden />
                      Cancelar
                    </Button>
                  </div>
                  {m.usadaPor > 0 && (
                    <p className="text-xs text-amber-700">
                      Esta mensagem está em uso por {m.usadaPor} automação(ões). O texto novo vale
                      para todas a partir do próximo disparo.
                    </p>
                  )}
                </div>
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">{m.name}</p>
                    <p className="whitespace-pre-wrap text-xs text-muted-foreground">{m.body}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {m.usadaPor > 0 && (
                      <span className="text-xs text-muted-foreground">em uso por {m.usadaPor}</span>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={ocupado}
                      onClick={() => {
                        setEditando(m.id)
                        setRascunho({ name: m.name, body: m.body })
                      }}
                    >
                      <Pencil className="h-4 w-4" aria-hidden />
                      <span className="sr-only">Editar mensagem</span>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={ocupado}
                      onClick={() =>
                        chamar(`/api/automacoes/mensagens/${m.id}`, { method: 'DELETE' })
                      }
                    >
                      <Trash2 className="h-4 w-4" aria-hidden />
                      <span className="sr-only">Excluir mensagem</span>
                    </Button>
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
