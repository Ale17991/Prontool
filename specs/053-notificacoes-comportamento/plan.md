# Implementation Plan: Notificações por comportamento do paciente

**Branch**: `053-notificacoes-comportamento` | **Date**: 2026-08-04 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/053-notificacoes-comportamento/spec.md`

## Summary

A clínica liga regras prontas de um catálogo fechado de **catorze famílias** e o
sistema fala com o paciente quando o comportamento dele bate a condição. Nove
famílias observam **ausência** — hábito sem registro, medição parada, meta se
afastando, portal abandonado, retorno vencido, exame não realizado, avaliação
vencida, recordatório em branco, plano sem revisão. Cinco observam **presença** e
reconhecem em vez de cobrar — meta atingida, sequência mantida, pós-consulta,
aniversário, aniversário de acompanhamento.

A divisão não é temática. Família de celebração observa evento presente no dado,
então escapa dos dois filtros que só existem para proteger contra inferência de
ausência (portal e linguagem), e tem **precedência quando o teto do paciente
binda** — se ele só pode receber uma mensagem esta semana, que seja a que
reconhece.

A abordagem técnica em uma frase: **um ciclo diário que varre sinais e grava a
decisão, sempre**. O gatilho é ausência de evento, que nenhum bus publica, então
só varredura temporal detecta. Cada encontro entre regra e paciente vira uma
ocorrência append-only com o desfecho — enviada, silenciada, adiada, suprimida,
recusada — e é dessa tabela que saem o histórico, o anti-spam e a resposta para
"por que meu paciente não recebeu?".

A decisão que governa o desenho inteiro não é técnica: `habit_checklist_marks`
não distingue "não fez" de "não abriu o app", e a mensagem vai direto ao
paciente. Daí duas consequências estruturais — nenhum texto afirma que o
paciente deixou de fazer algo, e regras que observam registro são **suprimidas**
para quem não teve atividade no portal na janela, passando a bola para a regra
de reengajamento.

## Technical Context

**Language/Version**: TypeScript 5.4 sobre Node.js 20 LTS (runtime Vercel)
**Primary Dependencies**: Next.js 14.2 (App Router, RSC, Route Handlers, Server Actions), `@supabase/ssr` 0.5 / `@supabase/supabase-js` 2.45, Zod 3.23, Tailwind 3.4, shadcn/ui (Radix), `lucide-react`, `date-fns` + `date-fns-tz` (fuso da clínica), `@upstash/qstash` (já instalado), Pino 9. **Sem novas dependências** — a avaliação é aritmética de datas e comparação de conjuntos.
**Storage**: PostgreSQL via Supabase, RLS por `tenant_id`. **Migration nova**: `0192_patient_signal_rules.sql`. **Tabelas novas**: `signal_rules`, `signal_occurrences`, `patient_messages`. **Coluna nova**: `patients.outreach_opt_in`.
**Testing**: vitest — `tests/unit/` (catálogo, predicados, lista de expressões proibidas, desempate), `tests/integration/` (ciclo, idempotência, isolamento multi-tenant, RBAC), `tests/contract/` (worker, validações da API).
**Target Platform**: Vercel (Hobby — **cron diário é o teto de frequência**; frequência maior trava todos os deploys silenciosamente).
**Project Type**: web application (Next.js full-stack)
**Performance Goals**: o ciclo diário conclui todas as clínicas dentro do `maxDuration` da rota; avaliação de uma clínica com 500 pacientes e 5 regras sem N+1.
**Constraints**: sem cron adicional além de um diário; contato do paciente cifrado em repouso (decifrado só via RPC); `signal_occurrences` e `patient_messages` append-only.
**Scale/Scope**: **14 famílias de regra** (5 de celebração, 9 de ausência), 1 tela de configuração, 1 tela de histórico, 2 rotas de ciclo/worker, 5 rotas de CRUD.

## Constitution Check

*GATE: avaliado antes da Phase 0 e reavaliado após a Phase 1.*

| Princípio | Toca? | Como fica |
|---|---|---|
| **I — Integridade Financeira Imutável** | Não | A feature não escreve valor financeiro. `signal_occurrences` e `patient_messages` são append-only por trigger, adotando a mesma postura por consistência. |
| **II — Auditabilidade Total de Preços** | Parcial | Não toca preço. Criação, alteração e desativação de regra geram entrada via `log_audit_event` (FR-007), e a alteração de consentimento do paciente também (FR-016) — é dado sensível de LGPD. |
| **III — Isolamento Multi-Tenant** | **Sim** | Todas as três tabelas novas têm `tenant_id NOT NULL` com RLS. O ciclo roda com service-role e **filtra `tenant_id` explicitamente em cada query** — defesa em camadas, não confiança no RLS. Teste de isolamento obrigatório. PKs em UUID. |
| **IV — Conformidade TUSS/ANS** | Não | Nenhum código de procedimento envolvido. |
| **V — Segurança por Perfil (RBAC)** | **Sim** | CRUD exige `reminders.config`, avaliado no servidor em toda rota (`pnpm lint:auth`). O worker é isento de `requireRole` por autenticar via assinatura QStash — mesmo precedente de `send-whatsapp-reminder`. Gate de módulo **na tela e no motor**. |

**Restrições de domínio aplicáveis**:

- **LGPD** — é o ponto mais sensível desta feature. Contato do paciente
  permanece cifrado e é decifrado só no instante do envio, via RPC. `body` de
  `patient_messages` contém o nome do paciente e é tratado como dado de
  paciente: RLS por tenant, fora de log, fora do `renderSafeDetail` de alertas.
  Consentimento de finalidade próprio (FR-014), nunca herdado do lembrete.
- **Relógio** — timestamps em UTC na persistência. `cycle_date` é `DATE` no
  **fuso da clínica**, porque "dia" é conceito do usuário, não do servidor
  (FR-012).
- **Observabilidade** — o ciclo emite evento estruturado por clínica com
  contadores por desfecho, `tenant_id` e `trace_id`. Sem PII.

**Resultado do gate**: **PASSA**, antes e depois da Phase 1. Nenhuma violação a
justificar — a seção Complexity Tracking fica vazia e foi removida.

## Project Structure

### Documentation (this feature)

```text
specs/053-notificacoes-comportamento/
├── plan.md              # Este arquivo
├── spec.md              # O quê e por quê
├── research.md          # 12 decisões técnicas (D1–D12)
├── data-model.md        # Tabelas, desfechos, índices
├── quickstart.md        # Como subir e exercitar
├── checklists/
│   └── requirements.md  # Validação do spec
├── contracts/
│   ├── rule-catalog.md  # As 5 famílias e suas invariantes
│   └── api.md           # Rotas, validações, ciclo, worker
└── tasks.md             # Phase 2 — criado pelo /speckit.tasks
```

### Source Code (repository root)

```text
src/
├── lib/core/signals/                  # NOVO — o motor
│   ├── catalog.ts                     # as 14 famílias (código, não tabela — D2)
│   ├── families/
│   │   ├── celebracao/                # observa PRESENÇA: sem filtro de portal,
│   │   │   ├── meta-atingida.ts       # sem validação de linguagem, prioridade 1–9
│   │   │   ├── sequencia-habito.ts
│   │   │   ├── aniversario.ts
│   │   │   ├── aniversario-acompanhamento.ts
│   │   │   └── pos-consulta.ts
│   │   └── ausencia/                  # observa AUSÊNCIA: filtros aplicáveis,
│   │       ├── habito-sem-registro.ts # prioridade 10+
│   │       ├── sem-acesso-portal.ts
│   │       ├── sem-registrar-medicao.ts
│   │       ├── recordatorio-em-branco.ts
│   │       ├── afastando-da-meta.ts
│   │       ├── exame-nao-realizado.ts
│   │       ├── sem-retorno.ts
│   │       ├── avaliacao-vencida.ts
│   │       └── plano-sem-revisao.ts
│   ├── evaluate-cycle.ts              # orquestra o ciclo por clínica
│   ├── gates.ts                       # consentimento, contato, portal, silêncio, teto
│   ├── occurrences.ts                 # grava e consulta ocorrências
│   ├── rules.ts                       # CRUD das regras ligadas
│   ├── template.ts                    # placeholders + render
│   ├── forbidden-phrases.ts           # a rede de FR-008 (D9)
│   └── types.ts
│
├── lib/core/messaging/                # NOVO — a abstração que faltava (D8)
│   └── send-to-patient.ts             # contato + consentimento + canal + registro
│
├── app/api/
│   ├── notificacoes-automaticas/      # NOVO — CRUD, prévia, ocorrências
│   ├── cron/patient-signals/          # NOVO — ciclo diário
│   └── workers/send-patient-message/  # NOVO — entrega via QStash
│
└── app/(dashboard)/configuracoes/notificacoes-automaticas/   # NOVO — tela
    ├── page.tsx                       # gate: reminders.config + módulo
    ├── rule-list.tsx
    ├── rule-form.tsx                  # parâmetros + texto + prévia
    ├── consent-banner.tsx             # avisa que a base nasce sem aceite (D5)
    └── occurrences-table.tsx

