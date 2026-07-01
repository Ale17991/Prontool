# Phase 0 Research — Feature 007

**Date**: 2026-04-30
**Branch**: `007-linguagem-simples-materiais-whatsapp`

Resumo das investigações feitas no código existente para fundamentar as decisões do plano. Cada item segue o padrão **Decisão / Rationale / Alternativas consideradas**.

---

## R1. Catálogo TUSS tabela 19 (Materiais) já está disponível

**Decisão**: Reutilizar o catálogo `tuss_codes` existente, filtrando por `tuss_table = '19'`. Não é necessária migração de dados.

**Rationale**:

- A migration `0037_tuss_multi_table.sql` adicionou a coluna `tuss_table` (CHECK em `'19', '20', '22'`) ao catálogo, com label gerada `'Materiais'` para `'19'`.
- O service `searchTussCatalog` (em `src/lib/core/catalog/list-tuss.ts`) já aceita `input.table?: '22' | '19' | '20'` e aplica `query.eq('tuss_table', input.table)`.
- O componente `<TussTypeahead table="19" ...>` em `src/components/tuss/tuss-typeahead.tsx` já é reutilizável — passa `table` como query param para `/api/tuss-codes`, e o backend filtra por essa tabela.
- O catálogo TUSS é populado por `pnpm seed:tuss` via mirror `charlesfgarcia/tabelas-ans` (referenciado nos comentários da migration 0053). A confirmação de que tabela 19 está populada será feita executando `SELECT count(*) FROM tuss_codes WHERE tuss_table='19' AND valid_to IS NULL` no `pnpm supabase:reset` local antes do desenvolvimento.

**Alternativas consideradas**:

- **Tabela própria de "materiais da clínica"** (admin cadastra manualmente): rejeitada — viola Principle IV (TUSS é fonte autoritativa, não pode ser editado por usuário da clínica) e duplica esforço de manutenção do catálogo.
- **Buscar TUSS direto via API ANS em runtime**: rejeitada — latência inaceitável e fragilidade contra rate limit; o seed local é o padrão estabelecido.

---

## R2. Persistência atômica de atendimento + materiais

**Decisão**: Criar **RPC SQL** `create_appointment_with_materials(p_appointment jsonb, p_materials jsonb)` em `0061_appointment_materials.sql`. Quando o handler recebe `materiais[]` não-vazio, chama esse RPC. Quando recebe vazio ou ausente, mantém o caminho atual de INSERT direto.

**Rationale**:

- Supabase JS client (`@supabase/supabase-js` 2.45) não expõe `BEGIN/COMMIT` — cada call é uma operação. Para garantir "ou tudo, ou nada", precisamos colocar o multi-INSERT em uma única chamada SQL, que é o que o RPC faz (toda função SQL roda em transação implícita do PostgreSQL — se qualquer INSERT falhar, tudo desfaz).
- O padrão já é usado em `create_treatment_plan_step` (migration 0045) e `create_appointment_completion` (migration 0055).
- O RPC respeita RLS porque é declarado SECURITY INVOKER (não SECURITY DEFINER) — o `current_tenant_id()` continua o do JWT do usuário.
- `createAppointmentManually` (em `src/lib/core/appointments/create-manual.ts`) ganha um branch: se `materiais` veio no input, monta os payloads JSONB e chama `supabase.rpc('create_appointment_with_materials', {...})`. Caso contrário, segue como hoje (INSERT direto na tabela `appointments`).

**Alternativas consideradas**:

- **Dois INSERTs sequenciais sem RPC** + delete compensatório se o segundo falhar: rejeitado — fere Principle I (sem DELETE em registros financeiros; DELETE em `appointments` recém-criado é tecnicamente DELETE em registro append-only e violaria o trigger).
- **Inserir materiais ANTES do appointment via FK deferrable**: rejeitado — `appointment_id` é NOT NULL; teríamos que dropar NOT NULL e validar via trigger, complexidade desproporcional ao ganho.
- **Edge function dedicada**: rejeitado — overhead operacional sem benefício; RPC SQL inline é o padrão do projeto.

