import { redirect } from 'next/navigation'

/**
 * Feature 051 — a conexão do número deixou de ter tela própria.
 *
 * Vincular o WhatsApp só existe para servir o lembrete: manter as duas coisas
 * em cards separados fazia a clínica configurar o canal numa tela e descobrir
 * na outra que faltava conectar. O painel vive agora em
 * `/configuracoes/lembretes`, gated pela mesma permissão `whatsapp.config`.
 *
 * A rota fica de pé como redirecionamento porque a URL circulou em suporte e
 * pode estar salva — devolver 404 para quem seguiu nossa própria instrução
 * seria gratuito.
 */
export default function WhatsAppPageMoved() {
  redirect('/configuracoes/lembretes')
}
