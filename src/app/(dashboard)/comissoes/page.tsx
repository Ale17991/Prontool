import { redirect } from 'next/navigation'
import { Calculator } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { ComingSoon } from '../_placeholders/coming-soon'

export const dynamic = 'force-dynamic'

export default async function ComissoesPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'admin') redirect('/atendimentos')

  return (
    <ComingSoon
      title="Comissões"
      subtitle="Cadastro de médicos e gestão do histórico de comissões (US3)."
      icon={Calculator}
      description="US3 do spec. Admin cadastra médicos com CRM + comissão inicial, altera comissão com vigência futura preservando histórico imutável (trigger append-only em doctor_commission_history). Atendimentos antigos mantêm o frozen_commission_bps do momento da criação — mudanças só afetam atendimentos futuros."
      plannedScope={[
        'CRUD de médicos com validação de CRM único por tenant',
        'Histórico de comissões com vigência (append-only, imutável)',
        'Telas /medicos e /medicos/[id] com timeline de comissões',
        'RBAC: admin-only para write; recepcionista e profissional veem read-only',
      ]}
      dependsOn={[
        'src/lib/core/doctors/* — create.ts, list.ts, update.ts (T123–T125)',
        'src/lib/core/commissions/create-version.ts — append-only write',
        'src/app/api/medicos/* — T126–T128',
        'Schema já existe: doctors + doctor_commission_history (migration 0005)',
      ]}
      relatedLinks={[
        { href: '/atendimentos', label: 'Atendimentos' },
        { href: '/auditoria', label: 'Auditoria' },
      ]}
    />
  )
}
