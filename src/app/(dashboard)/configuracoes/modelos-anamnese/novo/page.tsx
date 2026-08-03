import { redirect } from 'next/navigation'
import { getSession } from '@/lib/auth/get-session'
import { can } from '@/lib/auth/rbac'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { readyMadeTemplate } from '@/lib/core/anamnesis/ready-made'
import { AnamneseBuilder, type BuilderBase } from './anamnese-builder'

export const dynamic = 'force-dynamic'

interface PageProps {
  searchParams: { base?: string; modelo?: string; clone?: string }
}

/**
 * Builder de modelo de anamnese.
 *
 * Aceita dois pontos de partida além do zero:
 *  - `?modelo=<slug>` clona um modelo PRONTO do catálogo;
 *  - `?base=<id>` clona um modelo já salvo da clínica.
 *
 * Nos dois casos é CÓPIA: o novo nasce solto do original. Não confundir com
 * versionar — versão nova mantém o vínculo e é o que acontece ao EDITAR; aqui a
 * intenção é criar OUTRO modelo a partir de um que já serve.
 */
export default async function AnamneseBuilderPage({ searchParams }: PageProps) {
  const session = await getSession()
  if (!session) redirect('/login')
  if (!can(session.role, 'anamnesis.write')) redirect('/configuracoes/modelos-anamnese')

  let base: BuilderBase | null = null

  if (searchParams.modelo) {
    const m = readyMadeTemplate(searchParams.modelo)
    if (m) {
      base = {
        title: `${m.title} (cópia)`,
        description: m.description,
        fields: m.fields as BuilderBase['fields'],
      }
    }
  } else if (searchParams.base || searchParams.clone) {
    // `clone` = nova VERSÃO do mesmo modelo (mantém título e vínculo).
    // `base`  = modelo NOVO a partir deste (título ganha "(cópia)").
    const novaVersao = Boolean(searchParams.clone)
    const id = searchParams.clone ?? searchParams.base!
    const supabase = createSupabaseServiceClient()
    const { data } = await supabase
      .from('anamnesis_templates')
      .select('id, title, description, fields')
      .eq('tenant_id', session.tenantId)
      .eq('id', id)
      .maybeSingle()
    const row = data as
      | { id: string; title: string; description: string | null; fields: unknown }
      | null
    if (row) {
      base = {
        // Na cópia o título MUDA de saída: há UNIQUE (tenant, título, versão),
        // e salvar com o mesmo nome colidiria — o autor só descobriria ao
        // clicar em salvar, com o trabalho todo feito.
        title: novaVersao ? row.title : `${row.title} (cópia)`,
        description: row.description ?? '',
        fields: Array.isArray(row.fields) ? (row.fields as BuilderBase['fields']) : [],
        previousVersionId: novaVersao ? row.id : null,
      }
    }
  }

  return <AnamneseBuilder base={base} />
}