---

## R3. Triggers de imutabilidade e auditoria

**Decisão**: Espelhar o padrão de `expense_receipts` (migrations 0058/0059):

- Trigger BEFORE UPDATE/DELETE em `appointment_materials` que rejeita a operação para roles diferentes de `service_role`/`postgres`/`supabase_admin`.
- Trigger AFTER INSERT que insere em `audit_log` com `entity_type='appointment_material'`, `event_type='appointment_material.created'`, `actor=NEW.created_by`, `tenant_id=NEW.tenant_id`, e payload JSONB com snapshot da row.

**Rationale**:

- A migration 0058 documenta esse padrão para `expense_receipts` (incluindo a justificativa de mutabilidade controlada para `receipt_*`). Materiais de atendimento não têm campos mutáveis — ainda mais simples.
- O `audit_log` já tem o schema necessário (migration 0013); reutilizamos sem mudanças. Linha de audit_log fica visível para admins via `/operacao/auditoria`.

**Alternativas consideradas**:

- **Versionar materiais (linha nova a cada edição)**: rejeitado — escopo da feature é append-only puro (não há edição). Reduz complexidade e alinha com o decision do spec.
- **Materializar audit em log externo (Pino + storage)**: rejeitado — `audit_log` é a fonte canônica do projeto (Principle II), Pino é complementar.

---

## R4. Localização do botão WhatsApp e estrutura do helper

**Decisão**: Botão renderizado inline em `src/app/(dashboard)/operacao/pacientes/[id]/page.tsx`, ao lado do bloco de contato. Helper puro em `src/lib/utils/whatsapp.ts` exportando `formatPhoneForWhatsApp(raw: string | null | undefined): string | null`.

**Rationale**:

- O page.tsx do paciente já mostra os dados de contato; é o lugar natural.
- Criar um componente `<WhatsAppButton>` standalone é over-engineering para um único uso. Se no futuro a feature 008 precisar do mesmo botão em outro lugar, refatoramos.
- Helper puro (sem dependências de React) é trivialmente testável com Vitest unit. Retorna `null` quando o telefone não pode ser parseado — o componente decide o que renderizar.

**Comportamento do helper** (especificado em FR-016/FR-017):

- Remove caracteres não-numéricos exceto `+` inicial.
- Se a string limpa começa com `+`, retorna como está (sem o `+`, pois `wa.me` não usa).
- Caso contrário, prefixa `55`.
- Se a string limpa for vazia ou tiver < 8 dígitos após processamento, retorna `null`.

**Alternativas consideradas**:

- **biblioteca `libphonenumber-js`**: rejeitado — adiciona ~50KB ao bundle para um uso pontual. A regex simples especificada cobre 100% dos pacientes brasileiros.
- **Componente compartilhado em `src/components/ui/`**: rejeitado — `ui/` é reservado para shadcn primitives. Componente específico de domínio iria em `src/components/pacientes/`, mas para um único uso é ruído.

---

## R5. Mapeamento de strings UI a serem alteradas (Feature 3)

**Decisão**: Construir lista exaustiva no início da Phase 2 (tasks). Estimativa preliminar: **15–25 arquivos** efetivamente tocados (o grep inicial encontrou 119 hits em 45 arquivos, mas a maioria é em código não-UI).

**Heurística para incluir/excluir**:

✅ **Trocar (UI/PDF/email)**:

- `src/app/(dashboard)/**/*.tsx` (todos exceto comentários)
- `src/app/error.tsx`, `src/app/(dashboard)/**/error.tsx`, `not-found.tsx`
- `src/lib/core/patient-medical/prontuario-pdf.tsx` e correlatos
- `src/lib/core/reports/export-*.ts` (textos de Excel — `export-financial-excel.ts`, `export-by-plan-excel.ts`, `export-excel.ts`)
- Mensagens Zod com chave `message:` em arquivos sob `src/app/(dashboard)/`
- Templates de email (se existirem em `src/lib/core/notifications/` — verificar; provavelmente fora de escopo nesta feature)

