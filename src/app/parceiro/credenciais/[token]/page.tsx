import { AlertTriangle, KeyRound } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import type { Database } from '@/lib/db/types'
import { peekCredentialLink } from '@/lib/core/partners/credential-link'
import { Revelar } from './revelar'

/**
 * Entrega da credencial de parceiro.
 *
 * Pública: quem abre é o desenvolvedor do parceiro, que não tem conta aqui. A
 * autenticação é a posse do token de 256 bits na URL — o middleware precisa
 * deixar `/parceiro/` passar, senão esta página manda para `/login` quem ela
 * existe para atender.
 *
 * O GET apenas CONSULTA o estado do link. Revelar é um POST (Server Action),
 * porque cliente de e-mail e antivírus corporativo pré-carregam links e um GET
 * que consome faria a credencial ser queimada por um robô.
 */

export const dynamic = 'force-dynamic'

export default async function CredenciaisParceiroPage({ params }: { params: { token: string } }) {
  const sb = createSupabaseServiceClient() as unknown as SupabaseClient<Database>
  const info = await peekCredentialLink(sb, params.token)

  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-50 px-4 py-12">
      <div className="w-full max-w-xl">
        <div className="mb-6 flex items-center gap-2">
          <KeyRound className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-black tracking-tight text-slate-900">
            Credencial de API — Clinni
          </h1>
        </div>

        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          {info.status === 'valido' ? (
            <Revelar token={params.token} parceiro={info.parceiro} />
          ) : (
            <div className="flex items-start gap-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
              <div>
                <p className="text-sm font-semibold text-slate-900">
                  {info.status === 'usado'
                    ? 'Este link já foi usado'
                    : info.status === 'expirado'
                      ? 'Este link expirou'
                      : 'Link inválido'}
                </p>
                <p className="mt-1 text-sm text-slate-600">
                  {info.status === 'usado'
                    ? 'A credencial aparece uma única vez, por segurança. Peça uma nova à equipe Clinni — a anterior continua válida se você a guardou.'
                    : info.status === 'expirado'
                      ? 'Peça um novo link à equipe Clinni.'
                      : 'Confira se o endereço foi copiado por inteiro.'}
                </p>
              </div>
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-xs text-slate-400">
          Documentação da API em{' '}
          <a className="font-medium text-slate-500 hover:underline" href="/docs">
            app.clinnipro.com.br/docs
          </a>
        </p>
      </div>
    </main>
  )
}