supabase/migrations/0192_patient_signal_rules.sql
```

**Structure Decision**: cápsula própria em `src/lib/core/signals/`, fora do
registry de `IntegrationAdapter` (research D1) — precedente da Memed (026 D1) e
do WhatsApp (051). `messaging/` nasce separada de `signals/` de propósito:
"enviar mensagem a um paciente" não deve saber o que é regra, para que os
lembretes possam migrar para ela depois sem arrastar este motor junto.

## Ordem de entrega

Segue as prioridades do spec, com uma amarração que não é negociável:

1. **Fundação** — migration, contrato de família, `messaging/send-to-patient`,
   gates. O contrato de família nasce já com as duas naturezas: retrofitar
   `celebração` depois obrigaria a rever cada filtro escrito assumindo ausência.
2. **US1 + US2 juntas.** A US2 (supressão por portal) **não pode** ficar para
   depois: entregar a US1 sozinha cobra hábito de quem talvez o esteja
   cumprindo, que é o dano que a feature inteira foi desenhada para evitar. Elas
   formam uma unidade de entrega.
3. **US4** (teto global) — antes de ampliar o catálogo, porque é ampliando que
   as regras começam a se sobrepor no mesmo paciente.
4. **US5** (as 5 famílias de celebração). Vêm **antes** do resto das ausências,
   por duas razões: são as mais baratas (nenhum filtro se aplica) e é o que
   impede a feature de ir a público sabendo só cobrar.
5. **US3** (texto próprio + prévia + validação).
6. **US6** (as 8 famílias de ausência restantes).

## Riscos conhecidos

| Risco | Mitigação |
|---|---|
| Segundo cron recusado no plano Hobby | Fallback: chamar o ciclo de sinais ao final do ciclo de lembretes. Só muda `vercel.json`, não o código (D7). |
| FR-008 é garantia parcial | Assumido e registrado em D9: a lista de expressões pega descuido, não má-fé. A garantia real está nos textos padrão. |
| Base nasce sem aceite → feature entrega zero no dia 1 | Banner na tela dizendo isso **antes** de a clínica ligar a primeira regra, com o número de pacientes com aceite. |
| Ciclo estourar o tempo com muitas clínicas | Cap por ciclo e paginação por clínica, no padrão do `processBatch`. Contadores por desfecho revelam truncamento. |
| Sem rastreio de entrega em v1 | Escopo consciente (D3). Caminho de generalização de `whatsapp_delivery_events` documentado. |
