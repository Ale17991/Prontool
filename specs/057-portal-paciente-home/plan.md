# Implementation Plan: Home do portal do paciente + áreas em páginas próprias

**Branch**: `057-portal-paciente-home` | **Date**: 2026-08-13 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/057-portal-paciente-home/spec.md`

## Summary

O portal do paciente deixa de ser uma tela única e rolante. A tela inicial passa
a mostrar **apenas metas e checklist de hábitos** — o que o paciente acompanha e
faz todo dia —, e as outras seis áreas viram **cards que levam a páginas
próprias**. O cabeçalho ganha uma linha com a próxima consulta; quando metas e
checklist não se aplicam, a tela inicial se preenche com o texto de boas-vindas
da clínica e a primeira área com conteúdo, aberta.

Tecnicamente: uma porta única (`openPortalPage`) concentra sessão, gate de seção
e trilha; a renovação de sessão por inatividade vive numa **rota Node** acionada pelo
layout do painel; e uma migration
(**0202**) acrescenta o texto de boas-vindas e a área na trilha de acesso.

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel)
**Primary Dependencies**: Next.js 14.2 (App Router, RSC, Server Actions, Route Handlers), `@supabase/ssr` 0.5 / `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind 3.4, shadcn/ui (Radix), `lucide-react`. **Sem novas dependências** — a navegação é roteamento do próprio Next, e a renovação de sessão usa `node:crypto`, já em uso pela 030.
**Storage**: PostgreSQL via Supabase (local: `supabase start` :54321), RLS por `tenant_id`. **Migration nova**: `0202_portal_home.sql`. Produção foi sondada em 2026-08-13 e está **em dia até a 0201** — a 0202 é a única pendente.
**Testing**: Vitest (`tests/unit`, `tests/integration`, `tests/contract`). O stack local está de pé, mas o setup chama `resetDatabase()` e **apaga a base local** — rodar a suíte exige aceitar isso e re-semear com `pnpm seed:demo`. Validação usada aqui: `npx tsc --noEmit`, `npx next lint`, `node scripts/check-require-role.mjs` e, obrigatoriamente para mudanças que tocam middleware, `npx next build`.
**Target Platform**: Web, **mobile-first** — o paciente abre o portal no celular.
**Project Type**: Aplicação web única (Next.js App Router), portal fora do route group `(dashboard)`.
**Performance Goals**: abertura de área percebida como imediata; a tela inicial monta o bundle completo uma vez (ela alimenta a prévia de todos os cards), as páginas de área buscam só a sua fatia.
**Constraints**: portal somente-leitura, exceto a marcação do checklist; autenticação fraca por decisão de produto (CPF + nascimento) ⇒ sessão com janela de inatividade **e** teto absoluto; nenhum dado novo pode passar a ser exibido (FR-011).
**Scale/Scope**: 8 páginas de portal, 6 áreas, 1 migration, ~10 arquivos tocados. Tráfego por clínica é baixo (dezenas de acessos/dia).

## Constitution Check

_GATE: avaliado antes da Fase 0 e reavaliado após a Fase 1. Resultado: **PASS** nas duas passagens._

| Princípio                              | Aplicabilidade         | Como esta feature se comporta                                                                                                                                                                                                                                                                                                                                                                  |
| -------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I. Integridade Financeira Imutável** | Não aplicável          | O portal não exibe nem grava valor financeiro. FR-011 mantém a proibição explícita. Nada é reescrito.                                                                                                                                                                                                                                                                                          |
| **II. Auditabilidade Total**           | Aplicável por analogia | A trilha de acesso do paciente (LGPD) segue append-only: a coluna `section` nasce nula e **as linhas antigas não são retroalimentadas** (FR-007a). A feature aumenta a informação da trilha (passa a dizer qual área), nunca a reduz.                                                                                                                                                          |
| **III. Isolamento Multi-Tenant**       | **Aplicável — núcleo** | `tenantId`/`patientId` saem exclusivamente do cookie HMAC verificado; o `slug` da URL identifica a clínica e é conferido contra o tenant da sessão. Toda consulta filtra por ambos. Cookie da clínica A não abre o portal da clínica B (contrato de rotas, invariante 4).                                                                                                                      |
| **IV. Conformidade TUSS/ANS**          | Não aplicável          | Nenhum código de procedimento é lido ou exibido.                                                                                                                                                                                                                                                                                                                                               |
| **V. RBAC**                            | Aplicável              | O portal tem sessão própria de paciente, não papéis de staff. O gate de seção é **server-side** (FR-006): o card escondido na home não é o controle — o controle é o redirecionamento em `openPortalPage`, exatamente o que o princípio exige ao rejeitar "ocultar botão" como mecanismo. A edição do texto de boas-vindas continua sob `patient_portal.config` (admin), avaliada no servidor. |

**Restrições de domínio**:

- **Relógio**: persistência segue UTC; a conversão para o fuso da clínica
  acontece só na apresentação (FR-016) — a linha da próxima consulta e as datas
  dos cards usam o fuso da clínica, nunca o corte da string ISO.
- **LGPD**: nenhum dado novo é exposto (FR-011, SC-006). O nome do paciente
  continua vindo por RPC que decifra, e só o primeiro nome chega à tela.
- **Observabilidade**: cada acesso vira evento na trilha, agora com a área.

**Violações a justificar**: nenhuma. A seção _Complexity Tracking_ fica vazia.

## Project Structure

### Documentation (this feature)

