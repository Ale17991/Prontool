/**
 * Feature 017 — Política de privacidade do agendamento público (LGPD).
 *
 * Server component. Conteúdo padronizado conforme LGPD Art. 9 (7 itens
 * de transparência obrigatórios). Personaliza o nome da clínica via slug.
 *
 * Slug inválido cai em not-found (sem 404 explícito — usuário vai pra
 * landing genérica).
 */

import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { resolveTenantBySlug } from '@/lib/core/public-booking/resolve-tenant'

export const dynamic = 'force-dynamic'

export default async function PrivacidadePage({ params }: { params: { slug: string } }) {
  const supabase = createSupabaseServiceClient()
  const tenant = await resolveTenantBySlug(supabase, params.slug)
  if (!tenant) notFound()

  return (
    <article className="prose prose-slate max-w-none space-y-6 text-sm leading-relaxed text-slate-700">
      <header className="space-y-1">
        <Link
          href={`/agendar/${params.slug}`}
          className="text-sm text-link underline-offset-2 hover:underline"
        >
          ← Voltar para o agendamento
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">
          Política de privacidade do agendamento online
        </h1>
        <p className="text-slate-500">{tenant.displayName} — atualizada em maio/2026</p>
      </header>

      <section>
        <h2 className="text-base font-semibold text-slate-900">1. Finalidade do tratamento</h2>
        <p>
          Os dados que você nos fornece neste formulário são tratados com o objetivo exclusivo de
          identificar você como paciente, viabilizar o agendamento da consulta, enviar a confirmação
          por email e permitir o cancelamento online posterior. Não usamos seus dados para marketing
          nem os compartilhamos com terceiros sem o seu consentimento explícito.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-slate-900">2. Base legal</h2>
        <p>
          O tratamento se ampara na execução de contrato (atendimento clínico solicitado por você) e
          no seu consentimento explícito ao confirmar o agendamento, conforme art. 7º, V e I da Lei
          nº 13.709/2018 (LGPD).
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-slate-900">3. Dados coletados</h2>
        <ul className="list-inside list-disc">
          <li>Nome completo</li>
          <li>Email</li>
          <li>Telefone</li>
          <li>Data de nascimento</li>
          <li>CPF (opcional, apenas para reaproveitar cadastro existente)</li>
          <li>
            Hash anonimizado do seu endereço IP (não armazenamos o IP em texto claro; usado apenas
            para limitar requisições abusivas)
          </li>
        </ul>
      </section>

      <section>
        <h2 className="text-base font-semibold text-slate-900">4. Compartilhamento</h2>
        <p>
          Seus dados ficam restritos ao prontuário interno da {tenant.displayName} e são acessíveis
          apenas pela equipe autorizada da clínica. O envio do email de confirmação usa um provedor
          de email transacional (Resend) — apenas as informações estritamente necessárias (nome,
          data/hora, link de cancelar) trafegam por esse serviço.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-slate-900">5. Retenção</h2>
        <p>
          Mantemos seus dados pelo tempo em que você permanecer cadastrado(a) como paciente da
          clínica, observando os prazos legais aplicáveis à área da saúde (mínimo 20 anos para
          prontuário, conforme Resolução CFM nº 1.821/07). Os registros de tentativas de agendamento
          (hash de IP) são automaticamente apagados após 7 dias.
        </p>
      </section>

      <section>
        <h2 className="text-base font-semibold text-slate-900">6. Seus direitos</h2>
        <p>Você pode, a qualquer momento, solicitar à clínica:</p>
        <ul className="list-inside list-disc">
          <li>Acesso aos seus dados</li>
          <li>Correção de dados incompletos, inexatos ou desatualizados</li>
          <li>Anonimização ou eliminação</li>
          <li>Portabilidade para outro fornecedor</li>
          <li>Revogação do consentimento</li>
        </ul>
        {tenant.phone && (
          <p className="mt-2">
            Para exercer esses direitos, entre em contato com a clínica pelo telefone{' '}
            <strong>{tenant.phone}</strong>.
          </p>
        )}
      </section>

      <section>
        <h2 className="text-base font-semibold text-slate-900">7. Segurança</h2>
        <p>
          Empregamos criptografia em trânsito (HTTPS) e em repouso para dados sensíveis (CPF,
          contato, data de nascimento). Tokens de cancelamento são armazenados apenas como hash
          SHA-256. Tentativas abusivas de agendamento são limitadas por nosso sistema antifraude
          (Cloudflare Turnstile e rate-limit por hash de IP).
        </p>
      </section>

      <footer className="border-t border-border pt-4 text-xs text-slate-500">
        Esta política aplica-se exclusivamente ao link público de agendamento da{' '}
        {tenant.displayName}, hospedado por Clinni. Em caso de dúvidas sobre privacidade, entre em
        contato com a clínica.
      </footer>
    </article>
  )
}
