# Phase 0 — Research: Odontograma Interativo

Todas as ambiguidades funcionais foram resolvidas no `/speckit.clarify` (ver `## Clarifications` em spec.md). Este documento registra as decisões técnicas e o reuso de padrões existentes.

## D1 — Renderização do odontograma: SVG inline custom (sem lib)

- **Decisão**: Renderizar a carta dentária com SVG inline em componentes React. Cada dente é um grupo SVG com 5 sub-regiões (`<path>`/`<polygon>`) clicáveis, uma por face. Cor controlada por estado React mapeado para a cor do status.
- **Rationale**: Libs de odontograma (`react-odontogram` etc.) são pequenas, pouco mantidas e com visual/notação fixos. O projeto proíbe novas deps sem justificativa forte (CLAUDE.md). SVG escala sem perder nitidez, o clique por face sai natural com `onClick` por região, e Tailwind/`lucide-react` já cobrem o resto.
- **Alternativas rejeitadas**: (a) `<canvas>` — clique por região exige hit-testing manual, pior acessibilidade; (b) lib externa — dependência frágil, menos controle visual, contraria política de deps.
- **Geometria**: usar `biomathcode/react-odontogram` apenas como referência conceitual da divisão das 5 faces; implementar do zero.

## D2 — Catálogo de status: tabela global (sem tenant_id), padrão `tuss_codes`

- **Decisão**: `dental_status_catalog` é referência **global da plataforma**, sem `tenant_id`. Leitura liberada a `authenticated` (apenas ativos), escrita só via service-role acionado pelo super-admin no `/admin`. Mutações auditadas por colunas `created_by`/`updated_by` + `created_at`/`updated_at` na própria tabela (a `audit_log` é por-tenant e exige `tenant_id`, inadequada para entidade global).
- **Rationale**: Confirmado no clarify — catálogo global. Status dentários (cárie, restauração, ausente…) são universais; replicar por tenant seria desperdício e divergência. Espelha exatamente como `tuss_codes` é tratado (global, read-only para tenants).
- **Alternativas rejeitadas**: (a) catálogo per-tenant — contraria "super-only no /admin", dobra complexidade; (b) constantes hardcoded — o requisito central é justamente não ter status fixo no código.
- **Idempotência do seed**: `INSERT ... ON CONFLICT (code) DO NOTHING` no conjunto padrão.

## D3 — Estado atual derivado de histórico append-only (sem tabela mutável)

- **Decisão**: Não existe tabela de "estado". O estado atual de cada posição (dente, face) é o registro mais recente em `dental_chart_entries`. Exposto por RPC `dental_chart_current(p_tenant_id, p_patient_id)` usando `DISTINCT ON (tooth_fdi, surface) ... ORDER BY tooth_fdi, surface, recorded_at DESC`.
- **Rationale**: `DISTINCT ON` é específico do Postgres e não é expressável pelo query builder do supabase-js; uma RPC `SECURITY DEFINER` (com checagem de tenant via parâmetro + filtro) é o caminho limpo, igual ao usado em outras features (ex.: `get_patient_for_tenant`, `patient_portal_*`). Mantém histórico completo (Princípios I/II) sem `UPDATE`.
- **Alternativas rejeitadas**: (a) view materializada — overkill para volume pequeno; (b) reduzir no cliente buscando todo histórico — funciona mas cresce com o tempo e mistura responsabilidade.

## D4 — "Limpar" marcação = status neutro semeado com escopo `both`

- **Decisão**: Limpar/remover uma marcação (FR-006) é registrar um novo evento cujo status é o padrão **"Sem registro"** (code `none`), semeado com `scope='both'` e cor neutra. Aplicar esse status volta a posição ao estado neutro, preservando o histórico.
- **Rationale**: Mantém o modelo uniforme (toda mudança é um INSERT de status), evita `status_id` nulo ou flag especial, e funciona tanto para dente quanto para face.
- **Escopo**: `scope ∈ ('tooth','face','both')`. Paleta de face mostra `scope IN ('face','both')`; paleta de dente mostra `scope IN ('tooth','both')` (FR-012).

## D5 — Notação FDI e modelo de posição

