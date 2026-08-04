import { ShieldCheck, TriangleAlert } from 'lucide-react'

/**
 * Feature 053 — o aviso que evita a clínica achar que a feature está quebrada.
 *
 * A base existente nasce SEM `outreach_opt_in`: o aceite de lembrete de
 * consulta foi dado para outra finalidade, e herdá-lo seria usar consentimento
 * fora do propósito para o qual foi obtido.
 *
 * O custo é concreto — no primeiro dia a feature entrega zero mensagem. Dizer
 * isso ANTES de a clínica ligar a primeira regra é a diferença entre ela
 * entender o que precisa fazer e abrir um chamado dizendo que não funciona.
 */
export function ConsentBanner({
  comAceite,
  ativos,
}: {
  comAceite: number
  ativos: number
}) {
  const nenhum = comAceite === 0

  if (nenhum) {
    return (
      <section className="rounded-xl border border-amber-200 bg-amber-50 p-4">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-amber-900">
          <TriangleAlert className="h-4 w-4" />
          Nenhum paciente aceitou receber essas mensagens ainda
        </h2>
        <p className="mt-2 text-sm text-amber-900/80">
          Mensagem de acompanhamento é uma finalidade diferente do lembrete de consulta, então
          o aceite precisa ser dado de novo — quem topou ser lembrado da consulta não topou por
          consequência ser acompanhado entre elas.
        </p>
        <p className="mt-2 text-sm text-amber-900/80">
          Você pode ligar as regras agora: elas ficam prontas e passam a valer conforme os
          pacientes forem aceitando. O aceite fica na ficha de cada paciente.
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-xl border border-slate-200 bg-white p-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-900">
        <ShieldCheck className="h-4 w-4 text-primary" />
        {comAceite} de {ativos} pacientes aceitaram receber acompanhamento
      </h2>
      <p className="mt-1 text-sm text-slate-500">
        As regras abaixo só alcançam quem aceitou. O aceite fica na ficha de cada paciente.
      </p>
    </section>
  )
}
