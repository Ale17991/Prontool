import type { ReactNode } from 'react'
import { createSupabaseServiceClient } from '@/lib/db/supabase-service'
import { getPortalThemeBySlug } from '@/lib/core/patient-portal/theme-for-slug'
import { portalThemeToCss } from '@/lib/core/patient-portal/theme'

/**
 * Feature 058 — a paleta da clínica, aplicada ao portal inteiro.
 *
 * Fica no layout de `[slug]` e não em cada página por dois motivos. É o único
 * ponto por onde passam TODAS as telas do portal, inclusive a de login — e é
 * justamente ali, antes de entrar, que o paciente precisa reconhecer a clínica.
 * E é o que faz a próxima área nascer temada sem ninguém lembrar de nada, do
 * mesmo jeito que `openPortalPage` faz com sessão e permissão.
 *
 * O tema sai como bloco `<style>` sobre `:root`, não como `style` inline num
 * wrapper. A diferença aparece na rolagem: variável presa a um `<div>` não
 * alcança o `<body>`, e o fundo do produto reapareceria na sobra de rolagem e
 * na barra do navegador — a clínica veria a própria cor emoldurada pela nossa.
 * As regras de `globals.css` vivem em `@layer base`, e estilo sem camada vence
 * estilo em camada, então este bloco não precisa de `!important` nem de
 * especificidade inventada.
 *
 * Nada do que a clínica digitou chega cru ao CSS: `portalThemeToCss` só emite
 * números formatados pela derivação. Cor inválida nem chega aqui — vira `null`
 * na leitura e o portal abre na paleta padrão (FR-004/FR-005).
 *
 * A consulta é própria e enxuta (só as duas colunas). `openPortalPage` também
 * resolve a clínica, mas resolve muito mais — nome e URL assinada do logo — e
 * um layout não recebe o que a página apurou. Repetir duas colunas custa menos
 * que assinar o logo duas vezes por acesso.
 */
export default async function PortalSlugLayout({
  children,
  params,
}: {
  children: ReactNode
  params: { slug: string }
}) {
  const theme = await getPortalThemeBySlug(createSupabaseServiceClient(), params.slug)

  return (
    <>
      {theme ? <style dangerouslySetInnerHTML={{ __html: portalThemeToCss(theme) }} /> : null}
      {children}
    </>
  )
}