- **Decisão**: `tooth_fdi` é `SMALLINT` com CHECK no conjunto válido: permanentes 11–18,21–28,31–38,41–48; decíduos 51–55,61–65,71–75,81–85. A dentição (permanente/decídua) é derivada do quadrante (dígito das dezenas 1–4 = permanente, 5–8 = decíduo) — sem coluna dedicada. Faces: `mesial`, `distal`, `occlusal_incisal`, `vestibular`, `lingual_palatal`. Constantes e validação centralizadas em `src/lib/core/dental/teeth.ts`.
- **Rationale**: FDI é o padrão brasileiro/TISS e já conversa com o módulo TISS (029). Derivar dentição do código evita coluna redundante. `occlusal_incisal` unifica oclusal (posteriores) e incisal (anteriores) numa só posição, rotulada na UI conforme o tipo de dente (edge case da spec).

## D6 — Integração no prontuário e na navegação admin

- **Decisão**: Odontograma entra como nova aba em `src/app/(dashboard)/operacao/pacientes/[id]/_components/patient-detail-layout.tsx` (junto de Evolução/Clínico/Cadastro). Administração do catálogo entra sob `/admin/catalogo/status-odontologicos`, gated por `requireSuperAdmin` (`src/lib/auth/platform-admin.ts`).
- **Rationale**: Reuso direto da estrutura de tabs existente e do layout `/admin`. Não introduz nova navegação top-level.
- **Pendência de produto (não bloqueia Fase 1)**: avaliar gating por entitlement/módulo (feature 031) — ex.: módulo `odonto` no plano. Tratado como follow-up; nesta fase a aba aparece para todos os tenants.

## D7 — RBAC e padrões de escrita

- **Decisão**: POST de marcação via `requireRole(['admin','profissional_saude'], {...})` + `createSupabaseServiceClient()` + filtro explícito de `tenant_id` (padrão idêntico ao de `vital_signs`/`clinical_records`). Catálogo: GET ativo para `authenticated`; GET-todos/POST/PATCH só super-admin.
- **Rationale**: Dentista é `profissional_saude`. Padrão já consolidado e coberto por `lint:auth`.
- **Alternativas rejeitadas**: server actions — o projeto padroniza Route Handlers para escrita clínica.

## Reuso de padrões existentes (referências de código)

| Necessidade                                          | Padrão a reusar                                    | Arquivo de referência                                                               |
| ---------------------------------------------------- | -------------------------------------------------- | ----------------------------------------------------------------------------------- |
| Migration tabela + RLS por tenant                    | `patient_measurements`                             | `supabase/migrations/0113_patient_portal_measurements.sql`                          |
| Append-only genérico                                 | `enforce_append_only_columns('')`                  | `supabase/migrations/0095_financeiro_operacional.sql`                               |
| Imutabilidade simples + consistência de tenant       | `appointment_materials` triggers                   | `supabase/migrations/0061_appointment_materials.sql`                                |
| Auditoria                                            | `log_audit_event` + `session_uuid('app.actor_id')` | `supabase/migrations/0013_audit_triggers.sql`                                       |
| Catálogo global read-only                            | `tuss_codes`                                       | `supabase/migrations/0003_tuss_catalog.sql`, `0037_tuss_multi_table.sql`            |
| Busca TUSS por tabela                                | `searchTussCatalog({ table: '22' })`               | `src/lib/core/catalog/list-tuss.ts`                                                 |
| RPC SECURITY DEFINER por tenant                      | `get_patient_for_tenant`                           | `supabase/migrations/0027_*`                                                        |
| Core write clínico (assert paciente → insert → DTO)  | `createVitalSigns`                                 | `src/lib/core/patient-medical/vital-signs.ts`                                       |
| Route Handler clínico                                | sinais-vitais POST                                 | `src/app/api/pacientes/[id]/sinais-vitais/route.ts`                                 |
| Aba no prontuário                                    | tabs do paciente                                   | `src/app/(dashboard)/operacao/pacientes/[id]/_components/patient-detail-layout.tsx` |
| Admin super-only + CRUD catálogo                     | `requireSuperAdmin` + padrão taxes                 | `src/lib/auth/platform-admin.ts`, `src/app/(dashboard)/analise/despesas/impostos/*` |
| Service client (allowlist inclui `lib/core/catalog`) | `createSupabaseServiceClient`                      | `src/lib/db/supabase-service.ts`                                                    |
| Helpers RLS                                          | `jwt_tenant_id()`, `jwt_role()`                    | `supabase/migrations/0017_rls_policies.sql`                                         |

## Não-funcional

- **Performance**: marcação otimista no cliente (pinta antes da confirmação do servidor; reverte em erro) → feedback <1s (SC-003). Estado atual via RPC indexada.
- **Acessibilidade**: faces SVG com `role`/`aria-label` (dente + face + status), foco navegável por teclado.
- **i18n**: rótulos em PT-BR, consistentes com o restante do app.
