import type { Metadata } from 'next'
import type { ReactNode } from 'react'

/**
 * Política de Privacidade — página PÚBLICA, sem login e sem layout do
 * dashboard. Mora no app (e não na landing) porque é o app que pede os dados:
 * o domínio desta página é o mesmo do OAuth do Google, o que remove qualquer
 * ambiguidade para quem revisa.
 *
 * PRECISA estar na lista de rotas públicas do `src/middleware.ts` — sem isso,
 * um visitante não autenticado (o revisor do Google, por exemplo) é
 * redirecionado para /login e a verificação é reprovada por "política
 * inacessível". A exclusão já foi adicionada lá; se um dia esta rota mudar de
 * caminho, mude nos dois lugares.
 *
 * Serve a dois públicos ao mesmo tempo:
 *  1. Titulares e clínicas, sob a LGPD (Lei nº 13.709/2018).
 *  2. A revisão do Google, que exige política acessível declarando quais dados
 *     das APIs dele são acessados e a conformidade com o Limited Use. Sem a
 *     seção 4, a verificação do escopo sensível `calendar.events` é reprovada.
 *
 * >>> PREENCHER antes de divulgar: identificação do controlador. Uma política
 * sem isso não cumpre o art. 9º da LGPD. Não há CNPJ próprio hoje — ver o
 * comentário em `controlador` abaixo.
 */

const PRIVACY_EMAIL = 'privacidade@clinnipro.com.br'
const ATUALIZADA_EM = '18 de agosto de 2026'

/**
 * A ClinniPro é um produto; quem responde por ele é a Homio. A identificação
 * do controlador é do art. 9º da LGPD e precisa ser da PESSOA JURÍDICA real,
 * não da marca — é ela que responde a pedido de titular e a autoridade.
 */
const controlador = {
  nome: 'Homio Gestão e Sistemas Ltda',
  documento: 'inscrita no CNPJ sob o nº 54.936.237/0001-08',
  endereco: 'Rua Henrique Novaes, 88, sala 605, Centro, Vitória/ES, CEP 29010-923',
}

export const metadata: Metadata = {
  title: 'Política de Privacidade · ClinniPro',
  description:
    'Como a ClinniPro trata dados pessoais: finalidades, bases legais, direitos do titular e uso dos dados das APIs do Google.',
}

