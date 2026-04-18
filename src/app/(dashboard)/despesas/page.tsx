import { redirect } from 'next/navigation'
import { TrendingDown } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { ComingSoon } from '../_placeholders/coming-soon'

export const dynamic = 'force-dynamic'

export default async function DespesasPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'admin') redirect('/atendimentos')

  return (
    <ComingSoon
      title="Despesas"
      subtitle="Registro e categorização de custos operacionais da clínica."
      icon={TrendingDown}
      description="Permitirá cadastrar despesas fixas e variáveis (aluguel, insumos, folha), categorizar por centro de custo e cruzar com a receita dos atendimentos para apurar margem operacional por período."
      plannedScope={[
        'Cadastro manual de despesas com categoria, fornecedor e data',
        'Importação de extratos bancários via OFX (read-only) com matching',
        'Apuração de margem no relatório mensal (receita líquida − despesas)',
        'RBAC: cadastro restrito a admin; financeiro vê consolidado',
      ]}
      dependsOn={[
        'supabase/migrations/00XX_expenses.sql — tabela expenses + categorias',
        'src/lib/core/expenses/* — domain layer',
        'src/lib/core/reports/monthly.ts — extensão para considerar despesas',
      ]}
      relatedLinks={[
        { href: '/atendimentos', label: 'Atendimentos' },
        { href: '/auditoria', label: 'Auditoria' },
      ]}
    />
  )
}
