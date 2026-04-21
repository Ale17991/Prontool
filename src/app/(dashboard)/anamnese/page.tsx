import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronRight, FileJson, FileStack, Plus } from 'lucide-react'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { can } from '@/lib/auth/rbac'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'

interface TemplateRow {
  id: string
  title: string
  description: string | null
  version: number
  fields: unknown
  created_at: string
}

export default async function AnamneseTemplatesPage() {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!can(session.role, 'anamnesis.read')) redirect('/atendimentos')

  const supabase = createSupabaseServiceClient()
  const { data: raw } = await supabase
    .from('anamnesis_templates')
    .select('id, title, description, version, fields, created_at')
    .eq('tenant_id', session.tenantId)
    .order('title', { ascending: true })
    .order('version', { ascending: false })

  const templates = (raw ?? []) as TemplateRow[]
  const canWrite = can(session.role, 'anamnesis.write')

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">
            Modelos de anamnese
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Formulários clínicos versionados. Editar um modelo cria uma nova versão;
            anamneses já preenchidas continuam referenciando a versão original.
          </p>
        </div>
        {canWrite ? (
          <Link
            href="/anamnese/novo"
            className="inline-flex items-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white hover:bg-slate-800"
          >
            <Plus className="h-4 w-4" />
            Novo modelo
          </Link>
        ) : null}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm">
            <FileStack className="h-4 w-4" />
            {templates.length} modelo{templates.length === 1 ? '' : 's'} cadastrado
            {templates.length === 1 ? '' : 's'}
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          {templates.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <FileJson className="h-8 w-8 text-slate-300" />
              <p className="text-sm font-medium text-slate-500">
                Nenhum modelo cadastrado ainda.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Título</TableHead>
                  <TableHead>Versão</TableHead>
                  <TableHead>Campos</TableHead>
                  <TableHead>Criado em</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {templates.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>
                      <p className="font-semibold text-slate-900">{t.title}</p>
                      {t.description ? (
                        <p className="line-clamp-1 text-[11px] text-slate-500">
                          {t.description}
                        </p>
                      ) : null}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary" className="font-mono text-[11px]">
                        v{t.version}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {Array.isArray(t.fields) ? t.fields.length : 0}{' '}
                      {Array.isArray(t.fields) && t.fields.length === 1
                        ? 'campo'
                        : 'campos'}
                    </TableCell>
                    <TableCell className="text-xs text-slate-500">
                      {formatDate(t.created_at)}
                    </TableCell>
                    <TableCell className="text-right">
                      {canWrite ? (
                        <Link
                          href={`/anamnese/novo?clone=${t.id}`}
                          className="inline-flex items-center gap-1 text-xs font-bold text-primary"
                        >
                          Nova versão <ChevronRight className="h-3 w-3" />
                        </Link>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
