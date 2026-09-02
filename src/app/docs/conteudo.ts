/**
 * Documentação pública da API de parceiros, servida em /docs.
 *
 * FONTE ÚNICA. O documento é uma string e não um componente porque a rota o
 * devolve como HTML cru: assim o `<head>` é nosso (fonte, charset, meta) e não
 * há conversão para JSX onde um `class` vira `className` esquecido.
 *
 * Ao mexer aqui, confira contra o código — cada afirmação desta página é um
 * contrato com o desenvolvedor do outro lado:
 *   - formas de resposta ....... src/lib/core/partners/{clinics,financeiro}.ts
 *   - parâmetros e limites ..... src/lib/core/partners/query.ts
 *   - erros .................... src/lib/core/partners/{guard,errors}.ts
 *   - escopos .................. src/lib/core/partners/api-keys.ts
 */

export const APP_URL = process.env.NEXT_PUBLIC_APP_URL || 'https://app.clinnipro.com.br'

/**
 * Contato de integração publicado no rodapé.
 *
 * PROVISÓRIO — endereço definitivo a definir. Fica como constante nomeada, e
 * não solto no meio do HTML, para a troca ser uma linha e não uma caçada no
 * meio de 900 linhas de marcação.
 */
const CONTATO_INTEGRACAO = 'clinnipro@gmail.com'