❌ **NÃO trocar**:

- `src/lib/db/types.ts` (gerado, contém nomes de tabela/coluna) → mas referências como `tenant_id` em código é ok manter
- `src/lib/db/supabase-service.ts` (comentários internos)
- `src/lib/core/integrations/`, `src/lib/integrations/` (palavra "webhook" tem significado técnico — mantida em código)
- `src/lib/auth/require-role.ts` (mensagens de log Pino)
- `src/lib/observability/errors.ts` (códigos de erro técnico — usuário vê apenas a mensagem traduzida pelo error.tsx)
- `src/app/api/webhooks/[provider]/route.ts` (rota técnica; não-visível ao usuário final, apenas ao admin que sabe o que é)
- Comentários, JSDoc, type names, function names em qualquer arquivo
- Qualquer string que vai pra Pino/console.log

**Lista preliminar de arquivos com hits relevantes** (grep `Estornar|Reverter|Estornado|Revertido|Marcar como realizado|Concluir etapa|NKDA|DLQ|Dead Letter|Tenant|Webhook|Schema cache|Erro inesperado|digest`):

| Arquivo                                                                   | Hits      | Ação                                                                                         |
| ------------------------------------------------------------------------- | --------- | -------------------------------------------------------------------------------------------- |
| `src/app/(dashboard)/operacao/atendimentos/[id]/page.tsx`                 | 3         | Revisar — provável "Reverter atendimento", "Estornado"                                       |
| `src/app/(dashboard)/operacao/atendimentos/page.tsx`                      | 2         | Badge "Estornado" → "Cancelado"                                                              |
| `src/app/(dashboard)/operacao/pacientes/[id]/page.tsx`                    | 2         | "NKDA" → "Sem alergias conhecidas" + revisão                                                 |
| `src/app/(dashboard)/operacao/pacientes/[id]/medical-history-section.tsx` | 1         | NKDA                                                                                         |
| `src/app/(dashboard)/operacao/pacientes/error.tsx`                        | 5         | "Erro inesperado", `digest`, mensagem genérica                                               |
| `src/app/(dashboard)/operacao/alertas/page.tsx`                           | 2         | "DLQ" / "Fila de erros" → "Pendências"                                                       |
| `src/app/(dashboard)/operacao/dlq/page.tsx`                               | (rota)    | Renomear título "DLQ" → "Pendências" (URL `/operacao/dlq` permanece — afeta só sidebar e h1) |
| `src/app/(dashboard)/_components/dashboard-shell.tsx`                     | 4         | Sidebar — provável "DLQ", "Webhooks" se aparecerem como links visíveis                       |
| `src/lib/core/patient-medical/assemble-prontuario.ts`                     | 2         | Revisar — texto que vai pro PDF                                                              |
| `src/lib/core/patient-medical/prontuario-pdf.tsx`                         | 1         | PDF (string em JSX renderizada)                                                              |
| `src/lib/core/reports/export-*.ts`                                        | 1+1+1     | Cabeçalhos de Excel                                                                          |
| `src/app/api/workers/process-ghl-event/route.ts`                          | 4         | **NÃO TOCAR** — server-side log/erro técnico                                                 |
| `src/lib/core/webhooks/process-event.ts`                                  | 1         | **NÃO TOCAR** — código técnico                                                               |
| `src/lib/integrations/**`                                                 | múltiplos | **NÃO TOCAR** — código técnico                                                               |
| `src/lib/auth/**`                                                         | múltiplos | **NÃO TOCAR** — log/contrato técnico                                                         |

A lista definitiva é construída em Phase 2 (tasks.md) abrindo cada arquivo individualmente — esta tabela é guia.

**Rationale**: substituição cega via `sed` é proibida pelo edge case de pluralização ("Atendimento cancelado" vs. "Etapa cancelada" vs. "Atendimentos cancelados"). Cada ocorrência requer julgamento humano.

**Alternativas consideradas**:

