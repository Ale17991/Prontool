'use client'

/**
 * Feature 056 — o histórico de ocorrências (FR-019).
 *
 * A pergunta que esta tela responde é sempre a mesma: "por que fulano não
 * recebeu?". Por isso o motivo aparece por extenso, e não só o código do
 * desfecho — "impedido_sem_consentimento" é diagnóstico para quem escreveu o
 * motor, não para quem opera a clínica.
 *
 * Carrega sob demanda, e não junto com a página: o histórico é a coisa que
 * menos gente abre e a que mais linhas tem.
 */

import { useState } from 'react'
import { History, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'

export interface OcorrenciaDTO {
  id: string
  quando: string
  paciente: string | null
  automacao: string
  desfecho: string
  motivo: string | null
  entrega: string | null
}

/**
 * O desfecho em português da clínica. Cada texto diz O QUE FAZER a respeito
 * quando há algo a fazer — "sem consentimento" sozinho não sugere que existe uma
 * chave para ligar na ficha do paciente.
 */
const DESFECHO: Record<string, string> = {
  pendente: 'Em andamento',
  enviado: 'Enviada',
  suprimido_teto_paciente: 'Segurada pelo limite diário do paciente',
  suprimido_teto_clinica: 'Segurada pelo limite do ciclo — sai nos próximos dias',
  impedido_sem_consentimento: 'Paciente sem consentimento para automações',
  impedido_sem_telefone: 'Paciente sem telefone válido no cadastro',
  impedido_sem_whatsapp: 'O número do paciente não tem WhatsApp — confira o cadastro',
  impedido_variavel_ausente: 'Faltou dado para preencher a mensagem',
  impedido_sem_conexao: 'WhatsApp da clínica fora do ar no momento do envio',
  falhou: 'Falhou',
}

const ENTREGA: Record<string, string> = {
  sent: 'saiu',
  delivered: 'entregue',
  read: 'lida',
  error: 'erro na entrega',
}

export function OcorrenciasPanel() {
  const [linhas, setLinhas] = useState<OcorrenciaDTO[] | null>(null)
  const [carregando, setCarregando] = useState(false)
  const [erro, setErro] = useState<string | null>(null)

  async function carregar() {
    setCarregando(true)
    setErro(null)
    try {
      const res = await fetch('/api/automacoes/ocorrencias?limite=50')
      if (!res.ok) {
        setErro('Não foi possível carregar o histórico.')
        return
      }
      const body = (await res.json()) as { ocorrencias: OcorrenciaDTO[] }
      setLinhas(body.ocorrencias)
    } finally {
      setCarregando(false)
    }
  }

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-medium">Histórico</h2>
      <p className="text-sm text-muted-foreground">
        Cada avaliação que resultou em envio, supressão ou impedimento, com o motivo.
      </p>

      <Button variant="outline" size="sm" onClick={carregar} disabled={carregando}>
        {carregando ? (
          <Loader2 className="mr-1 h-4 w-4 animate-spin" aria-hidden />
        ) : (
          <History className="mr-1 h-4 w-4" aria-hidden />
        )}
        {linhas ? 'Atualizar' : 'Ver as últimas 50'}
      </Button>

      {erro && <p className="text-sm text-destructive">{erro}</p>}

      {linhas && linhas.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nada ainda. O ciclo roda uma vez por dia — se você acabou de ativar, o histórico aparece
          depois da próxima execução.
        </p>
      )}

      {linhas && linhas.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <thead className="text-left text-xs uppercase text-muted-foreground">
              <tr>
                <th className="p-2">Quando</th>
                <th className="p-2">Paciente</th>
                <th className="p-2">Automação</th>
                <th className="p-2">Desfecho</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {linhas.map((o) => (
                <tr key={o.id}>
                  <td className="whitespace-nowrap p-2 text-muted-foreground">
                    {new Date(o.quando).toLocaleString('pt-BR', {
                      day: '2-digit',
                      month: '2-digit',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  {/* Travessão, nunca vazio: ausência de nome precisa parecer
                      ausência, e não uma célula que a tela esqueceu de pintar. */}
                  <td className="p-2">{o.paciente ?? '—'}</td>
                  <td className="p-2 text-muted-foreground">{o.automacao}</td>
                  <td className="p-2">
                    <span>{DESFECHO[o.desfecho] ?? o.desfecho}</span>
                    {o.entrega && (
                      <span className="text-muted-foreground">
                        {' '}
                        · {ENTREGA[o.entrega] ?? o.entrega}
                      </span>
                    )}
                    {o.motivo && (
                      <span className="block text-xs text-muted-foreground">{o.motivo}</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
