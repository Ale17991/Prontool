import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { ChevronLeft } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { can } from '@/lib/auth/rbac'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { listPatients } from '@/lib/core/patients/list'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ApplyTemplateForm, type TemplateField } from './apply-template-form'

export const dynamic = 'force-dynamic'

interface PageProps {
  params: { id: string }
}

export default async function UsarAnamneseTemplatePage({ params }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!can(session.role, 'anamnesis.write')) redirect('/analise/anamnese')

  const supabase = createSupabaseServiceClient()

  const { data: template, error } = await supabase
    .from('anamnesis_templates')
    .select('id, title, description, version, fields')
    .eq('id', params.id)
    .eq('tenant_id', session.tenantId)
    .maybeSingle()

  if (error) throw new Error(`load template: ${error.message}`)
  if (!template) notFound()

  const { items: patients } = await listPatients(supabase, {
    tenantId: session.tenantId,
    pageSize: 100,
  })

  const activePatients = patients.filter((p) => !p.anonymizedAt)
  const fields = (template.fields ?? []) as unknown as TemplateField[]

  return (
    <div className="space-y-6">
      <div>
        <Link
          href="/analise/anamnese"
          className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-800"
        >
          <ChevronLeft className="h-3 w-3" /> Voltar aos modelos
        </Link>
        <h1 className="mt-2 text-2xl font-black tracking-tight text-slate-900">
          Aplicar modelo — {template.title}{' '}
          <span className="ml-1 text-sm font-mono text-slate-400">v{template.version}</span>
        </h1>
        {template.description ? (
          <p className="mt-1 text-sm text-slate-500">{template.description}</p>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Preencher anamnese</CardTitle>
        </CardHeader>
        <CardContent>
          {activePatients.length === 0 ? (
            <p className="py-8 text-center text-sm text-slate-500">
              Nenhum paciente ativo no tenant. Cadastre um paciente antes de aplicar o modelo.
            </p>
          ) : (
            <ApplyTemplateForm
              templateId={template.id}
              fields={fields}
              patients={activePatients.map((p) => ({
                id: p.id,
                fullName: p.fullName || '(sem nome)',
                cpf: p.cpf,
              }))}
            />
          )}
        </CardContent>
      </Card>
    </div>
  )
}
