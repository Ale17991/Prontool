# Research — 057 Home do portal do paciente

Fase 0. Resolve as incógnitas técnicas que a sessão de clarificação de
2026-08-13 abriu. Nenhuma pergunta ficou sem resposta.

---

## D1 — Onde a renovação da sessão pode acontecer (FR-022)

**Decisão**: numa **rota em runtime Node** (`POST /api/paciente/sessao`),
acionada pelo layout do painel (`SessionKeepAlive`).

> **Esta decisão foi corrigida durante a implementação.** A primeira resposta
> foi "middleware", e ela está registrada aqui inteira porque o erro é
> convidativo: middleware é o único lugar do App Router que reescreve cookie em
> toda página, sem depender do cliente. Foi implementado assim — e **o build
> quebrou**.

**O que derrubou o middleware**: ele roda no **Edge Runtime**, e a sessão do
portal é assinada com `node:crypto` (`createHmac`, desde a 030). Importar
`session.ts` no middleware produz, no `next build`:

```
Module build failed: UnhandledSchemeError:
Reading from "node:crypto" is not handled by plugins (Unhandled scheme).
```

**Nem `tsc --noEmit` nem `next lint` pegam isso** — os dois passaram limpos com o
código quebrado. Só o build revela. Fica o registro: mudança que toca middleware
exige `next build`, não bastam typecheck e lint.

**Rationale da decisão final**: renovar é reescrever o cookie, e Server Component
não escreve cookie. Sobram Route Handler e Server Action — ambos em Node, ambos
precisando de um disparo do cliente. A rota reusa a MESMA função de assinatura
das páginas, o que era a propriedade importante: uma segunda implementação de
HMAC (em Web Crypto, para caber no Edge) poderia divergir da primeira, e o
sintoma de divergência é *todo paciente deslogado*.

O gatilho mora em `src/app/paciente/[slug]/painel/layout.tsx`, e não em cada
página: cobre as áreas que existem, as que ainda vão nascer, e fica de fora da
tela de login, onde não há sessão para renovar.

**Cuidados que a decisão carrega**:

- **Sem JavaScript, nada é renovado** e a sessão volta a durar 30 minutos fixos
  — o comportamento anterior à 057, que é seguro. Degradação aceitável; o
  contrário (sessão morrer no meio da navegação) é que seria regressão.
- **A rota não autentica ninguém**: estende o que já é válido.
  `renewPatientSessionCookie` devolve `null` para cookie ausente, adulterado,
  parado ou fora do teto, e a resposta é 401 genérico.
- **O teto absoluto de 12h (FR-023) vem do próprio payload**: `iatMs` já existe
  no cookie desde a 030. A renovação preserva `iatMs` e só empurra `expMs`; quem
  decide o teto é a verificação, comparando `now - iatMs`.
- **O logout deixou de precisar de exceção.** Era a armadilha da versão
  middleware (re-setar o cookie que o logout acabou de limpar); com o disparo
  vindo do layout do painel, quem fez logout não está mais numa página que
  dispara.

**Alternativas consideradas**:

- *Middleware* — quebra o build (acima).
- *Reimplementar a assinatura em Web Crypto para caber no Edge*: uma segunda
  verdade sobre o mesmo HMAC, sem suíte de teste rodando para provar que as duas
  concordam. Risco desproporcional ao ganho.
- *Cookie rolante sem reassinar* (payload com teto absoluto, e a inatividade
  imposta pelo `Max-Age` do cookie): elimina a criptografia do caminho, mas move
  a expiração por inatividade para o navegador — um cookie copiado valeria 12h
  em vez de 30 minutos. Enfraquece justamente o que o FR-023 quis proteger.
- *Sessão em banco com `last_seen_at`*: joga fora a propriedade que a 030 buscou
  (zero hit de banco por request) para resolver algo que o cookie já resolve.

---

## D2 — Como a tela inicial sabe do checklist antes de se desenhar (FR-017)

**Decisão**: a home chama **`getActiveChecklist(sb, tenantId, patientId)`**
(`src/lib/core/habits/store.ts`) no servidor para decidir a promoção. O
`HabitsCard` continua buscando a grade pelo cliente como hoje.

**Rationale**: a promoção precisa da resposta a uma pergunta barata — "existe
checklist ativo?" — e não da grade inteira. `getActiveChecklist` responde
exatamente isso com uma consulta, e já é usada pelo mesmo motor que alimenta o
card. `getGrid` devolveria período, marcações e estatísticas: caro para uma
decisão booleana, e obrigaria o dia civil da clínica no caminho.