export default function PoliticaDePrivacidadePage() {
  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-slate-200">
        <div className="mx-auto max-w-3xl px-6 py-5">
          <span className="text-sm font-black tracking-tight text-slate-900">ClinniPro</span>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-14">
        <p className="text-[11px] font-bold uppercase tracking-widest text-slate-400">
          Documento legal
        </p>
        <h1 className="mt-3 text-3xl font-black tracking-tight text-slate-900">
          Política de Privacidade
        </h1>
        <p className="mt-3 text-xs text-slate-500">Última atualização: {ATUALIZADA_EM}</p>

        <p className="mt-8 text-[15px] leading-relaxed text-slate-700">
          Esta política explica quais dados pessoais a ClinniPro trata, por quê, com que base legal,
          por quanto tempo e quais direitos você tem. Ela vale para o sistema em
          app.clinnipro.com.br, para o site clinnipro.com.br e para as integrações que a clínica
          escolher ativar.
        </p>

        <Section title="1. Quem trata os seus dados">
          <P>
            A ClinniPro é operada por {controlador.nome}
            {controlador.documento ? `, ${controlador.documento}` : ''}, com endereço em{' '}
            {controlador.endereco}.
          </P>
          <P>
            <B>A ClinniPro atua em dois papéis diferentes</B>, e a distinção determina a quem você
            deve dirigir cada pedido:
          </P>
          <Ul>
            <Li>
              <B>Controladora</B> dos dados de quem se relaciona diretamente conosco: quem pede uma
              demonstração, contrata o sistema ou usa uma conta de acesso (nome, e-mail, telefone,
              dados de cobrança e registros de uso).
            </Li>
            <Li>
              <B>Operadora</B> dos dados de pacientes que a clínica registra no sistema. Nesse caso{' '}
              <B>a clínica é a controladora</B>: é ela quem decide quais dados coleta e por quê, e
              nós apenas os tratamos segundo as instruções dela e o contrato. Pedidos sobre dados de
              paciente devem ser dirigidos à clínica que o atende — se chegarem a nós, os
              encaminhamos a ela.
            </Li>
          </Ul>
        </Section>

        <Section title="2. Dados que tratamos">
          <P>
            <B>Como controladora.</B> Nome, e-mail, telefone, empresa e cargo informados em
            formulários; dados de contratação e cobrança; dados de acesso (identificador de usuário,
            endereço IP, data e hora, ações realizadas no sistema); e o conteúdo de comunicações que
            você nos envia.
          </P>
          <P>
            <B>Como operadora, por conta da clínica.</B> Dados cadastrais e de contato do paciente, e
            dados de saúde registrados no atendimento — histórico, anamnese, evolução, prescrições,
            exames, medidas e planos terapêuticos. Dados de saúde são <B>dados pessoais sensíveis</B>{' '}
            na LGPD e recebem as proteções descritas na seção 7.
          </P>
        </Section>

        <Section title="3. Finalidades e bases legais">
          <Ul>
            <Li>
              <B>Prestar o serviço contratado</B> — execução de contrato (art. 7º, V).
            </Li>
            <Li>
              <B>Responder a pedidos de demonstração e contato comercial</B> — procedimentos
              preliminares a contrato, a pedido do titular (art. 7º, V).
            </Li>
            <Li>
              <B>Segurança, prevenção a fraude e trilha de auditoria</B> — legítimo interesse (art.
              7º, IX) e cumprimento de obrigação legal (art. 7º, II).
            </Li>
            <Li>
              <B>Obrigações fiscais e contábeis</B> — obrigação legal (art. 7º, II).
            </Li>
            <Li>
              <B>Dados de saúde do paciente</B> — tratados para tutela da saúde, por profissionais de
              saúde ou serviços de saúde (art. 11, II, “f”), sob responsabilidade da clínica
              controladora.
            </Li>
          </Ul>
          <P>
            Não usamos dados pessoais para publicidade comportamental, não os vendemos e não os
            cedemos a terceiros para fins de marketing.
          </P>
        </Section>

        <Section title="4. Integração com o Google Agenda">
          <P>
            A conexão com o Google Agenda é <B>opcional</B> e ativada individualmente por cada
            profissional de saúde, na conta Google dele. Enquanto ninguém conectar, não acessamos
            nada do Google.
          </P>
          <P>
            <B>Quais dados acessamos.</B> Ao conectar, o profissional autoriza dois acessos, e nenhum
            outro:
          </P>
          <Ul>
            <Li>
              <C>calendar.events</C> — criar, atualizar e remover, na agenda dele, os eventos
              correspondentes aos atendimentos marcados no sistema; e consultar seus horários
              ocupados.
            </Li>
            <Li>
              <C>userinfo.email</C> — exibir na tela de configuração qual conta Google foi conectada,
              para que ele confirme que vinculou a correta.
            </Li>
          </Ul>
          <P>
            <B>Como usamos.</B> Quando um atendimento é agendado, criamos o evento correspondente na
            agenda do profissional; quando é cancelado, removemos o evento. Além disso, lemos os{' '}
            <B>intervalos ocupados</B> da agenda dele para bloquear esses horários no sistema e
            impedir agendamento em conflito. Desses compromissos particulares registramos apenas o
            horário: <B>título, participantes, local e descrição não são lidos nem armazenados</B>, e
            para a clínica aquele intervalo aparece somente como indisponível.
          </P>
          <P>
            <B>Uso limitado.</B> O uso e a transferência, por parte da ClinniPro, das informações
            recebidas das APIs do Google seguem a{' '}
            <A href="https://developers.google.com/terms/api-services-user-data-policy">
              Google API Services User Data Policy
            </A>
            , inclusive os requisitos de Uso Limitado (<em>Limited Use</em>). Em termos concretos:
            esses dados são usados exclusivamente para as funções descritas acima, visíveis ao
            próprio usuário; não são vendidos; não alimentam publicidade; não são usados para treinar
            modelos de inteligência artificial generalizados; e não são transferidos a terceiros,
            exceto quando necessário para prestar o serviço, por exigência legal ou com o
            consentimento do usuário.
          </P>
          <P>
            <B>Como revogar.</B> A qualquer momento, em Configurações → Profissionais → (seu
            cadastro) → Agenda Google → <B>Desconectar</B>, o que apaga as credenciais guardadas. O
            acesso também pode ser revogado diretamente pelo Google, em{' '}
            <A href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</A>.
            Revogar interrompe a sincronização daí em diante; eventos já criados permanecem na
            agenda, sob controle do profissional.
          </P>
        </Section>

        <Section title="5. Compartilhamento">
          <P>Não vendemos dados pessoais. Compartilhamos apenas o necessário, e apenas com:</P>
          <Ul>
            <Li>
              <B>Fornecedores de infraestrutura e serviços</B> que operam sob contrato e nossas
              instruções — hospedagem e banco de dados, envio de e-mail e de mensagens, processamento
              de pagamentos e serviços de assinatura digital de documentos.
            </Li>
            <Li>
              <B>Autoridades públicas</B>, quando houver obrigação legal, ordem judicial ou
              requisição de autoridade competente.
            </Li>
          </Ul>
        </Section>

        <Section title="6. Transferência internacional">
          <P>
            Os dados do sistema são armazenados em servidores localizados no Brasil. Alguns
            fornecedores de apoio podem processar dados no exterior; nesses casos, a transferência
            observa o art. 33 da LGPD e é feita com cláusulas contratuais e garantias de proteção
            equivalentes às desta política.
          </P>
        </Section>

        <Section title="7. Segurança">
          <P>
            Cada clínica é isolada no banco de dados por políticas de acesso por linha, de modo que
            uma clínica não alcança os dados de outra. Dados pessoais sensíveis são cifrados em
            repouso, o tráfego é cifrado em trânsito, o acesso exige autenticação e é limitado por
            papel, e cada ação relevante fica registrada em trilha de auditoria imutável.
          </P>
          <P>
            Nenhuma medida elimina inteiramente o risco. Em caso de incidente com risco relevante,
            comunicaremos a ANPD e os titulares afetados, na forma do art. 48 da LGPD.
          </P>
        </Section>

        <Section title="8. Retenção">
          <P>
            Dados de pacientes são mantidos enquanto durar o contrato com a clínica e pelos prazos
            que a legislação impõe à guarda de prontuário. Encerrado o contrato, a clínica pode
            exportar sua base; depois disso os dados são eliminados ou anonimizados, salvo o que a
            lei obrigar a conservar. Dados de contato de quem pediu demonstração e não contratou são
            mantidos por até 24 meses.
          </P>
        </Section>

        <Section title="9. Seus direitos">
          <P>
            A LGPD garante a você, a qualquer momento e gratuitamente: confirmação da existência de
            tratamento; acesso aos dados; correção de dados incompletos, inexatos ou desatualizados;
            anonimização, bloqueio ou eliminação de dados desnecessários ou tratados em
            desconformidade; portabilidade; informação sobre com quem compartilhamos; revogação do
            consentimento; e oposição a tratamento feito com base em legítimo interesse.
          </P>
          <P>
            Para exercer, escreva para <A href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</A>.
            Respondemos em até 15 dias. Podemos pedir informações que confirmem a sua identidade —
            não para dificultar, mas para não entregar dados de uma pessoa a outra. Se o pedido for
            sobre dados registrados por uma clínica, encaminhamos a ela, que é a controladora.
          </P>
        </Section>

        <Section title="10. Cookies">
          <P>
            O sistema usa cookies necessários ao seu funcionamento e à manutenção da sessão de quem
            faz login. Não usamos cookies de publicidade nem de rastreamento entre sites. Você pode
            bloquear cookies no navegador, ciente de que isso pode impedir o login.
          </P>
        </Section>

        <Section title="11. Alterações">
          <P>
            Podemos atualizar esta política. Quando a mudança for relevante, avisaremos pelo sistema
            ou por e-mail antes de ela passar a valer. A data no topo indica a versão vigente.
          </P>
        </Section>

        <Section title="12. Contato">
          <P>
            Canal de atendimento ao titular, para qualquer assunto desta política — inclusive o
            exercício dos direitos da seção 9 e comunicação de incidentes:{' '}
            <A href={`mailto:${PRIVACY_EMAIL}`}>{PRIVACY_EMAIL}</A>.
          </P>
          <P>
            Você também pode peticionar diretamente à Autoridade Nacional de Proteção de Dados
            (ANPD).
          </P>
        </Section>
      </main>

      <footer className="border-t border-slate-200 py-8 text-center text-xs text-slate-500">
        © {new Date().getFullYear()} ClinniPro · clinnipro.com.br
      </footer>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-12">
      <h2 className="text-lg font-bold tracking-tight text-slate-900">{title}</h2>
      <div className="mt-3 space-y-3">{children}</div>
    </section>
  )
}

function P({ children }: { children: ReactNode }) {
  return <p className="text-[15px] leading-relaxed text-slate-700">{children}</p>
}

function Ul({ children }: { children: ReactNode }) {
  return <ul className="space-y-2 pl-5">{children}</ul>
}

function Li({ children }: { children: ReactNode }) {
  return (
    <li className="list-disc text-[15px] leading-relaxed text-slate-700 marker:text-slate-400">
      {children}
    </li>
  )
}

function B({ children }: { children: ReactNode }) {
  return <strong className="font-semibold text-slate-900">{children}</strong>
}

function C({ children }: { children: ReactNode }) {
  return <code className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[13px]">{children}</code>
}

function A({ href, children }: { href: string; children: ReactNode }) {
  const external = href.startsWith('http')
  return (
    <a
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      className="text-primary underline underline-offset-2"
    >
      {children}
    </a>
  )
}