```text
specs/057-portal-paciente-home/
├── plan.md              # Este arquivo
├── research.md          # Fase 0 — D1..D6, sem incógnitas remanescentes
├── data-model.md        # Fase 1 — as duas colunas novas + entidades de tela
├── quickstart.md        # Fase 1 — roteiro de verificação
├── contracts/
│   ├── portal-routes.md    # rotas do portal + invariantes + renovação
│   └── portal-config.md    # texto de boas-vindas na configuração
├── checklists/
│   └── requirements.md  # qualidade do spec (todos os itens passam)
└── tasks.md             # Fase 2 — criado por /speckit.tasks
```

### Source Code (repository root)

```text
src/
├── middleware.ts                                  # ALTERADO — só comentário: por que a renovação NÃO mora aqui
├── app/
│   ├── paciente/[slug]/
│   │   ├── page.tsx                               # login (inalterado)
│   │   └── painel/
│   │       ├── layout.tsx                         # NOVO — dispara a renovação da sessão
│   │       ├── page.tsx                           # ALTERADO — home: metas, checklist, cards, promoção
│   │       ├── logout-button.tsx                  # inalterado
│   │       ├── evolucao/page.tsx                  # NOVO
│   │       ├── atendimentos/page.tsx              # NOVO
│   │       ├── orientacoes/page.tsx               # NOVO
│   │       ├── exames/page.tsx                    # NOVO
│   │       ├── treino/page.tsx                    # NOVO
│   │       └── dieta/page.tsx                     # NOVO
│   ├── api/paciente/sessao/route.ts               # NOVO — renova a janela de inatividade
│   └── (dashboard)/configuracoes/portal-paciente/
│       ├── portal-config-form.tsx                 # ALTERADO — campo do texto de boas-vindas
│       └── actions.ts                             # ALTERADO — grava o texto
├── components/patient-portal/
│   ├── portal-header.tsx                          # ALTERADO — voltar + linha da próxima consulta
│   ├── section-cards.tsx                          # NOVO — grade de cards
│   ├── portal-empty.tsx                           # NOVO — vazio de seção
│   ├── promoted-area.tsx                          # NOVO — área aberta na home
│   ├── session-keep-alive.tsx                     # NOVO — dispara a renovação
│   └── (demais componentes reaproveitados sem alteração)
└── lib/core/patient-portal/
    ├── page-guard.ts                              # NOVO — openPortalPage (porta única)
    ├── session.ts                                 # ALTERADO — teto absoluto + renovação
    ├── audit.ts                                   # ALTERADO — campo `section`
    ├── portal-config.ts                           # ALTERADO — welcomeText
    └── read-portal.ts                             # ALTERADO — exporta listPortalAppointments

supabase/migrations/
└── 0202_portal_home.sql                           # NOVO
```

**Structure Decision**: mantém-se a estrutura já estabelecida pela 030/032 — o
portal vive em `src/app/paciente/`, **fora** do route group `(dashboard)`, sem
sidebar e sem sessão de staff; a lógica em `src/lib/core/patient-portal/`; os
componentes em `src/components/patient-portal/`. A feature acrescenta um nível
de rota sob `painel/`, um guard e dois componentes, sem introduzir camada nova.

## Fases de implementação

Ordem sugerida; o detalhamento em tarefas é do `/speckit.tasks`.

1. **Fundação (já no working tree)** — `openPortalPage`, as seis páginas de
   área, a grade de cards, o vazio de seção e o `backHref` do cabeçalho. Passa
   em `tsc`, `next lint` e `check-require-role`.
2. **Migration 0202** — as duas colunas (`patient_portal_welcome_text`,
   `section`). Escrever o `.sql` e o arquivo de deploy; **não aplicar** em
   produção (o usuário cola no SQL Editor).
3. **Trilha com área** (FR-007/007a) — `logPatientAccess` aceita `section`;
   `openPortalPage` passa a chave da seção (`home` na tela inicial).
4. **Linha da próxima consulta** (FR-014–016) — no cabeçalho, respeitando o
   gate da área de atendimentos e o fuso da clínica.
5. **Texto de boas-vindas** (FR-018) — coluna, schema Zod com normalização de
   vazio, campo na tela de configuração.
6. **Promoção da tela inicial** (FR-017/019/020/021) — `getActiveChecklist` no
   servidor decide "tem hábitos?"; a área promovida sai da grade.
7. **Sessão** (FR-022–024) — teto absoluto na verificação e renovação em
   `POST /api/paciente/sessao`, disparada pelo layout do painel. **Não** no
   middleware: Edge não tem `node:crypto` e o build quebra (research D1).
8. **Testes** — contrato de isolamento (cookie de outra clínica), integração do
   gate de seção por URL direta, unidade para a janela/teto de sessão e para a
   normalização do texto. **Escritos agora, executados quando o Docker voltar.**

## Riscos e pontos de atenção

- **Middleware é Edge** — qualquer tentativa de mover a renovação para lá volta a
  quebrar o build por `node:crypto`. O comentário em `src/middleware.ts` registra
  isso no lugar onde alguém tentaria de novo.
- **Exame em dois lugares** — as páginas de evolução e de exames montam o bundle
  completo de propósito: é ele que aplica a regra da 050. Fatiar essa parte
  reintroduziria o defeito que o `fc1698a` consertou.
- **Numeração da migration** — conferido em 2026-08-13: a última no repositório
  é a 0201 e a 0202 está livre. Reconferir se a outra sessão (056) criar uma
  migration antes de a 0202 ser aplicada.
- **`CLAUDE.md` é editado pelas duas sessões** — documentar só na seção do portal
  e esperar conflito no merge.

## Complexity Tracking

> Sem violações da constituição. Nada a justificar.
