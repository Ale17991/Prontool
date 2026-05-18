import Link from 'next/link'
import { redirect } from 'next/navigation'
import { ChevronRight, Plus, Search, User, Users } from 'lucide-react'
import type { SupabaseClient } from '@supabase/supabase-js'
import { getSession } from '@/lib/auth/get-session'
import { createSupabaseServerClient } from '@/lib/db/supabase-server'
import { listPatients } from '@/lib/core/patients/list'
import type { Database } from '@/lib/db/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDate } from '@/lib/utils'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: {
    q?: string
    page?: string
  }
}

export default async function PacientesPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')

  const page = Math.max(Number(searchParams.page ?? 1) || 1, 1)
  // list_patients_for_tenant RPC é SECURITY DEFINER, grant EXECUTE
  // concedido a authenticated — o server client (RLS) pode chamá-la.
  // Cast necessário porque @supabase/ssr expõe tipos ligeiramente
  // diferentes do @supabase/supabase-js que listPatients espera.
  const supabase = createSupabaseServerClient() as unknown as SupabaseClient<Database>
  let listResult
  let listError: { message: string; cause: string } | null = null
  try {
    listResult = await listPatients(supabase, {
      tenantId: session.tenantId,
      search: searchParams.q,
      page,
      pageSize: 25,
    })
  } catch (err) {
    // Em producao, o Next.js esconde a mensagem do throw via error.tsx.
    // Para admins, evitamos o throw e renderizamos a causa inline — assim
    // nao precisamos do digest pra debugar. Tambem logamos pra Vercel.
    const message = err instanceof Error ? err.message : String(err)
    console.error('[pacientes-list] listPatients failed', {
      tenantId: session.tenantId,
      role: session.role,
      message,
      stack: err instanceof Error ? err.stack : undefined,
    })
    if (session.role !== 'admin') throw err
    listError = { message, cause: classifyCause(message) }
    listResult = { items: [], total: 0, page: 1, pageSize: 25 }
  }
  const { items, total, pageSize } = listResult

  const totalPages = Math.max(Math.ceil(total / pageSize), 1)
  const canCreate = session.role === 'admin' || session.role === 'recepcionista'

  return (
    <div className="space-y-6">
      <div className="flex flex-col items-start justify-between gap-4 md:flex-row md:items-center">
        <div>
          <h1 className="text-2xl font-black tracking-tight text-slate-900">Pacientes</h1>
          <p className="mt-1 text-sm text-slate-500">
            {total} paciente{total === 1 ? '' : 's'} no tenant
          </p>
        </div>
        <div className="flex w-full flex-col items-stretch gap-2 md:w-auto md:flex-row md:items-center">
          {canCreate ? (
            <Link
              href="/operacao/pacientes/novo"
              className="inline-flex items-center justify-center gap-2 rounded-md bg-slate-900 px-4 py-2 text-xs font-bold uppercase tracking-widest text-white hover:bg-slate-800"
            >
              <Plus className="h-4 w-4" />
              Novo paciente
            </Link>
          ) : null}
        <form method="get" className="flex w-full items-center gap-2 md:w-auto">
          <div className="relative flex-1 md:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <Input
              name="q"
              placeholder="Buscar por nome ou CPF…"
              defaultValue={searchParams.q ?? ''}
              className="pl-10"
            />
          </div>
          <Button type="submit" variant="outline">
            Buscar
          </Button>
        </form>
        </div>
      </div>

      {listError ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="space-y-2 p-4 text-sm">
            <p className="font-bold text-destructive">
              Falha ao carregar pacientes (visível só para admin):
            </p>
            <p className="font-mono text-[11px] text-rose-800">{listError.cause}</p>
            <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-white px-3 py-2 font-mono text-[11px] text-slate-700">
              {listError.message}
            </pre>
          </CardContent>
        </Card>
      ) : null}

      <Card>
        <CardContent className="p-0">
          {items.length === 0 ? (
            <div className="flex flex-col items-center gap-3 px-6 py-16 text-center">
              <Users className="h-8 w-8 text-slate-300" />
              <p className="text-sm font-medium text-slate-500">
                {searchParams.q
                  ? 'Nenhum paciente encontrado para a busca.'
                  : 'Nenhum paciente cadastrado ainda.'}
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Nome</TableHead>
                  <TableHead>CPF</TableHead>
                  <TableHead>Telefone</TableHead>
                  <TableHead>Cadastrado em</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((p) => (
                  <TableRow key={p.id} className="group">
                    <TableCell>
                      <div className="flex items-center gap-3">
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-primary transition-colors group-hover:bg-primary group-hover:text-white">
                          <User className="h-4 w-4" />
                        </div>
                        <span className="font-bold text-slate-900">
                          {p.anonymizedAt ? '[anonimizado]' : p.fullName || '—'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-slate-600">
                      {p.anonymizedAt ? '—' : p.cpf || '—'}
                    </TableCell>
                    <TableCell className="text-slate-700">{p.phone || '—'}</TableCell>
                    <TableCell className="text-slate-700">{formatDate(p.createdAt)}</TableCell>
                    <TableCell>
                      {p.anonymizedAt ? (
                        <Badge variant="secondary">Anonimizado</Badge>
                      ) : (
                        <Badge variant="success">Ativo</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/operacao/pacientes/${p.id}`}
                        className="inline-flex items-center gap-1 text-xs font-bold text-link hover:text-link-hover opacity-0 transition-opacity group-hover:opacity-100"
                      >
                        Abrir <ChevronRight className="h-3 w-3" />
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {totalPages > 1 ? (
        <Pagination currentPage={page} totalPages={totalPages} search={searchParams.q} />
      ) : null}
    </div>
  )
}

/** Classifica a mensagem real em uma causa-raiz humanamente útil. */
function classifyCause(msg: string): string {
  if (/PATIENT_DATA_ENCRYPTION_KEY/.test(msg)) {
    return 'PATIENT_DATA_ENCRYPTION_KEY ausente nas envs da Vercel.'
  }
  if (/Could not find the function|PGRST202|PGRST203|function .* does not exist/i.test(msg)) {
    return 'RPC list_patients_for_tenant não existe — aplicar migration 0044 em prod.'
  }
  if (/relation .* does not exist|PGRST204|PGRST205/i.test(msg)) {
    return 'Tabela referenciada não existe — aplicar migrations pendentes em prod.'
  }
  if (/column .* does not exist|42703/i.test(msg)) {
    return 'Coluna referenciada não existe — aplicar migrations pendentes em prod.'
  }
  if (/pgp_sym_decrypt|Wrong key or corrupt data|decryption failed/i.test(msg)) {
    return 'PATIENT_DATA_ENCRYPTION_KEY divergente da chave que cifrou os dados em prod.'
  }
  if (/permission denied/i.test(msg)) {
    return 'permission denied — RLS ou GRANT faltando para authenticated.'
  }
  if (/jwt_tenant_id|tenant_id is null|JWT|claim/i.test(msg)) {
    return 'JWT sem tenant_id — habilitar auth hook custom claims no Supabase.'
  }
  return 'Causa não identificada — ver mensagem completa abaixo.'
}

function Pagination({
  currentPage,
  totalPages,
  search,
}: {
  currentPage: number
  totalPages: number
  search?: string
}) {
  const prev = Math.max(currentPage - 1, 1)
  const next = Math.min(currentPage + 1, totalPages)
  const qs = (p: number) => {
    const usp = new URLSearchParams()
    if (search) usp.set('q', search)
    if (p > 1) usp.set('page', String(p))
    const s = usp.toString()
    return s ? `?${s}` : ''
  }
  return (
    <div className="flex items-center justify-between text-xs text-slate-500">
      <span>
        Página {currentPage} de {totalPages}
      </span>
      <div className="flex items-center gap-2">
        {currentPage > 1 ? (
          <Link
            href={`/operacao/pacientes${qs(prev)}`}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 font-medium hover:bg-slate-50"
          >
            Anterior
          </Link>
        ) : null}
        {currentPage < totalPages ? (
          <Link
            href={`/operacao/pacientes${qs(next)}`}
            className="rounded-md border border-slate-200 bg-white px-3 py-1.5 font-medium hover:bg-slate-50"
          >
            Próxima
          </Link>
        ) : null}
      </div>
    </div>
  )
}
