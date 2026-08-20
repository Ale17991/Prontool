# Implementation Plan: Construtor de automações de mensagem

**Branch**: `056-automacoes-mensagem` | **Date**: 2026-08-11 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/056-automacoes-mensagem/spec.md`

## Summary

A clínica passa a montar suas próprias automações: escolhe um **gatilho** (fonte + parâmetros) e uma **mensagem** do seu catálogo, liga, e o ciclo diário faz o resto. Gatilho e mensagem são entidades separadas e reaproveitáveis.

A abordagem técnica é uma **cápsula própria** (`src/lib/core/automations/`) com um **registro de fontes** — cada fonte declara como enumerar candidatos do dia, como calcular a chave da ocorrência e quais variáveis sabe preencher. Adicionar fonte nova vira uma entrada no registro, não migration nem tabela. O envio reaproveita integralmente a cápsula de WhatsApp da 051; esta feature não abre um segundo caminho de saída.

A garantia de "uma vez só" é **estrutural**, não procedural: uma tabela de ocorrências append-only com `UNIQUE (automação, paciente, chave_da_ocorrência)`. Reexecutar o ciclo colide no índice em vez de mandar mensagem repetida — mesmo mecanismo que torna o marcar do checklist idempotente.

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel)
**Primary Dependencies**: Next.js 14.2 (App Router, RSC, Server Actions, Route Handlers), `@supabase/ssr` 0.5 / `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind 3.4, shadcn/ui (Radix), `lucide-react`. **Sem novas dependências** — a avaliação é consulta SQL mais aritmética de datas, e o envio já existe.
**Storage**: PostgreSQL via Supabase com RLS por `tenant_id`. **Migration nova**: `0196_message_automations.sql` (última é a `0195`). **Tabelas novas**: `message_templates`, `automation_triggers`, `automations`, `automation_occurrences`. **Coluna nova**: `patients.automations_opt_in`.
**Testing**: Vitest — unit (motor de datas, chave de ocorrência, render), contract (RBAC, isolamento por tenant, append-only), integration (ciclo ponta a ponta contra Supabase local)
**Target Platform**: Vercel (produção) + Supabase local em desenvolvimento
**Project Type**: Web application (Next.js monolítico com App Router)
**Performance Goals**: O ciclo diário completo (lembretes + automações) precisa caber no `maxDuration` da rota de cron. Alvo: avaliar 5.000 pacientes por clínica em menos de 10 s, com envio limitado por teto.
**Constraints**: Cron **diário** — plano Hobby da Vercel não permite frequência maior sem travar todos os deploys. Espaçamento entre envios de WhatsApp é obrigatório (risco de bloqueio do número).
**Scale/Scope**: 7 clínicas hoje, ~700 pacientes na maior. 5 fontes de gatilho no v1, 4 telas novas.

## Constitution Check

_GATE: Must pass before Phase 0 research. Re-check after Phase 1 design._

| Princípio                              | Situação          | Como o desenho atende                                                                                                                                                                                                                             |
| -------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **I. Integridade Financeira Imutável** | **Não aplicável** | A feature não toca valor, preço, fatura nem repasse. Nenhuma tabela financeira é lida ou escrita.                                                                                                                                                 |
| **II. Auditabilidade Total**           | **Aplicável**     | Criação, edição, ativação e desativação de automação, gatilho e mensagem passam por `log_audit_event` com ator e motivo (FR-018). `automation_occurrences` é append-only com trigger anti-UPDATE/DELETE, no padrão de `whatsapp_delivery_events`. |
| **III. Isolamento Multi-Tenant**       | **Aplicável**     | Todas as 4 tabelas novas carregam `tenant_id` NOT NULL com RLS. O motor roda com service client e **filtra `tenant_id` explicitamente em cada consulta**, como já faz `process-batch`. Teste de contrato de isolamento é obrigatório.             |
| **IV. Conformidade TUSS/ANS**          | **Não aplicável** | Nenhum código de procedimento é lido ou emitido.                                                                                                                                                                                                  |
| **V. RBAC**                            | **Aplicável**     | Criar/editar automação é `admin` (FR-022), verificado no servidor em toda rota. Gate de módulo `automacoes` vale também no **motor**, não só na tela (FR-023) — lição direta da 051.                                                              |