- **Sistema de i18n (next-intl)**: rejeitado — over-engineering. O sistema é monolíngue PT-BR; adicionar uma camada de tradução para um find-and-replace é desproporcional.
- **Glossário centralizado em `src/lib/utils/labels.ts`** com todas as strings: rejeitado para esta feature — útil se houvesse muitas reutilizações da mesma string, mas a maioria é única por contexto. Helper `eventTypeToLabel()` (ver R6) é a única exceção.

---

## R6. UI mostra "Cancelamento" mas audit_log mantém `appointment.reversed`

**Decisão**: Criar `src/lib/utils/audit-labels.ts` com:

```ts
export function eventTypeToLabel(eventType: string): string {
  const map: Record<string, string> = {
    'appointment.created': 'Atendimento criado',
    'appointment.reversed': 'Cancelamento de atendimento',
    'appointment.realized': 'Atendimento confirmado',
    'appointment_material.created': 'Material adicionado',
    // ... demais eventos
  }
  return map[eventType] ?? eventType
}
```

**Rationale**:

- O `audit_log` é fonte de verdade técnica (Principle II) e nunca deve ser tocado.
- Tudo que o usuário vê na tela `/operacao/auditoria` passa por este helper antes de renderizar.
- Centraliza o vocabulário UI em um lugar — futuras renomeações ficam triviais.

**Alternativas consideradas**:

- **Coluna `event_label` no audit_log**: rejeitado — viola Principle I (mutação retroativa em registros existentes).
- **Tradução inline em cada componente**: rejeitado — duplicação e inconsistência inevitável.

---

## R7. Tela de erro com `digest` — onde renderiza

**Decisão**: Atualizar `src/app/(dashboard)/operacao/pacientes/error.tsx` (e qualquer `error.tsx` análogo) para:

- Renderizar mensagem genérica "Algo deu errado. Tente novamente em alguns segundos."
- Mover `error.digest` para `console.error('[error.tsx]', error.message, { digest: error.digest })` — vai para Pino na Vercel sem ser exibido ao usuário.
- Para erros que sejam `DomainError` (têm `code` específico), usar uma whitelist que mostra mensagem específica (ex.: `APPOINTMENT_CONFLICT` → "Já existe atendimento neste horário"). Demais → mensagem genérica.

**Rationale**:

- Next.js 14 expõe `error.digest` para correlação com logs de servidor; o `digest` em si é hash, não vaza dado sensível, mas é ruído visual e gera tickets ("o que é esse digest?").
- O usuário não-técnico não sabe o que fazer com um `digest`; o admin tem acesso ao Pino para correlacionar.

**Alternativas consideradas**:

- **Manter `digest` em pequeno texto cinza ao final**: rejeitado — fere FR-024 explicitamente.
- **Botão "Copiar código de erro"**: rejeitado para esta feature — pode ser feature futura se houver demanda; agora reduzimos ruído.

---

## R8. Substituições com gênero/plural — abordagem manual

**Decisão**: Para cada arquivo que tem hit, abrir, ler o contexto, e fazer Edit individual respeitando gênero/plural. Sem `replace_all` global.

**Rationale**: documentado no edge case do spec. Exemplos do projeto:

- "Atendimento estornado" → "Atendimento cancelado" (masc. sing.)
- "Etapa estornada" → "Etapa cancelada" (fem. sing.)
- "Atendimentos estornados" → "Atendimentos cancelados" (masc. plur.)
- "Reverter atendimento" → "Cancelar atendimento" (verbo)
- "Reversão de atendimento" → "Cancelamento de atendimento" (substantivo)

**Alternativas consideradas**:

- **Codemod com AST**: rejeitado — o ganho não justifica o setup; <30 ocorrências reais.
- **`sed` com 4 padrões diferentes (cada gênero/plural)**: rejeitado — frágil, pode pegar falso-positivo em comentários ou strings de log.

---

## Resumo

Todas as 8 perguntas têm decisão e fundamento. **Nenhum NEEDS CLARIFICATION resta para a Phase 1.** A Phase 1 (data-model, contracts, quickstart) está pronta para escrita.
