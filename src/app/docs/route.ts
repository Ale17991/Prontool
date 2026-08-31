import { documentoHtml } from './conteudo'

/**
 * Documentação pública da API de parceiros, em app.clinnipro.com.br/docs.
 *
 * É Route Handler e não página porque o documento é HTML completo: assim o
 * `<head>` é nosso (charset, viewport, fonte) e não há conversão para JSX, onde
 * um `class` vira `className` esquecido e o estilo some sem erro de build.
 *
 * PÚBLICA de propósito — é para o desenvolvedor do parceiro, que por definição
 * não tem sessão aqui. O middleware precisa deixar `/docs` passar; sem isso
 * quem abre sem cookie é mandado para `/login`. Não há segredo nesta página:
 * ela descreve endpoints que exigem chave.
 *
 * `noindex` no HTML porque é documentação de integração privada — não deve
 * concorrer nos buscadores com as páginas de produto.
 */

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(req: Request): Promise<Response> {
  // A URL base sai do host da própria requisição quando não há env — assim os
  // exemplos de `curl` funcionam colados, em produção e em pré-visualização,
  // sem alguém lembrar de trocar o domínio à mão.
  const origem = process.env.NEXT_PUBLIC_APP_URL || new URL(req.url).origin

  return new Response(documentoHtml(origem), {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
