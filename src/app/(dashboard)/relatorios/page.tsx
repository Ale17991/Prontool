import { redirect } from 'next/navigation'
import { LayoutDashboard } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { can } from '@/lib/auth/rbac'
import { ComingSoon } from '../_placeholders/coming-soon'

export const dynamic = 'force-dynamic'

export default async function RelatoriosPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!can(session.role, 'report.read')) redirect('/atendimentos')

  return (
    <ComingSoon
      title="Relatórios mensais"
      subtitle="Receita, produção por médico e comissão líquida do mês com export PDF/Excel."
      icon={LayoutDashboard}
      description="US4 do spec. Agrega dados de appointments_effective para o período (mês default), mostra receita por plano, produção por médico e totais considerando estornos. Exporta em PDF (@react-pdf/renderer) e Excel (exceljs) com os mesmos números da tela, garantindo paridade (SC-006)."
      plannedScope={[
        'Seletor de período (mês) com default no mês corrente',
        'Abas: Receita por plano | Produção por médico | Totais',
        'Export PDF e Excel com mesmos números da tela',
        'Performance alvo: < 30 s para 5.000 atendimentos em um mês (SC-004)',
      ]}
      dependsOn={[
        'src/lib/core/reports/monthly.ts — T139 (agregação)',
        'src/lib/core/reports/export-pdf.tsx — T140',
        'src/lib/core/reports/export-excel.ts — T141',
        'src/app/api/relatorios/mensal/* — T142–T143',
      ]}
      relatedLinks={[
        { href: '/atendimentos', label: 'Atendimentos' },
        { href: '/precos', label: 'Preços' },
      ]}
    />
  )
}