Isso desfaz o impasse anotado no spec ("hoje o portal só descobre se existe
checklist depois da tela montada"): a informação sempre esteve disponível no
servidor, só não era consultada ali.

**Cuidado**: "sem hábitos" para efeito de promoção é **seção desligada OU sem
checklist ativo**. Seção ligada com checklist existente conta como hábitos
presentes mesmo que o paciente ainda não tenha marcado nada — a grade em branco
é conteúdo, é justamente o que se pede que ele preencha.

**Alternativas consideradas**:

- *Deixar o cliente decidir e promover depois da hidratação*: a tela saltaria na
  frente do paciente, e a promoção viraria mudança de layout pós-carga.
- *Chamar `getGrid` no servidor e passar pronto ao card*: mudaria o contrato do
  `HabitsCard` (hoje autônomo) e duplicaria a busca quando ele revalida após uma
  marcação. Fora de escopo.

---

## D3 — Onde mora o texto de boas-vindas (FR-018)

**Decisão**: coluna **`patient_portal_welcome_text TEXT NULL`** em
`tenant_clinic_profile`, na migration **0202**.

**Rationale**: é configuração de portal por clínica, exatamente como
`patient_portal_enabled` e `public_booking_slug`, que já moram nessa tabela e são
lidos pelo mesmo `getPatientPortalConfig`. Tabela nova para um campo de texto
opcional seria cerimônia sem ganho.

A edição entra no fluxo existente: `PatientPortalConfigUpdateSchema` ganha o
campo, `updatePatientPortalConfig` grava, e o formulário em
`/configuracoes/portal-paciente` ganha o campo de texto. O RBAC não muda —
`patient_portal.config` (admin) já protege a tela e a escrita.

**Limite de tamanho**: 1.000 caracteres. É recado de acolhimento numa tela que a
feature existe para manter curta; sem teto, vira mural e recria a rolagem que
estamos cortando.

**Alternativas consideradas**:

- *Reusar alguma coluna de texto existente do perfil da clínica*: nenhuma tem
  essa finalidade, e sobrecarregar campo alheio esconde a intenção.
- *Texto por seção ou por paciente*: ninguém pediu, e multiplicaria a superfície
  de conteúdo livre exibido a paciente.

---

## D4 — Como a trilha passa a registrar a área (FR-007)

**Decisão**: coluna **`section TEXT NULL`** em `patient_portal_access_log`, na
mesma migration 0202. O CHECK de `action` **não muda**.

**Rationale**: a alternativa seria criar valores novos de `action`
(`view_exames`, `view_dieta`…), o que obrigaria a mexer no CHECK a cada seção
nova e misturaria duas dimensões — o que a pessoa fez e onde. Coluna separada e
nulável mantém `action='view'` estável, preserva as linhas antigas exatamente
como estão (FR-007a) e faz `section IS NULL` significar, sem ambiguidade,
"acesso anterior a esta feature".

`section` recebe a chave da seção do catálogo (`metricas`, `atendimentos`,
`orientacoes`, `exames`, `treino`, `dieta`) ou `home` para a tela inicial. Sem
CHECK enumerando valores, pelo mesmo motivo que `automation_triggers.source` não
tem: seção nova não deve exigir migration.

**Alternativas consideradas**:

- *Novos valores de `action`*: acima.
- *Registrar só a home e deixar as seções sem trilha*: perderia justamente a
  informação que a Pergunta 4 decidiu capturar.

---

## D5 — Qual área é promovida (FR-017, FR-019)

**Decisão**: a **primeira, na ordem do catálogo `PORTAL_SECTIONS`, que esteja
habilitada E tenha conteúdo**. A ordem hoje resulta em: atendimentos → evolução
→ orientações → exames → treino → dieta.

**Rationale**: FR-003 já fixou o catálogo como a ordem de apresentação; usar
outra regra aqui (a "mais recente", a "mais cheia") criaria uma segunda ordem
para o paciente aprender e tornaria a home instável entre visitas.

"Ter conteúdo" é o mesmo predicado que decide card aceso ou apagado — o cálculo
já existe na home e é reaproveitado, não reimplementado.

**Cuidado (FR-019)**: a área promovida sai da grade de cards. A grade e a
promoção leem a MESMA lista, então a exclusão é feita num ponto só.

---

## D6 — Reaproveitamento do que já está no working tree

A branch já traz a estrutura de cards e as seis páginas de área, com
`openPortalPage` como porta única. O que a clarificação acrescentou e ainda NÃO
existe: linha da próxima consulta no cabeçalho (FR-014–016), texto de
boas-vindas e promoção (FR-017–021), renovação e teto de sessão (FR-022–024),
área na trilha (FR-007).

**Decisão**: manter o que existe e acrescentar. Nada do que foi escrito
contradiz as respostas da clarificação — a prévia "Próxima em 14/08" no card,
por exemplo, convive com a linha do cabeçalho, que é mais específica (traz a
hora).

---

## Sem incógnitas remanescentes

Nenhum item do Technical Context ficou marcado como NEEDS CLARIFICATION.
