import { redirect } from 'next/navigation'
import type { SupabaseClient } from '@supabase/supabase-js'
import { MessageCircle } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { can } from '@/lib/auth/rbac'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import type { Database } from '@/lib/db/types'
import { getTenantEntitlements } from '@/lib/core/entitlements/read'
import { getWhatsAppConnection } from '@/lib/core/whatsapp/config'
import { ConnectionPanel } from './connection-panel'

/**
 * Feature 051 — US1 — Conexão de WhatsApp da clínica.
 *
 * RBAC no servidor (FR-024): quem não pode configurar não chega a ver a tela.
 * Esconder botão não é mecanismo de segurança — as server actions revalidam.
 */

export const dynamic = 'force-dynamic'

export default async function WhatsAppPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!can(session.role, 'whatsapp.config')) redirect('/configuracoes')

  // Rollout por clínica (051): o canal ainda não está entregue por completo —
  // conectar o número funciona, mas o lembrete só passa a sair por WhatsApp na
  // US2. Enquanto isso, só as clínicas com o módulo ligado veem a tela.
  // Esconder o card do hub não basta: a URL é adivinhável.
  const rls = createSupabaseServerClient() as unknown as SupabaseClient<Database>
  const ent = await getTenantEntitlements(rls, session.tenantId)
  if (!ent.hasModule('whatsapp')) redirect('/configuracoes')

  // Cliente de serviço: `api_key_enc` não é projetada para usuário autenticado.
  // O escopo de tenant é explícito na query (Princípio III).
  const supabase = createSupabaseServiceClient() as unknown as SupabaseClient<Database>
  const connection = await getWhatsAppConnection(supabase, session.tenantId).catch(() => null)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-900">
          <MessageCircle className="h-6 w-6 text-primary" />
          WhatsApp
        </h1>
        <p className="mt-1 max-w-2xl text-sm text-slate-500">
          Vincule o WhatsApp da clínica para enviar lembretes de consulta por lá. O número fica
          conectado como um aparelho a mais — o celular precisa continuar ligado e com internet.
        </p>
      </div>

      <ConnectionPanel initial={connection} />

      <section className="rounded-xl border border-slate-200 bg-slate-50 p-5">
        <h2 className="text-sm font-semibold text-slate-900">Antes de conectar</h2>
        <ul className="mt-2 space-y-1.5 text-sm text-slate-600">
          <li>
            • Use o número <strong>da clínica</strong>, não o pessoal de alguém. Ele fica vinculado
            ao sistema.
          </li>
          <li>
            • Prefira um número <strong>com histórico de conversas reais</strong>. Chip novo
            disparando mensagem em série é o perfil que o WhatsApp mais bloqueia.
          </li>
          <li>
            • O celular precisa ficar ligado e com internet. Se a sessão cair, os lembretes param
            até você reconectar.
          </li>
          <li>
            • Depois de conectar, ligue o canal em <strong>Lembretes automáticos</strong> — é lá
            que se escolhe se o aviso sai por e-mail, por WhatsApp ou pelos dois.
          </li>
        </ul>
      </section>
    </div>
  )
}
