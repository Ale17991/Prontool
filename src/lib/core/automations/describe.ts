/**
 * Feature 056 — o nome que o gatilho recebe quando ninguém o nomeia.
 *
 * A clínica nomeia a AUTOMAÇÃO; o gatilho passou a nascer por baixo, no mesmo
 * ato. Mas a coluna `automation_triggers.name` é NOT NULL e única por clínica,
 * e o nome ainda aparece em dois lugares que importam: no registro de auditoria
 * e na mensagem de erro quando a associação é recusada por variável ausente.
 * Um "Gatilho 1" ali seria pior que inútil — obrigaria quem lê o log a abrir o
 * banco para descobrir de que automação se está falando.
 *
 * Daí um nome DERIVADO: rótulo da fonte mais os parâmetros em português. Ele é
 * único por (fonte, parâmetros) justamente porque inclui os parâmetros, que é a
 * mesma chave pela qual o gatilho é reaproveitado.
 */

import { duracaoTexto } from './sources/shared'
import type { AutomationSourceDef } from './types'

export function describeTrigger(
  fonte: AutomationSourceDef,
  params: Record<string, unknown>,
): string {
  const partes: string[] = []

  for (const campo of fonte.fields ?? []) {
    const valor = params[campo.name]
    if (valor === undefined || valor === null || valor === '') continue

    // A fonte é quem sabe se estes minutos foram escritos como dias ou como
    // horas — 1440 é as duas coisas. Sem perguntar a ela, quem pediu "24 horas
    // antes" via o gatilho se apresentar como "Antes da consulta — 1 dia", que é
    // outro envio.
    if (campo.kind === 'duration' && typeof valor === 'number') {
      partes.push(duracaoTexto(valor, Boolean(fonte.isAnchored?.(params))))
      continue
    }
    // Campo de escolha guarda ID (do hábito, da métrica): o rótulo legível
    // depende de uma consulta ao catálogo da clínica, e o nome do gatilho não
    // vale uma ida ao banco. O id truncado basta para distinguir dois gatilhos
    // da mesma fonte, que é a única função do sufixo.
    if (campo.kind === 'select' && typeof valor === 'string') {
      partes.push(valor.slice(0, 8))
      continue
    }
    partes.push(String(valor))
  }

  const sufixo = partes.length > 0 ? ` — ${partes.join(', ')}` : ''
  return `${fonte.label}${sufixo}`.slice(0, 80)
}
