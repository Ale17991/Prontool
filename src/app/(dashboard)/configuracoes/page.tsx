import { redirect } from 'next/navigation'
import { Settings } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { ComingSoon } from '@/app/(dashboard)/_placeholders/coming-soon'

export const dynamic = 'force-dynamic'

export default async function ConfiguracoesPage() {
  const session = await getSession()
  if (!session) redirect('/login')

  return (
    <ComingSoon
      title="Configurações"
      subtitle="Administração do tenant, integrações e preferências"
      icon={Settings}
      description="Este é o hub central para configurações do tenant — webhook do GHL, chaves de integração, preferências de usuários, papéis e feature flags. O escopo abaixo é o que está previsto; nada aqui é funcional ainda."
      plannedScope={[
        'Gerenciar usuários, papéis e convites do tenant',
        'Rotação de segredo do webhook GHL e chave de criptografia de PII',
        'Configurar integração com GHL (location id, proxy de operações)',
        'Toggle de feature flags por tenant',
        'Preferências de e-mail e destinatários de alertas operacionais',
      ]}
    />
  )
}