**LGPD (Restrições de Domínio)**: consentimento próprio e explícito (FR-015), nascendo negado; paciente anonimizado sai da avaliação (FR-017); nenhum telefone ou conteúdo de mensagem em log. Timestamps em UTC na persistência; "hoje" e "semana corrente" convertidos para o dia civil da clínica só na avaliação, no mesmo critério do checklist de hábitos.

**Resultado**: nenhuma violação. Complexity Tracking não se aplica.

### Reavaliação após o desenho (Phase 1)

O desenho não introduziu violação, e reforçou dois princípios em pontos concretos:

- **III (isolamento)**: o `data-model.md` acrescentou CHECK de consistência de tenant em `automations` — FK sozinha permitiria uma automação apontar para gatilho de um tenant e mensagem de outro. Foi um buraco encontrado ao desenhar, não previsto na análise inicial.
- **II (auditabilidade)**: `automation_occurrences` é append-only com **uma exceção declarada** — o desfecho transita do valor provisório para o final, e linhas suprimidas por teto são removíveis para reavaliação no ciclo seguinte. Exceção estreita, escrita no trigger, e não "append-only exceto quando der trabalho".

O ponto que merece vigilância na implementação não é constitucional, é o **FR-025**: se o registro de fontes nascer acoplado às cinco fontes do v1, absorver o lembrete de consulta depois vira reescrita — exatamente o que a decisão de convivência quis evitar.

## Project Structure

### Documentation (this feature)

```text
specs/056-automacoes-mensagem/
├── plan.md              # Este arquivo
├── spec.md
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/           # Phase 1
└── checklists/
    └── requirements.md
```

### Source Code (repository root)

```text
src/lib/core/automations/
├── types.ts             # AutomationSource, TriggerParams, Occurrence, desfechos
├── sources/
│   ├── registry.ts      # o catálogo de fontes — ponto único de extensão
│   ├── aniversario.ts
│   ├── confirmacao-agendamento.ts
│   ├── sem-retorno.ts
│   ├── checklist-marcado.ts
│   └── checklist-sem-marcacao.ts
├── evaluate.ts          # varre fontes, aplica tetos, grava ocorrências
├── render.ts            # variáveis → texto; recusa variável desconhecida
├── occurrences.ts       # leitura/escrita do registro append-only
├── preview.ts           # FR-014 — quantos pacientes satisfazem hoje
└── store.ts             # CRUD de mensagens, gatilhos e automações

src/app/api/automacoes/
├── mensagens/route.ts               # GET, POST
├── mensagens/[id]/route.ts          # PATCH, DELETE
├── gatilhos/route.ts                # GET, POST
├── gatilhos/[id]/route.ts           # PATCH, DELETE
├── gatilhos/[id]/previa/route.ts    # FR-014
└── [id]/route.ts                    # PATCH (ativar/desativar a automação)

src/app/(dashboard)/configuracoes/automacoes/
├── page.tsx                         # lista de automações
├── automacoes-client.tsx
├── mensagens-client.tsx             # catálogo
└── gatilho-form.tsx                 # inclui o aviso do FR-009

supabase/migrations/0196_message_automations.sql

tests/
├── unit/automations-{ocorrencia,render,fontes}.spec.ts
├── contract/automations-{rbac,tenant-isolation,append-only}.spec.ts
└── integration/automations-ciclo.spec.ts
```

**Structure Decision**: cápsula própria em `src/lib/core/automations/`, irmã de `core/reminders` e não subordinada a ela — é o que o FR-024 exige (motores separados) sem impedir o FR-025 (absorção futura). O registro de fontes é o ponto de extensão: o dia em que o lembrete de consulta for absorvido, ele entra como mais um arquivo em `sources/`, sem tocar em `evaluate.ts` nem no modelo de dados.

## Complexity Tracking

Não aplicável — nenhuma violação constitucional a justificar.
