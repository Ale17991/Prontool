import { redirect } from 'next/navigation'
import { ClipboardCheck } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { ComingSoon } from '../_placeholders/coming-soon'

export const dynamic = 'force-dynamic'

export default async function AnamnesePage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (session.role !== 'admin') redirect('/atendimentos')

  return (
    <ComingSoon
      title="Modelos de anamnese"
      subtitle="Templates clínicos reutilizáveis para evolução estruturada de pacientes."
      icon={ClipboardCheck}
      description="Admin cadastra modelos com campos tipados (texto, número, data, checkbox, radio, select). Profissional aplica um modelo ao paciente e as respostas viram um clinical_record tipo `anamnese` já vinculado, auditável, e exportável em PDF."
      plannedScope={[
        'Editor de modelo com ordenação de campos e flag de obrigatoriedade',
        'Versionamento: editar modelo não altera anamneses já preenchidas',
        'Impressão/PDF com cabeçalho da clínica e assinatura do profissional',
        'Biblioteca inicial: anamnese fisio, odonto, clínica geral',
      ]}
      dependsOn={[
        'supabase/migrations/00XX_anamnesis_templates.sql — templates + fields',
        'src/lib/core/anamnesis/* — CRUD + versionamento',
        'clinical_records.anamnesis_data JSONB já existe (migration 0025)',
      ]}
      relatedLinks={[
        { href: '/pacientes', label: 'Pacientes' },
      ]}
    />
  )
}