export function documentoHtml(baseUrl: string = APP_URL): string {
  const api = `${baseUrl.replace(/\/+$/, '')}/api/parceiros/v1`
  return `<!doctype html>
<html lang="pt-BR">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Clinni API de Parceiros</title>
<meta name="description" content="Referência de integração da API de parceiros do Clinni: autenticação por chave, escopos, endpoints financeiros e regras de privacidade.">
<meta name="robots" content="noindex">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Archivo:wght@500;600;700&amp;family=IBM+Plex+Mono:wght@400;500;600&amp;family=IBM+Plex+Sans:wght@400;500;600&amp;display=swap">
<style>
  :root {
    --paper:#F5F8FB; --surface:#FFFFFF; --surface-2:#EEF3F9;
    --ink:#101A2B; --muted:#5A657A; --faint:#8894A8;
    --line:#D9E1EC; --line-soft:#E8EEF5;
    --navy:#1D4E7E; --accent:#D25A11; --accent-ink:#FFFFFF;
    --code-bg:#0E1826; --code-ink:#DCE6F2; --code-line:#22304A;
    --ok:#1B6B45; --ok-bg:#E3F2EA;
    --warn:#8A5A05; --warn-bg:#FBF0DA;
    --bad:#A6212C; --bad-bg:#FBE6E7;
    --shadow:0 1px 2px rgba(16,26,43,.06), 0 8px 24px -16px rgba(16,26,43,.28);
  }
  @media (prefers-color-scheme: dark) {
    :root:not([data-theme="light"]) {
      --paper:#0B1220; --surface:#121C2C; --surface-2:#18243A;
      --ink:#E4EAF3; --muted:#9AA6B9; --faint:#74819A;
      --line:#23324C; --line-soft:#1B283E;
      --navy:#79ADE2; --accent:#F0813C; --accent-ink:#17110B;
      --code-bg:#080E18; --code-ink:#D3DFEE; --code-line:#1D2A42;
      --ok:#6ED3A2; --ok-bg:#102A20;
      --warn:#E9B65C; --warn-bg:#2C2210;
      --bad:#F0868F; --bad-bg:#2E1418;
      --shadow:0 1px 2px rgba(0,0,0,.4), 0 8px 24px -16px rgba(0,0,0,.8);
    }
  }
  :root[data-theme="dark"] {
    --paper:#0B1220; --surface:#121C2C; --surface-2:#18243A;
    --ink:#E4EAF3; --muted:#9AA6B9; --faint:#74819A;
    --line:#23324C; --line-soft:#1B283E;
    --navy:#79ADE2; --accent:#F0813C; --accent-ink:#17110B;
    --code-bg:#080E18; --code-ink:#D3DFEE; --code-line:#1D2A42;
    --ok:#6ED3A2; --ok-bg:#102A20;
    --warn:#E9B65C; --warn-bg:#2C2210;
    --bad:#F0868F; --bad-bg:#2E1418;
    --shadow:0 1px 2px rgba(0,0,0,.4), 0 8px 24px -16px rgba(0,0,0,.8);
  }

  * { box-sizing: border-box; }
  html { scroll-behavior: smooth; }
  body {
    margin:0; background:var(--paper); color:var(--ink);
    font-family:"IBM Plex Sans", ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    font-size:16px; line-height:1.65; -webkit-font-smoothing:antialiased;
  }
  h1,h2,h3 {
    font-family:Archivo,"IBM Plex Sans",ui-sans-serif,system-ui,sans-serif;
    text-wrap:balance; margin:0; line-height:1.2; letter-spacing:-.015em;
  }
  code, pre, .mono { font-family:"IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, monospace; }
  a { color:var(--accent); text-decoration-thickness:1px; text-underline-offset:2px; }
  a:focus-visible { outline:2px solid var(--accent); outline-offset:2px; border-radius:3px; }

  .shell {
    max-width:1180px; margin:0 auto; padding:0 24px;
    display:grid; grid-template-columns:232px minmax(0,1fr); gap:48px; align-items:start;
  }
  .masthead { border-bottom:1px solid var(--line); background:var(--surface); }
  .masthead .shell { display:block; padding-top:40px; padding-bottom:34px; }
  .eyebrow {
    font-family:"IBM Plex Mono",monospace; font-size:11px; font-weight:500;
    letter-spacing:.16em; text-transform:uppercase; color:var(--accent); margin:0 0 14px;
  }
  .masthead h1 { font-size:clamp(30px,4.4vw,44px); font-weight:700; }
  .masthead p.lede { max-width:62ch; margin:14px 0 0; color:var(--muted); font-size:17px; }
  .meta-row {
    display:flex; flex-wrap:wrap; gap:10px 28px; margin:26px 0 0;
    padding-top:20px; border-top:1px solid var(--line-soft);
  }
  .meta-row div { display:flex; flex-direction:column; gap:2px; }
  .meta-row dt {
    font-family:"IBM Plex Mono",monospace; font-size:10px; letter-spacing:.14em;
    text-transform:uppercase; color:var(--faint);
  }
  .meta-row dd { margin:0; font-size:14px; font-weight:500; }

  .rail { position:sticky; top:24px; padding:40px 0; font-size:14px; }
  .rail nav { display:flex; flex-direction:column; gap:4px; }
  .rail .group {
    font-family:"IBM Plex Mono",monospace; font-size:10px; letter-spacing:.14em;
    text-transform:uppercase; color:var(--faint); margin:22px 0 6px;
  }
  .rail .group:first-child { margin-top:0; }
  .rail a {
    color:var(--muted); text-decoration:none; padding:3px 0 3px 13px;
    border-left:2px solid var(--line); transition:color .12s, border-color .12s;
  }
  .rail a:hover { color:var(--ink); border-left-color:var(--accent); }

  main { padding:40px 0 96px; min-width:0; }
  section { scroll-margin-top:24px; }
  section + section { margin-top:56px; }
  main h2 { font-size:25px; font-weight:600; padding-bottom:10px; border-bottom:1px solid var(--line); }
  main h3 { font-size:17px; font-weight:600; margin-top:30px; }
  main p { max-width:68ch; color:var(--muted); }
  main p strong { color:var(--ink); font-weight:600; }
  ul.plain { max-width:68ch; padding-left:20px; color:var(--muted); }
  ul.plain li { margin:7px 0; }
  ul.plain li strong { color:var(--ink); font-weight:600; }

  .endpoint {
    background:var(--surface); border:1px solid var(--line); border-radius:4px;
    box-shadow:var(--shadow); overflow:hidden; margin-top:22px;
  }
  .endpoint > header {
    display:flex; flex-wrap:wrap; align-items:baseline; gap:8px 12px;
    padding:13px 18px; background:var(--surface-2); border-bottom:1px solid var(--line);
  }
  .verb {
    font-family:"IBM Plex Mono",monospace; font-size:11px; font-weight:600;
    letter-spacing:.08em; color:var(--faint);
  }
  .path {
    font-family:"IBM Plex Mono",monospace; font-size:14px; font-weight:500;
    color:var(--ink); word-break:break-all;
  }
  .path .var { color:var(--navy); }
  .scope-tag {
    margin-left:auto; font-family:"IBM Plex Mono",monospace; font-size:10.5px;
    font-weight:500; padding:3px 8px; border-radius:3px;
    background:var(--accent); color:var(--accent-ink); white-space:nowrap;
  }
  .endpoint .body { padding:18px; }
  .endpoint .body > p:first-child { margin-top:0; }

  .table-wrap { overflow-x:auto; margin:16px 0; }
  table { border-collapse:collapse; width:100%; font-size:14px; min-width:460px; }
  th, td { text-align:left; padding:9px 14px 9px 0; border-bottom:1px solid var(--line-soft); vertical-align:top; }
  th {
    font-family:"IBM Plex Mono",monospace; font-size:10px; letter-spacing:.13em;
    text-transform:uppercase; color:var(--faint); font-weight:500; border-bottom-color:var(--line);
  }
  td { color:var(--muted); }
  td:first-child { color:var(--ink); }
  td.num { font-variant-numeric:tabular-nums; }
  td code, th code, p code, li code {
    font-size:12.5px; background:var(--surface-2); padding:1px 5px;
    border-radius:3px; color:var(--ink); white-space:nowrap;
  }
  .req {
    font-family:"IBM Plex Mono",monospace; font-size:10px; letter-spacing:.06em;
    color:var(--accent); text-transform:uppercase;
  }

  pre {
    background:var(--code-bg); color:var(--code-ink); border:1px solid var(--code-line);
    border-radius:4px; padding:15px 17px; overflow-x:auto;
    font-size:12.8px; line-height:1.62; margin:14px 0; tab-size:2;
  }
  pre .k { color:#8FB8E8; }
  pre .s { color:#9CD3A8; }
  pre .n { color:#E8B87E; }
  pre .c { color:#6B7B94; font-style:italic; }
  .label {
    font-family:"IBM Plex Mono",monospace; font-size:10px; letter-spacing:.14em;
    text-transform:uppercase; color:var(--faint); margin:18px 0 -6px;
  }

  .pill {
    display:inline-block; font-family:"IBM Plex Mono",monospace; font-size:11px;
    font-weight:600; padding:2px 7px; border-radius:3px; font-variant-numeric:tabular-nums;
  }
  .pill.ok { background:var(--ok-bg); color:var(--ok); }
  .pill.warn { background:var(--warn-bg); color:var(--warn); }
  .pill.bad { background:var(--bad-bg); color:var(--bad); }

  .note {
    border-left:2px solid var(--navy); background:var(--surface); padding:14px 18px;
    margin:20px 0; border-radius:0 4px 4px 0; max-width:72ch;
  }
  .note p { margin:0; font-size:14.5px; }
  .note p + p { margin-top:9px; }
  .note .note-title {
    font-family:Archivo,sans-serif; font-weight:600; font-size:14px;
    color:var(--ink); margin-bottom:5px;
  }
  .note.strong { border-left-color:var(--accent); }

  footer {
    border-top:1px solid var(--line); margin-top:64px; padding-top:22px;
    font-size:13.5px; color:var(--faint); max-width:68ch;
  }

  @media (max-width:900px) {
    .shell { grid-template-columns:1fr; gap:0; }
    .rail { position:static; padding:24px 0 0; border-bottom:1px solid var(--line); }
    .rail nav { flex-direction:row; flex-wrap:wrap; gap:6px 14px; padding-bottom:20px; }
    .rail .group { display:none; }
    .rail a { border-left:none; padding:2px 0; }
    main { padding-top:28px; }
  }
  @media (prefers-reduced-motion: reduce) {
    html { scroll-behavior:auto; }
    * { transition:none !important; animation:none !important; }
  }
</style>
</head>
<body>

<header class="masthead">
  <div class="shell">
    <p class="eyebrow">Documenta&ccedil;&atilde;o de integra&ccedil;&atilde;o &middot; v1</p>
    <h1>Clinni API de Parceiros</h1>
    <p class="lede">
      Leitura do financeiro das cl&iacute;nicas que usam o seu servi&ccedil;o &mdash; atendimentos
      realizados, cobran&ccedil;as emitidas e o caixa que entrou e saiu &mdash; para que a nota
      fiscal seja emitida sem ningu&eacute;m redigitar nada.
    </p>
    <dl class="meta-row">
      <div><dt>URL base</dt><dd class="mono">${api}</dd></div>
      <div><dt>Autentica&ccedil;&atilde;o</dt><dd>Chave de parceiro (Bearer)</dd></div>
      <div><dt>Formato</dt><dd>JSON &middot; UTF-8</dd></div>
      <div><dt>Valores</dt><dd>Centavos, inteiros</dd></div>
    </dl>
  </div>
</header>

<div class="shell">
  <aside class="rail">
    <nav aria-label="&Iacute;ndice">
      <p class="group">Come&ccedil;ar</p>
      <a href="#autenticacao">Autentica&ccedil;&atilde;o</a>
      <a href="#escopos">Escopos</a>
      <a href="#convencoes">Conven&ccedil;&otilde;es</a>

      <p class="group">Cl&iacute;nicas</p>
      <a href="#listar-clinicas">Listar cl&iacute;nicas</a>
      <a href="#detalhe-clinica">Cadastro da cl&iacute;nica</a>

      <p class="group">Financeiro da cl&iacute;nica</p>
      <a href="#servicos">Servi&ccedil;os prestados</a>
      <a href="#cobrancas">Cobran&ccedil;as</a>
      <a href="#movimentacoes">Movimenta&ccedil;&otilde;es</a>

      <p class="group">Seu repasse</p>
      <a href="#faturamento">Faturamento do parceiro</a>

      <p class="group">Refer&ecirc;ncia</p>
      <a href="#paginacao">Pagina&ccedil;&atilde;o</a>
      <a href="#erros">Erros</a>
      <a href="#enums">Valores poss&iacute;veis</a>
      <a href="#privacidade">Privacidade</a>
    </nav>
  </aside>

  <main>
    <section id="autenticacao">
      <h2>Autentica&ccedil;&atilde;o</h2>
      <p>
        Toda requisi&ccedil;&atilde;o leva a sua chave de parceiro. Ela chega at&eacute;
        voc&ecirc; por um <strong>link de uso &uacute;nico</strong>: ao abri-lo e confirmar, a
        credencial aparece uma vez e o link deixa de funcionar. Guardamos apenas o hash &mdash;
        nem a equipe Clinni consegue reexibi-la. Perdeu, geramos outra e revogamos a anterior.
      </p>
      <p>
        O link expira em 48&nbsp;horas. Tenha onde guardar a credencial <em>antes</em> de
        clicar em revelar.
      </p>

      <p class="label">Requisi&ccedil;&atilde;o</p>
<pre><span class="c"># Authorization: Bearer &eacute; a forma preferida</span>
curl ${api}/clinicas \\
  -H <span class="s">"Authorization: Bearer clinni_a3f0c81b7d24e659_5f2b…"</span>

<span class="c"># X-Api-Key tamb&eacute;m &eacute; aceito, se o seu cliente HTTP facilitar</span>
curl ${api}/clinicas \\
  -H <span class="s">"X-Api-Key: clinni_a3f0c81b7d24e659_5f2b…"</span></pre>

      <h3>Formato da chave</h3>
      <p>
        <code>clinni_&lt;prefixo&gt;_&lt;segredo&gt;</code> &mdash; o prefixo tem 16 caracteres
        hexadecimais e &eacute; p&uacute;blico (&eacute; por ele que identificamos qual chave
        revogar); o segredo tem 64. O <code>clinni_</code> no come&ccedil;o existe para que uma
        chave vazada num log ou num reposit&oacute;rio seja reconhec&iacute;vel como nossa e
        possamos avisar voc&ecirc;.
      </p>

      <h3>Restri&ccedil;&otilde;es da chave</h3>
      <p>
        Duas prote&ccedil;&otilde;es opcionais podem estar ligadas na sua chave, combinadas na
        contrata&ccedil;&atilde;o:
      </p>
      <ul class="plain">
        <li>
          <strong>Faixa de IP.</strong> A chave s&oacute; funciona a partir dos endere&ccedil;os
          que voc&ecirc; informar (IP exato ou CIDR). Chamada de outra origem responde
          <code>INVALID_KEY</code> &mdash; o mesmo erro de chave inv&aacute;lida, de
          prop&oacute;sito.
        </li>
        <li>
          <strong>Validade.</strong> A chave pode ter prazo. Vencida, responde
          <code>INVALID_KEY</code>. Combine a renova&ccedil;&atilde;o antes da data.
        </li>
      </ul>
      <p>
        Recomendamos as duas. Chave vazada &eacute; o incidente mais prov&aacute;vel de uma
        integra&ccedil;&atilde;o, e a faixa de IP transforma "quem tiver a chave" em "quem tiver
        a chave e estiver na sua rede".
      </p>

      <h3>Limite de requisi&ccedil;&otilde;es</h3>
      <p>
        <strong>120 requisi&ccedil;&otilde;es por minuto por chave.</strong> Passando disso, a
        resposta &eacute; <span class="pill warn">429</span> <code>RATE_LIMITED</code> &mdash;
        espere e repita. O teto atende com folga o uso real (percorrer um m&ecirc;s de uma
        cl&iacute;nica grande s&atilde;o poucas dezenas de p&aacute;ginas) e existe para que uma
        chave vazada n&atilde;o varra a base antes de algu&eacute;m perceber.
      </p>

      <div class="note strong">
        <p class="note-title">Trate a chave como credencial de produ&ccedil;&atilde;o</p>
        <p>
          Ela d&aacute; acesso de leitura ao cadastro e ao financeiro de todas as cl&iacute;nicas
          ligadas a voc&ecirc;. Mantenha fora do controle de vers&atilde;o, fora do navegador e
          fora de logs. Toda leitura fica registrada do nosso lado com data, endpoint,
          cl&iacute;nica e volume de registros &mdash; se algo parecer errado, conseguimos
          reconstruir exatamente o que saiu.
        </p>
      </div>
    </section>

    <section id="escopos">
      <h2>Escopos</h2>
      <p>
        Cada chave carrega os escopos que lhe foram concedidos. Uma chave sem o escopo exigido
        pelo endpoint recebe <span class="pill bad">403</span> &mdash; nunca um resultado
        parcial. N&atilde;o existe escopo curinga.
      </p>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Escopo</th><th>Libera</th></tr></thead>
          <tbody>
            <tr><td><code>clinicas:read</code></td><td>Quais cl&iacute;nicas usam o seu servi&ccedil;o e o cadastro completo de cada uma.</td></tr>
            <tr><td><code>financeiro:read</code></td><td>Servi&ccedil;os prestados, cobran&ccedil;as e movimenta&ccedil;&otilde;es de caixa de cada cl&iacute;nica.</td></tr>
            <tr><td><code>faturamento:read</code></td><td>O seu repasse &mdash; quanto a Clinni dividiu com voc&ecirc; em cada cobran&ccedil;a.</td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section id="convencoes">
      <h2>Conven&ccedil;&otilde;es</h2>

      <h3>Dinheiro</h3>
      <p>
        Todo valor &eacute; <strong>inteiro, em centavos</strong>, e o nome do campo termina em
        <code>_centavos</code>. <code>14990</code> &eacute; R$&nbsp;149,90. N&atilde;o h&aacute;
        decimal em lugar nenhum da API &mdash; ponto flutuante em dinheiro &eacute; como se
        perde um centavo por linha e um real por fechamento.
      </p>

      <h3>Datas</h3>
      <p>
        Campos que representam um <strong>dia</strong> v&ecirc;m como <code>AAAA-MM-DD</code>
        (<code>vencimento</code>, <code>pago_em</code> em repasses, <code>data</code> em
        movimenta&ccedil;&otilde;es). Campos que representam um <strong>instante</strong>
        v&ecirc;m em ISO&nbsp;8601 com fuso (<code>criada_em</code>, <code>pago_em</code> em
        parcelas, <code>data</code> em servi&ccedil;os). Os dias j&aacute; v&ecirc;m convertidos
        para o fuso da cl&iacute;nica &mdash; um recebimento das 21h em S&atilde;o Paulo cai no
        dia certo, n&atilde;o no seguinte.
      </p>

      <h3>Servidor para servidor</h3>
      <p>
        A API n&atilde;o envia cabe&ccedil;alhos CORS e n&atilde;o deve ser chamada do
        navegador: a chave ficaria vis&iacute;vel para qualquer pessoa com o inspetor aberto.
        Chame do seu backend. As respostas v&ecirc;m com <code>Cache-Control: no-store</code>
        &mdash; elas carregam CPF e faturamento, e n&atilde;o s&atilde;o para ficar em cache
        intermedi&aacute;rio nem em disco.
      </p>

      <h3>Identificadores</h3>
      <p>
        Todos s&atilde;o UUID e est&aacute;veis. O <code>id</code> da cl&iacute;nica &eacute; a
        chave que amarra os endpoints financeiros; guarde-o em vez de casar por nome ou CNPJ,
        que mudam.
      </p>

      <h3>Aus&ecirc;ncia</h3>
      <p>
        Campo sem informa&ccedil;&atilde;o vem <code>null</code>, <strong>nunca</strong> como
        string vazia ou zero. Isso importa: <code>valor_pago_centavos: 0</code> significa "nada
        foi pago"; <code>pago_em: null</code> significa "ainda n&atilde;o foi pago". S&atilde;o
        coisas diferentes.
      </p>
    </section>

    <section id="listar-clinicas">
      <h2>Listar cl&iacute;nicas</h2>
      <p>
        As cl&iacute;nicas ligadas ao seu servi&ccedil;o. &Eacute; o ponto de partida da
        integra&ccedil;&atilde;o: nenhum outro endpoint aceita uma cl&iacute;nica que n&atilde;o
        esteja nesta lista.
      </p>

      <div class="endpoint">
        <header>
          <span class="verb">GET</span>
          <span class="path">/clinicas</span>
          <span class="scope-tag">clinicas:read</span>
        </header>
        <div class="body">
          <p>Sem par&acirc;metros. Devolve a lista completa, ordenada por nome.</p>

          <p class="label">Resposta <span class="pill ok">200</span></p>
<pre>{
  <span class="k">"total"</span>: <span class="n">2</span>,
  <span class="k">"clinicas"</span>: [
    {
      <span class="k">"id"</span>: <span class="s">"7c1e9a04-3b52-4d18-9f77-2a6ce0b4d115"</span>,
      <span class="k">"nome"</span>: <span class="s">"Cl&iacute;nica Davos"</span>,
      <span class="k">"slug"</span>: <span class="s">"clinica-davos"</span>,
      <span class="k">"situacao"</span>: <span class="s">"ativa"</span>,
      <span class="k">"plano"</span>: <span class="s">"pro"</span>,
      <span class="k">"situacao_assinatura"</span>: <span class="s">"active"</span>,
      <span class="k">"vinculada_em"</span>: <span class="s">"2026-08-14"</span>
    },
    {
      <span class="k">"id"</span>: <span class="s">"b83d5f21-6c40-4a99-8e13-5d7fa2c9e806"</span>,
      <span class="k">"nome"</span>: <span class="s">"Odonto Padilha"</span>,
      <span class="k">"slug"</span>: <span class="s">"odonto-padilha"</span>,
      <span class="k">"situacao"</span>: <span class="s">"ativa"</span>,
      <span class="k">"plano"</span>: <span class="s">"clinica"</span>,
      <span class="k">"situacao_assinatura"</span>: <span class="s">"past_due"</span>,
      <span class="k">"vinculada_em"</span>: <span class="s">"2026-05-02"</span>
    }
  ]
}</pre>

          <div class="table-wrap">
            <table>
              <thead><tr><th>Campo</th><th>Tipo</th><th>Observa&ccedil;&atilde;o</th></tr></thead>
              <tbody>
                <tr><td><code>situacao</code></td><td>enum</td><td><code>ativa</code> ou <code>suspensa</code> &mdash; a conta da cl&iacute;nica no Clinni.</td></tr>
                <tr><td><code>situacao_assinatura</code></td><td>enum</td><td>Se ela est&aacute; em dia conosco. <code>past_due</code> n&atilde;o bloqueia a leitura, mas costuma anteceder um cancelamento.</td></tr>
                <tr><td><code>vinculada_em</code></td><td>data</td><td>Desde quando a cl&iacute;nica est&aacute; ligada a voc&ecirc;.</td></tr>
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </section>

    <section id="detalhe-clinica">
      <h2>Cadastro da cl&iacute;nica</h2>
      <p>
        Tudo o que &eacute; preciso para abrir a conta da cl&iacute;nica do seu lado: dados
        fiscais, endere&ccedil;o, respons&aacute;vel t&eacute;cnico e uma pessoa de contato.
      </p>

      <div class="endpoint">
        <header>
          <span class="verb">GET</span>
          <span class="path">/clinicas/<span class="var">{id}</span></span>
          <span class="scope-tag">clinicas:read</span>
        </header>
        <div class="body">
          <p class="label">Resposta <span class="pill ok">200</span></p>
<pre>{
  <span class="k">"clinica"</span>: {
    <span class="k">"id"</span>: <span class="s">"7c1e9a04-3b52-4d18-9f77-2a6ce0b4d115"</span>,
    <span class="k">"nome"</span>: <span class="s">"Cl&iacute;nica Davos"</span>,
    <span class="k">"slug"</span>: <span class="s">"clinica-davos"</span>,
    <span class="k">"situacao"</span>: <span class="s">"ativa"</span>,
    <span class="k">"plano"</span>: <span class="s">"pro"</span>,
    <span class="k">"situacao_assinatura"</span>: <span class="s">"active"</span>,
    <span class="k">"vinculada_em"</span>: <span class="s">"2026-08-14"</span>,
    <span class="k">"razao_social"</span>: <span class="s">"Davos Servi&ccedil;os M&eacute;dicos Ltda"</span>,
    <span class="k">"cnpj"</span>: <span class="s">"19283746000155"</span>,
    <span class="k">"email"</span>: <span class="s">"contato@clinicadavos.com.br"</span>,
    <span class="k">"telefone"</span>: <span class="s">"5527992734155"</span>,
    <span class="k">"endereco"</span>: {
      <span class="k">"cep"</span>: <span class="s">"29050545"</span>,
      <span class="k">"logradouro"</span>: <span class="s">"Avenida Nossa Senhora dos Navegantes"</span>,
      <span class="k">"numero"</span>: <span class="s">"675"</span>,
      <span class="k">"complemento"</span>: <span class="s">"Sala 1204"</span>,
      <span class="k">"bairro"</span>: <span class="s">"Enseada do Su&aacute;"</span>,
      <span class="k">"cidade"</span>: <span class="s">"Vit&oacute;ria"</span>,
      <span class="k">"uf"</span>: <span class="s">"ES"</span>
    },
    <span class="k">"responsavel_tecnico"</span>: {
      <span class="k">"nome"</span>: <span class="s">"Marina Alves Rocha"</span>,
      <span class="k">"conselho"</span>: <span class="s">"CRM"</span>,
      <span class="k">"registro"</span>: <span class="s">"ES-31882"</span>
    },
    <span class="k">"contato"</span>: {
      <span class="k">"nome"</span>: <span class="s">"Marina Alves Rocha"</span>,
      <span class="k">"email"</span>: <span class="s">"marina@clinicadavos.com.br"</span>
    }
  }
}</pre>

          <div class="note">
            <p class="note-title">Campos podem vir nulos</p>
            <p>
              O CNPJ e o endere&ccedil;o s&atilde;o preenchidos pela cl&iacute;nica em
              Configura&ccedil;&otilde;es, e nem toda cl&iacute;nica completou o cadastro. Se
              voc&ecirc; precisa de um campo para emitir a nota e ele vier <code>null</code>, o
              caminho &eacute; pedir &agrave; cl&iacute;nica que complete &mdash; n&atilde;o
              h&aacute; outra fonte do nosso lado.
            </p>
          </div>

          <p>
            <code>contato</code> &eacute; o administrador da cl&iacute;nica: nome e e-mail, nada
            mais. &Eacute; o &uacute;nico dado de pessoa f&iacute;sica deste endpoint, e existe
            porque abrir conta em servi&ccedil;o de terceiro exige um titular.
          </p>

          <p class="label">Cl&iacute;nica que n&atilde;o &eacute; sua <span class="pill warn">404</span></p>
<pre>{ <span class="k">"error"</span>: { <span class="k">"code"</span>: <span class="s">"NOT_FOUND"</span>, <span class="k">"message"</span>: <span class="s">"Cl&iacute;nica n&atilde;o encontrada."</span> } }</pre>
          <p>
            Um id que existe mas pertence a outro parceiro devolve o mesmo 404 de um id que
            n&atilde;o existe. &Eacute; deliberado: um 403 confirmaria a exist&ecirc;ncia da
            cl&iacute;nica, e &eacute; assim que se levanta a carteira de clientes de um
            concorrente, um id por vez.
          </p>
        </div>
      </div>
    </section>

    <section id="servicos">
      <h2>Servi&ccedil;os prestados</h2>
      <p>
        Os atendimentos realizados pela cl&iacute;nica &mdash; &eacute; daqui que sai a
        <strong>descri&ccedil;&atilde;o do servi&ccedil;o</strong> da nota: procedimento com
        c&oacute;digo TUSS, valor, profissional executante e o tomador.
      </p>

      <div class="endpoint">
        <header>
          <span class="verb">GET</span>
          <span class="path">/clinicas/<span class="var">{id}</span>/servicos</span>
          <span class="scope-tag">financeiro:read</span>
        </header>
        <div class="body">
          <div class="table-wrap">
            <table>
              <thead><tr><th>Par&acirc;metro</th><th>Padr&atilde;o</th><th>Observa&ccedil;&atilde;o</th></tr></thead>
              <tbody>
                <tr><td><code>de</code></td><td class="num">&mdash;</td><td><code>AAAA-MM-DD</code>. Data do atendimento, inclusive.</td></tr>
                <tr><td><code>ate</code></td><td class="num">&mdash;</td><td><code>AAAA-MM-DD</code>, inclusive. Precisa ser &ge; <code>de</code>.</td></tr>
                <tr><td><code>pagina</code></td><td class="num">1</td><td>Come&ccedil;a em 1.</td></tr>
                <tr><td><code>por_pagina</code></td><td class="num">100</td><td>M&aacute;ximo 200.</td></tr>
              </tbody>
            </table>
          </div>

          <p class="label">Resposta <span class="pill ok">200</span></p>
<pre>{
  <span class="k">"servicos"</span>: [
    {
      <span class="k">"atendimento_id"</span>: <span class="s">"d41f0b72-8ac5-4e30-b6d9-1c8e5a72f403"</span>,
      <span class="k">"data"</span>: <span class="s">"2026-08-27T14:30:00.000Z"</span>,
      <span class="k">"tomador"</span>: {
        <span class="k">"id"</span>: <span class="s">"f9a2c4e1-70b8-4d55-9137-6ea0d3b8c294"</span>,
        <span class="k">"nome"</span>: <span class="s">"Helena Barreto Nunes"</span>,
        <span class="k">"cpf"</span>: <span class="s">"04871239066"</span>
      },
      <span class="k">"profissional"</span>: { <span class="k">"nome"</span>: <span class="s">"Marina Alves Rocha"</span>, <span class="k">"registro"</span>: <span class="s">"ES-31882"</span> },
      <span class="k">"convenio"</span>: <span class="s">"Particular"</span>,
      <span class="k">"procedimentos"</span>: [
        { <span class="k">"codigo_tuss"</span>: <span class="s">"10101012"</span>, <span class="k">"descricao"</span>: <span class="s">"Consulta em consult&oacute;rio"</span>, <span class="k">"valor_centavos"</span>: <span class="n">25000</span> },
        { <span class="k">"codigo_tuss"</span>: <span class="s">"20101406"</span>, <span class="k">"descricao"</span>: <span class="s">"Mapeamento de retina"</span>,   <span class="k">"valor_centavos"</span>: <span class="n">18000</span> }
      ],
      <span class="k">"valor_centavos"</span>: <span class="n">43000</span>,
      <span class="k">"situacao"</span>: <span class="s">"ativo"</span>
    }
  ],
  <span class="k">"paginacao"</span>: { <span class="k">"pagina"</span>: <span class="n">1</span>, <span class="k">"por_pagina"</span>: <span class="n">100</span>, <span class="k">"total"</span>: <span class="n">318</span>, <span class="k">"tem_proxima"</span>: <span class="k">true</span> }
}</pre>

          <div class="note strong">
            <p class="note-title">Atendimento estornado continua na lista</p>
            <p>
              Ele vem com <code>situacao: "estornado"</code> e o <code>valor_centavos</code>
              j&aacute; l&iacute;quido do estorno &mdash; zero, quando o estorno foi integral.
              Some a lista e voc&ecirc; tem o faturamento correto sem precisar conhecer a regra.
            </p>
            <p>
              Escond&ecirc;-lo seria pior: &eacute; exatamente o caso em que uma nota j&aacute;
              emitida precisa ser cancelada, e voc&ecirc; descobriria tarde.
            </p>
          </div>

          <p>
            <code>convenio</code> traz o nome do conv&ecirc;nio cadastrado na cl&iacute;nica
            (muitas cadastram "Particular" como um deles) ou <code>null</code> quando o
            atendimento n&atilde;o tem conv&ecirc;nio associado.
            <code>profissional.registro</code> &eacute; o n&uacute;mero no conselho, como
            cadastrado.
          </p>
          <p>
            Quando o atendimento n&atilde;o tem linhas de procedimento detalhadas, devolvemos
            uma linha &uacute;nica com o procedimento do cabe&ccedil;alho &mdash; uma nota sem
            descri&ccedil;&atilde;o de servi&ccedil;o n&atilde;o pode ser emitida, ent&atilde;o
            este array nunca vem vazio.
          </p>
        </div>
      </div>
    </section>

    <section id="cobrancas">
      <h2>Cobran&ccedil;as</h2>
      <p>
        O que foi <strong>combinado</strong> com o paciente: valor total, forma de pagamento e
        todas as parcelas com vencimento e baixa.
      </p>

      <div class="endpoint">
        <header>
          <span class="verb">GET</span>
          <span class="path">/clinicas/<span class="var">{id}</span>/cobrancas</span>
          <span class="scope-tag">financeiro:read</span>
        </header>
        <div class="body">
          <p>
            Mesmos par&acirc;metros de <a href="#servicos">servi&ccedil;os</a> &mdash;
            <code>de</code> e <code>ate</code> filtram pela <em>cria&ccedil;&atilde;o</em> da
            cobran&ccedil;a.
          </p>

          <p class="label">Resposta <span class="pill ok">200</span></p>
<pre>{
  <span class="k">"cobrancas"</span>: [
    {
      <span class="k">"cobranca_id"</span>: <span class="s">"5b90d7c3-1e46-4a82-b0f5-93c2e7d18a60"</span>,
      <span class="k">"criada_em"</span>: <span class="s">"2026-08-27T17:04:22.118Z"</span>,
      <span class="k">"tomador"</span>: { <span class="k">"id"</span>: <span class="s">"f9a2c4e1-…"</span>, <span class="k">"nome"</span>: <span class="s">"Helena Barreto Nunes"</span>, <span class="k">"cpf"</span>: <span class="s">"04871239066"</span> },
      <span class="k">"atendimento_id"</span>: <span class="s">"d41f0b72-8ac5-4e30-b6d9-1c8e5a72f403"</span>,
      <span class="k">"valor_total_centavos"</span>: <span class="n">43000</span>,
      <span class="k">"valor_pago_centavos"</span>: <span class="n">21500</span>,
      <span class="k">"forma_pagamento"</span>: <span class="s">"cartao_credito"</span>,
      <span class="k">"situacao"</span>: <span class="s">"parcial"</span>,
      <span class="k">"pago_em"</span>: <span class="k">null</span>,
      <span class="k">"parcelas"</span>: [
        {
          <span class="k">"numero"</span>: <span class="n">1</span>, <span class="k">"valor_centavos"</span>: <span class="n">21500</span>, <span class="k">"vencimento"</span>: <span class="s">"2026-08-27"</span>,
          <span class="k">"situacao"</span>: <span class="s">"pago"</span>, <span class="k">"pago_em"</span>: <span class="s">"2026-08-27T17:05:01.442Z"</span>,
          <span class="k">"valor_pago_centavos"</span>: <span class="n">21500</span>, <span class="k">"forma_pagamento"</span>: <span class="s">"cartao_credito"</span>
        },
        {
          <span class="k">"numero"</span>: <span class="n">2</span>, <span class="k">"valor_centavos"</span>: <span class="n">21500</span>, <span class="k">"vencimento"</span>: <span class="s">"2026-09-27"</span>,
          <span class="k">"situacao"</span>: <span class="s">"pendente"</span>, <span class="k">"pago_em"</span>: <span class="k">null</span>,
          <span class="k">"valor_pago_centavos"</span>: <span class="n">0</span>, <span class="k">"forma_pagamento"</span>: <span class="k">null</span>
        }
      ]
    }
  ],
  <span class="k">"paginacao"</span>: { <span class="k">"pagina"</span>: <span class="n">1</span>, <span class="k">"por_pagina"</span>: <span class="n">100</span>, <span class="k">"total"</span>: <span class="n">204</span>, <span class="k">"tem_proxima"</span>: <span class="k">true</span> }
}</pre>

          <div class="note">
            <p class="note-title">Cobran&ccedil;a e caixa n&atilde;o s&atilde;o a mesma lista</p>
            <p>
              Uma cobran&ccedil;a em 6&times; aparece <strong>uma vez</strong> aqui e
              <strong>seis vezes</strong> em <a href="#movimentacoes">movimenta&ccedil;&otilde;es</a>,
              em seis datas. Se voc&ecirc; emite por compet&ecirc;ncia, use esta; se emite por
              recebimento, use aquela. Emitir pela data da cobran&ccedil;a poria seis meses de
              receita na compet&ecirc;ncia do primeiro m&ecirc;s.
            </p>
          </div>

          <p>
            <code>atendimento_id</code> pode vir <code>null</code>: existe cobran&ccedil;a sem
            atendimento (pacote, plano de tratamento) e atendimento sem cobran&ccedil;a
            (cortesia, conv&ecirc;nio faturado &agrave; operadora). N&atilde;o conte com a
            correspond&ecirc;ncia de um para um.
          </p>
        </div>
      </div>
    </section>

    <section id="movimentacoes">
      <h2>Movimenta&ccedil;&otilde;es</h2>
      <p>
        O caixa: entradas e sa&iacute;das numa lista s&oacute;, ordenada por data.
        <strong>Entrada &eacute; a parcela paga</strong>, n&atilde;o a cobran&ccedil;a &mdash;
        &eacute; o pagamento que move o caixa.
      </p>

      <div class="endpoint">
        <header>
          <span class="verb">GET</span>
          <span class="path">/clinicas/<span class="var">{id}</span>/movimentacoes</span>
          <span class="scope-tag">financeiro:read</span>
        </header>
        <div class="body">
          <div class="table-wrap">
            <table>
              <thead><tr><th>Par&acirc;metro</th><th>Padr&atilde;o</th><th>Observa&ccedil;&atilde;o</th></tr></thead>
              <tbody>
                <tr><td><code>de</code> / <code>ate</code></td><td class="num">&mdash;</td><td><code>AAAA-MM-DD</code>, inclusive.</td></tr>
                <tr><td><code>tipo</code></td><td class="num">ambos</td><td><code>entrada</code> ou <code>saida</code>.</td></tr>
                <tr><td><code>pagina</code></td><td class="num">1</td><td></td></tr>
                <tr><td><code>por_pagina</code></td><td class="num">100</td><td>M&aacute;ximo 200.</td></tr>
              </tbody>
            </table>
          </div>

          <p class="label">Resposta <span class="pill ok">200</span></p>
<pre>{
  <span class="k">"movimentacoes"</span>: [
    {
      <span class="k">"tipo"</span>: <span class="s">"entrada"</span>,
      <span class="k">"data"</span>: <span class="s">"2026-08-27"</span>,
      <span class="k">"valor_centavos"</span>: <span class="n">21500</span>,
      <span class="k">"descricao"</span>: <span class="s">"Recebimento — parcela 1"</span>,
      <span class="k">"categoria"</span>: <span class="s">"recebimento"</span>,
      <span class="k">"forma_pagamento"</span>: <span class="s">"cartao_credito"</span>,
      <span class="k">"origem"</span>: <span class="s">"parcela"</span>,
      <span class="k">"origem_id"</span>: <span class="s">"2f8b16d4-9c07-4e51-a3b8-70de5f9c1a22"</span>,
      <span class="k">"tomador"</span>: { <span class="k">"id"</span>: <span class="s">"f9a2c4e1-…"</span>, <span class="k">"nome"</span>: <span class="s">"Helena Barreto Nunes"</span>, <span class="k">"cpf"</span>: <span class="s">"04871239066"</span> }
    },
    {
      <span class="k">"tipo"</span>: <span class="s">"saida"</span>,
      <span class="k">"data"</span>: <span class="s">"2026-08-26"</span>,
      <span class="k">"valor_centavos"</span>: <span class="n">380000</span>,
      <span class="k">"descricao"</span>: <span class="s">"Aluguel da sala — Navegantes Empreendimentos"</span>,
      <span class="k">"categoria"</span>: <span class="s">"aluguel"</span>,
      <span class="k">"forma_pagamento"</span>: <span class="k">null</span>,
      <span class="k">"origem"</span>: <span class="s">"despesa"</span>,
      <span class="k">"origem_id"</span>: <span class="s">"a70c4e83-2d95-41f7-8b06-c1e93a5d7f48"</span>,
      <span class="k">"tomador"</span>: <span class="k">null</span>
    }
  ],
  <span class="k">"paginacao"</span>: { <span class="k">"pagina"</span>: <span class="n">1</span>, <span class="k">"por_pagina"</span>: <span class="n">100</span>, <span class="k">"total"</span>: <span class="n">142</span>, <span class="k">"tem_proxima"</span>: <span class="k">true</span> },
  <span class="k">"total_entradas_centavos"</span>: <span class="n">1847500</span>,
  <span class="k">"total_saidas_centavos"</span>: <span class="n">926300</span>
}</pre>

          <p>
            <code>origem_id</code> aponta para a parcela (dentro de uma cobran&ccedil;a) ou para
            a despesa, e &eacute; o que permite cruzar esta lista com
            <a href="#cobrancas">cobran&ccedil;as</a> sem adivinhar por valor e data.
          </p>
          <p>
            Os dois totais somam o <strong>per&iacute;odo inteiro</strong> consultado, n&atilde;o
            a p&aacute;gina &mdash; paginar n&atilde;o muda o fechamento.
          </p>

          <div class="note strong">
            <p class="note-title">Per&iacute;odo com mais de 20.000 movimenta&ccedil;&otilde;es &eacute; recusado</p>
            <p>
              Este endpoint funde duas origens com colunas de data diferentes, ent&atilde;o a
              ordem e os totais s&oacute; existem depois de ler as duas por inteiro. Passando de
              20.000, respondemos <span class="pill warn">400</span>
              <code>PERIODO_MUITO_LONGO</code> e voc&ecirc; consulta m&ecirc;s a m&ecirc;s.
            </p>
            <p>
              Preferimos recusar a devolver os primeiros 20.000 em sil&ecirc;ncio: quem soma a
              resposta acredita que somou o per&iacute;odo, e um fechamento a menos n&atilde;o
              vem com mensagem de erro.
            </p>
          </div>
        </div>
      </div>
    </section>

    <section id="faturamento">
      <h2>Faturamento do parceiro</h2>
      <p>
        Quanto a Clinni repassou a voc&ecirc;. &Eacute; outra conta, e n&atilde;o se confunde
        com o financeiro da cl&iacute;nica: aqui o dinheiro &eacute; o da assinatura que a
        cl&iacute;nica paga &agrave; Clinni, com a sua parte dividida na origem.
      </p>

      <div class="endpoint">
        <header>
          <span class="verb">GET</span>
          <span class="path">/faturamento</span>
          <span class="scope-tag">faturamento:read</span>
        </header>
        <div class="body">
          <div class="table-wrap">
            <table>
              <thead><tr><th>Par&acirc;metro</th><th>Padr&atilde;o</th><th>Observa&ccedil;&atilde;o</th></tr></thead>
              <tbody>
                <tr><td><code>de</code></td><td class="num">&minus;90 dias</td><td>Filtra pelo vencimento da cobran&ccedil;a.</td></tr>
                <tr><td><code>ate</code></td><td class="num">&mdash;</td><td><code>AAAA-MM-DD</code>, inclusive.</td></tr>
                <tr><td><code>pendentes</code></td><td class="num">0</td><td><code>1</code> inclui cobran&ccedil;as ainda n&atilde;o pagas.</td></tr>
                <tr><td><code>pagina</code></td><td class="num">1</td><td></td></tr>
                <tr><td><code>por_pagina</code></td><td class="num">100</td><td>M&aacute;ximo 200.</td></tr>
              </tbody>
            </table>
          </div>

          <p class="label">Resposta <span class="pill ok">200</span></p>
<pre>{
  <span class="k">"periodo"</span>: { <span class="k">"de"</span>: <span class="s">"2026-08-01"</span>, <span class="k">"ate"</span>: <span class="s">"2026-08-31"</span> },
  <span class="k">"paginacao"</span>: { <span class="k">"pagina"</span>: <span class="n">1</span>, <span class="k">"por_pagina"</span>: <span class="n">100</span>, <span class="k">"total"</span>: <span class="n">1</span>, <span class="k">"tem_proxima"</span>: <span class="k">false</span> },
  <span class="k">"repasse_da_pagina_centavos"</span>: <span class="n">3747</span>,
  <span class="k">"registros"</span>: [
    {
      <span class="k">"cobranca_id"</span>: <span class="s">"c05a9e71-4d38-4f62-9a10-e78b2d5c3406"</span>,
      <span class="k">"clinica"</span>: {
        <span class="k">"id"</span>: <span class="s">"7c1e9a04-…"</span>,
        <span class="k">"nome"</span>: <span class="s">"Cl&iacute;nica Davos"</span>,
        <span class="k">"razao_social"</span>: <span class="s">"Davos Servi&ccedil;os M&eacute;dicos Ltda"</span>,
        <span class="k">"cnpj"</span>: <span class="s">"19283746000155"</span>,
        <span class="k">"email"</span>: <span class="s">"contato@clinicadavos.com.br"</span>,
        <span class="k">"endereco"</span>: { <span class="c">/* mesmo formato do cadastro */</span> }
      },
      <span class="k">"valor_total_centavos"</span>: <span class="n">14990</span>,
      <span class="k">"valor_repasse_centavos"</span>: <span class="n">3747</span>,
      <span class="k">"vencimento"</span>: <span class="s">"2026-08-10"</span>,
      <span class="k">"pago_em"</span>: <span class="s">"2026-08-09"</span>,
      <span class="k">"situacao"</span>: <span class="s">"recebido"</span>
    }
  ]
}</pre>

          <div class="note">
            <p class="note-title">Por padr&atilde;o, s&oacute; o que foi pago</p>
            <p>
              Nota fiscal de dinheiro que n&atilde;o entrou custa retifica&ccedil;&atilde;o. A
              fila em aberto &eacute; outra pergunta e tem outra chamada:
              <code>?pendentes=1</code>, que traz a <code>situacao</code> de cada uma para
              voc&ecirc; decidir.
            </p>
          </div>

          <p>
            <code>repasse_da_pagina_centavos</code> soma <strong>a p&aacute;gina</strong>, e o
            nome diz isso. Para o total do per&iacute;odo, some as p&aacute;ginas &mdash; um
            campo chamado "total" que muda conforme a p&aacute;gina seria pior que um campo
            honesto sobre o seu recorte.
          </p>
          <p>
            <code>valor_repasse_centavos</code> &eacute; o valor <strong>efetivamente enviado ao
            processador na emiss&atilde;o</strong>, n&atilde;o um c&aacute;lculo feito na hora
            da consulta. Se a regra do seu contrato mudar, as cobran&ccedil;as antigas
            continuam mostrando o que foi de fato dividido.
          </p>
        </div>
      </div>
    </section>

    <section id="paginacao">
      <h2>Pagina&ccedil;&atilde;o</h2>
      <p>
        Os endpoints de lista paginam. O bloco <code>paginacao</code> vem em toda resposta e
        <code>tem_proxima</code> responde a pergunta direto &mdash; n&atilde;o &eacute; preciso
        comparar <code>pagina &times; por_pagina</code> com <code>total</code> nem pedir uma
        p&aacute;gina vazia para descobrir que acabou.
      </p>

      <p class="label">Percorrer tudo</p>
<pre><span class="k">const</span> BASE = <span class="s">'${api}'</span>
<span class="k">const</span> headers = { Authorization: <span class="s">'Bearer '</span> + process.env.CLINNI_API_KEY }

<span class="k">async function</span> movimentacoesDoMes(clinicaId, de, ate) {
  <span class="k">const</span> tudo = []
  <span class="k">let</span> pagina = <span class="n">1</span>

  <span class="k">while</span> (<span class="k">true</span>) {
    <span class="k">const</span> url = BASE + <span class="s">'/clinicas/'</span> + clinicaId + <span class="s">'/movimentacoes'</span>
      + <span class="s">'?de='</span> + de + <span class="s">'&amp;ate='</span> + ate
      + <span class="s">'&amp;pagina='</span> + pagina + <span class="s">'&amp;por_pagina=200'</span>

    <span class="k">const</span> r = <span class="k">await</span> fetch(url, { headers })
    <span class="k">if</span> (!r.ok) {
      <span class="k">const</span> corpo = <span class="k">await</span> r.json()
      <span class="k">throw new</span> Error(<span class="s">'Clinni '</span> + r.status + <span class="s">': '</span> + corpo.error.code)
    }

    <span class="k">const</span> resposta = <span class="k">await</span> r.json()
    tudo.push(...resposta.movimentacoes)

    <span class="k">if</span> (!resposta.paginacao.tem_proxima) <span class="k">break</span>
    pagina++
  }
  <span class="k">return</span> tudo
}</pre>

      <p>
        <code>por_pagina</code> vai at&eacute; <strong>200</strong>. Pedir mais devolve
        <span class="pill warn">400</span>, e n&atilde;o uma p&aacute;gina silenciosamente
        truncada &mdash; voc&ecirc; nunca vai achar que leu tudo quando n&atilde;o leu.
      </p>
    </section>

    <section id="erros">
      <h2>Erros</h2>
      <p>
        Todo erro tem o mesmo corpo, com um <code>code</code> est&aacute;vel para voc&ecirc;
        tratar em c&oacute;digo e uma <code>message</code> em portugu&ecirc;s para aparecer no
        seu log.
      </p>
<pre>{ <span class="k">"error"</span>: { <span class="k">"code"</span>: <span class="s">"MISSING_SCOPE"</span>, <span class="k">"message"</span>: <span class="s">"Esta chave n&atilde;o tem o escopo 'financeiro:read'."</span> } }</pre>

      <div class="table-wrap">
        <table>
          <thead><tr><th>HTTP</th><th>C&oacute;digo</th><th>O que fazer</th></tr></thead>
          <tbody>
            <tr><td><span class="pill bad">401</span></td><td><code>MISSING_KEY</code></td><td>Nenhum header de autentica&ccedil;&atilde;o foi enviado.</td></tr>
            <tr><td><span class="pill bad">401</span></td><td><code>INVALID_KEY</code></td><td>Chave malformada, desconhecida ou revogada &mdash; n&atilde;o distinguimos os tr&ecirc;s. Confira o valor; se estiver certo, fale conosco.</td></tr>
            <tr><td><span class="pill bad">403</span></td><td><code>MISSING_SCOPE</code></td><td>A chave &eacute; v&aacute;lida mas n&atilde;o tem o escopo do endpoint. Pe&ccedil;a uma nova chave com o escopo certo.</td></tr>
            <tr><td><span class="pill bad">403</span></td><td><code>PARTNER_INACTIVE</code></td><td>A parceria est&aacute; inativa do nosso lado. &Eacute; conversa comercial, n&atilde;o t&eacute;cnica.</td></tr>
            <tr><td><span class="pill warn">404</span></td><td><code>NOT_FOUND</code></td><td>A cl&iacute;nica n&atilde;o existe ou n&atilde;o est&aacute; ligada a voc&ecirc;. Reveja <code>GET /clinicas</code>.</td></tr>
            <tr><td><span class="pill warn">400</span></td><td><code>INVALID_QUERY</code></td><td>Data fora de <code>AAAA-MM-DD</code>, <code>de</code> maior que <code>ate</code>, <code>por_pagina</code> acima de 200 ou <code>tipo</code> inv&aacute;lido. A mensagem diz qual.</td></tr>
            <tr><td><span class="pill warn">400</span></td><td><code>PERIODO_MUITO_LONGO</code></td><td>Mais de 20.000 movimenta&ccedil;&otilde;es no per&iacute;odo. Consulte por intervalos menores.</td></tr>
            <tr><td><span class="pill warn">429</span></td><td><code>RATE_LIMITED</code></td><td>Mais de 120 requisi&ccedil;&otilde;es num minuto com a mesma chave. Espere o minuto virar e repita.</td></tr>
            <tr><td><span class="pill bad">500</span></td><td><code>INTERNAL</code></td><td>Falha nossa. Pode repetir com espera exponencial; se persistir por alguns minutos, nos avise.</td></tr>
          </tbody>
        </table>
      </div>

      <p>
        Erros nunca ecoam detalhe interno. Se voc&ecirc; precisa investigar uma resposta
        espec&iacute;fica, nos mande data, endpoint e o prefixo da chave &mdash; conseguimos
        localizar a requisi&ccedil;&atilde;o no registro de acesso.
      </p>
    </section>

    <section id="enums">
      <h2>Valores poss&iacute;veis</h2>
      <p>
        Trate qualquer campo <code>enum</code> como aberto: novos valores podem surgir, e o
        cliente n&atilde;o deve quebrar por n&atilde;o conhecer um deles.
      </p>

      <div class="table-wrap">
        <table>
          <thead><tr><th>Campo</th><th>Valores</th></tr></thead>
          <tbody>
            <tr><td><code>situacao</code> <span class="req">cl&iacute;nica</span></td><td><code>ativa</code> &middot; <code>suspensa</code></td></tr>
            <tr><td><code>situacao_assinatura</code></td><td><code>trial</code> &middot; <code>active</code> &middot; <code>past_due</code> &middot; <code>canceled</code></td></tr>
            <tr><td><code>plano</code></td><td><code>essencial</code> &middot; <code>pro</code> &middot; <code>clinica</code> &middot; <code>legacy</code></td></tr>
            <tr><td><code>situacao</code> <span class="req">servi&ccedil;o</span></td><td><code>ativo</code> &middot; <code>estornado</code></td></tr>
            <tr><td><code>situacao</code> <span class="req">cobran&ccedil;a</span></td><td><code>pendente</code> &middot; <code>parcial</code> &middot; <code>pago</code> &middot; <code>cancelado</code></td></tr>
            <tr><td><code>situacao</code> <span class="req">parcela</span></td><td><code>pendente</code> &middot; <code>pago</code> &middot; <code>atrasado</code> &middot; <code>cancelado</code></td></tr>
            <tr><td><code>forma_pagamento</code></td><td><code>dinheiro</code> &middot; <code>pix</code> &middot; <code>cartao_credito</code> &middot; <code>cartao_debito</code> &middot; <code>boleto</code> &middot; <code>convenio</code> &middot; <code>outro</code></td></tr>
            <tr><td><code>tipo</code> <span class="req">movimenta&ccedil;&atilde;o</span></td><td><code>entrada</code> &middot; <code>saida</code></td></tr>
            <tr><td><code>origem</code></td><td><code>parcela</code> &middot; <code>despesa</code></td></tr>
            <tr><td><code>categoria</code> <span class="req">sa&iacute;da</span></td><td><code>aluguel</code> &middot; <code>equipamentos</code> &middot; <code>materiais</code> &middot; <code>pessoal</code> &middot; <code>servicos</code> &middot; <code>outros</code></td></tr>
            <tr><td><code>situacao</code> <span class="req">repasse</span></td><td><code>pendente</code> &middot; <code>confirmado</code> &middot; <code>recebido</code> &middot; <code>vencido</code> &middot; <code>estornado</code> &middot; <code>cancelado</code> &middot; <code>falhou</code></td></tr>
          </tbody>
        </table>
      </div>
    </section>

    <section id="privacidade">
      <h2>Privacidade</h2>
      <p>
        Esta API entrega dado de sa&uacute;de por tabela &mdash; &eacute; preciso ser exato
        sobre o que atravessa e o que n&atilde;o atravessa.
      </p>

      <h3>O que voc&ecirc; recebe do paciente</h3>
      <p>
        <strong>Nome e CPF, e nada mais.</strong> Eles existem porque a nota fiscal precisa de
        um tomador. N&atilde;o h&aacute; endere&ccedil;o, telefone, e-mail, data de nascimento
        nem qualquer outro dado cadastral do paciente em nenhum endpoint.
      </p>

      <h3>O que nunca sai</h3>
      <ul class="plain">
        <li>Diagn&oacute;stico, CID, anamnese, evolu&ccedil;&atilde;o, prontu&aacute;rio.</li>
        <li>Exames, medi&ccedil;&otilde;es, fotos, documentos anexados.</li>
        <li>Prescri&ccedil;&otilde;es e planos de tratamento.</li>
      </ul>
      <p>
        Do atendimento sai o <strong>procedimento</strong> &mdash; que &eacute; a
        descri&ccedil;&atilde;o do servi&ccedil;o, obrigat&oacute;ria na nota &mdash; e o valor.
        Nenhum endpoint tem por onde alcan&ccedil;ar conte&uacute;do cl&iacute;nico.
      </p>

      <h3>Paciente anonimizado</h3>
      <p>
        Quando um paciente exerce o direito ao esquecimento, o <code>tomador</code> passa a vir
        com <code>nome</code> e <code>cpf</code> nulos. <strong>A linha financeira
        permanece</strong>: o dinheiro entrou, e a contabilidade n&atilde;o pode perder o
        registro porque a pessoa pediu para sumir. O que se apaga &eacute; quem, n&atilde;o
        quanto.
      </p>

      <h3>Registro de acesso</h3>
      <p>
        Toda chamada &eacute; registrada com data, chave, endpoint, cl&iacute;nica e quantidade
        de registros devolvidos. Isso permite responder &agrave; cl&iacute;nica, a qualquer
        momento, o que exatamente foi compartilhado com voc&ecirc; &mdash; &eacute; o que
        sustenta a base legal do compartilhamento.
      </p>

      <div class="note strong">
        <p class="note-title">S&oacute; cl&iacute;nicas ligadas a voc&ecirc;</p>
        <p>
          O recorte sai da pr&oacute;pria chave, nunca de um par&acirc;metro da
          requisi&ccedil;&atilde;o. N&atilde;o existe chamada que devolva cl&iacute;nica de
          outro parceiro, e n&atilde;o h&aacute; como pedir uma.
        </p>
      </div>
    </section>

    <footer>
      <p>
        D&uacute;vidas de integra&ccedil;&atilde;o, emiss&atilde;o e revoga&ccedil;&atilde;o de
        chave: <a href="mailto:${CONTATO_INTEGRACAO}">${CONTATO_INTEGRACAO}</a>.
        Mudan&ccedil;as que quebrem contrato entram numa vers&atilde;o nova do caminho &mdash; a
        <code>v1</code> n&atilde;o muda de forma debaixo de voc&ecirc;.
      </p>
    </footer>
  </main>
</div>
</body>
</html>`
}
