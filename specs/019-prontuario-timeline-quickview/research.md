# Phase 0 — Research

**Feature**: 019 — Prontuário Clínico unificado (Timeline + Quick-View)
**Date**: 2026-05-20

Esta fase resolve as decisões técnicas pendentes antes de Phase 1 (design). Tudo que aqui não tem "Decision" explícita continua aberto e BLOCKS Phase 1.

---

## R1 — shadcn `Sheet` cobre os requisitos de acessibilidade (FR-030)?

**Question**: A FR-030 exige trap de foco, retorno de foco ao botão que abriu, anúncio para leitores de tela, fechamento por `Esc`. O componente `src/components/ui/sheet.tsx` (Radix-based) cobre tudo out-of-the-box?

**Decision**: Sim, sem custo extra. O `Sheet` do shadcn é wrapper de `@radix-ui/react-dialog`, que já implementa:
- Focus trap automático enquanto aberto;
- `aria-modal="true"` + `role="dialog"` no container;
- `onEscapeKeyDown` default fechando o overlay;
- Retorno de foco ao trigger via `data-state="closed"` callback;
- Anúncio via `<SheetTitle>` (`aria-labelledby`) e `<SheetDescription>` (`aria-describedby`).

**Action**: Em cada Sheet novo, garantir `<SheetTitle>` e `<SheetDescription>` corretos. Nada mais necessário.

**Alternatives considered**: Modal customizado com `react-aria` — overkill quando o primitive já existe e está em uso.

---

## R2 — Estratégia de URL para tabs "Clínico" / "Cadastro" (FR-023)

**Question**: A FR-023 exige `?tab=cadastro` na URL para deep-link. Duas opções: server-side (Next.js `searchParams` no Server Component → re-fetch quando muda) vs. client-side (`useSearchParams` + `router.replace` shallow).

**Decision**: **Client-side shallow** com `router.replace('/operacao/pacientes/X?tab=cadastro', { scroll: false })` + `useSearchParams()` no componente cliente. Motivo: ambas as abas usam exatamente os mesmos dados (já carregados pelo SSR de `page.tsx`); fazer round-trip ao servidor a cada tab switch é desperdício e introduz latência ≥300ms. A página inteira é carregada uma vez via SSR, e a tab switch é uma alternância de visibilidade, não um re-fetch.

**Implication for design**:
- `page.tsx` recebe `searchParams.tab` apenas para definir a aba inicial no SSR (evitar flash).
- O componente `<PatientDetailLayout>` (client) usa `useSearchParams()` para o estado em runtime.
- Botão "Editar" da sidebar chama `router.replace(href, { scroll: false })`.

**Alternatives considered**:
- Server-side com `revalidatePath`: lento e desnecessário.
- Estado local React (sem URL): perde deep-link e botão "voltar" do navegador.

---

## R3 — `<Tabs>` do shadcn não está instalado

**Question**: `src/components/ui/tabs.tsx` não existe, mas `@radix-ui/react-tabs` está em `package.json`. Adicionar o wrapper shadcn?

**Decision**: Sim. Adicionar `src/components/ui/tabs.tsx` seguindo o padrão shadcn oficial (`Tabs`, `TabsList`, `TabsTrigger`, `TabsContent`) sobre `@radix-ui/react-tabs`. Já temos o package; é só o wrapper estilizado (~50 linhas) reutilizando os tokens semânticos do design system 016.

**Action**: Criar `src/components/ui/tabs.tsx` como **parte desta feature** (não fora dela), porque é um pré-requisito direto.

**Alternatives considered**:
- Inline `<Tabs.Root>` direto do Radix: dispersa a customização do design system 016 e fica feio em múltiplos lugares (Cadastro tab agora, futuras features depois).
- Implementação custom em `<button>` + state: perde a a11y do Radix (`aria-selected`, navegação por seta esquerda/direita).

---

## R4 — Batch de resolução de nomes de autores (FR-013/13a)

**Question**: FR-013 exige autor por nome resolvido em batch via `doctors.full_name` + `user_profile.display_name`. Como organizar?

**Decision**: Função pura `resolveAuthors(supabase, { tenantId, userIds })` que:

1. Recebe um `Set<string>` de `created_by` únicos extraídos do conjunto de eventos.
2. Faz `SELECT user_id, full_name FROM doctors WHERE tenant_id = $1 AND user_id IN (...)`.
3. Faz `SELECT user_id, display_name FROM user_profile WHERE tenant_id = $1 AND user_id IN (...)` para os user_ids restantes (não cobertos por doctors).
4. Retorna `Map<userId, string>` com nome resolvido. user_ids ausentes ficam fora do Map → o consumidor faz fallback para ID truncado.

Como `page.tsx` já carrega `doctorsList` para o `<TreatmentStepsSection>`, podemos **derivar parte do mapa** desse array (já é Promise.all-ed). Para o resto (autores que não são médicos, ex.: recepcionista que registrou texto livre), o batch separado de `user_profile` cobre.

**Performance**: 2 SELECTs no pior caso, ambos com índice (`tenant_id` + UNIQUE em `user_id`). Para um paciente típico (<50 eventos), `userIds` tem cardinalidade ≤5. Custo desprezível.

**RLS**: ambos os SELECTs filtram explicitamente por `tenant_id` (defesa em profundidade) + RLS atual de `doctors`/`user_profile` cobre.

**Alternatives considered**:
- Join SQL na fonte (clinical_records, vital_signs, appointments): replicar em 4 lugares e quebra ao apagar autor. Pior.
- Resolver em cliente via componente: dispara query por item. Anti-padrão N+1. Pior.

---

## R5 — Virtualização da timeline para até 200 eventos (FR-018, SC-007)

**Question**: 200 itens DOM expansíveis exige virtualização (ex.: `react-virtual`)?

**Decision**: **Não.** Para ≤200 itens com layout linear (cada item ~80px collapsed, ~200-400px expanded raramente), render direto é fluido em hardware mediano. Benchmark anedótico: prontuário do iClinic renderiza ~150 itens DOM sem virtualização. Virtualização adiciona complexidade (heights dinâmicos, integração com `Print`) que não compensa.

**Action**: Render linear via `events.map(...)`. Se telemetria pós-launch mostrar paciente com >300 eventos (raro pela A-002), reabrir.

**Alternatives considered**:
- `@tanstack/react-virtual`: ótimo para listas longas planas, ruim para itens com altura dinâmica + impressão.
- Paginação infinite-scroll: muda UX (perde "ver tudo de uma vez"). Edge case 500 eventos sugere botão "Carregar mais antigos" — fica para iteração futura.

---

## R6 — Reusar `assembleProntuarioBundle` (existente) ou criar `assembleTimelineEvents` separado?

**Question**: A função existente em `src/lib/core/patient-medical/assemble-prontuario.ts` já agrega allergies + diagnoses + history + vital_signs + clinical_records + treatment_steps + appointments + materials. Reusar?

**Decision**: **Criar `assembleTimelineEvents` separado** em `lib/core/patient-timeline/`. Motivos:

1. **Forma de saída diferente**: `ProntuarioBundle` é otimizado para o PDF (campos planos, materiais embutidos por appointment). Timeline precisa de uma união discriminada por `kind`, ordenada cronologicamente, com `occurredAt` único — formato incompatível.
2. **SRP**: o bundle do prontuário pode evoluir (campos novos para PDF) sem impactar a timeline e vice-versa.
3. **Fontes parcialmente diferentes**: a timeline inclui `payments` (que o PDF não inclui); o PDF inclui `treatment_steps` lineares (que a timeline pode mostrar apenas como referência via appointment).
4. **Custo de criar é baixo**: ~80 linhas TypeScript.

**Action**: Nova função `assembleTimelineEvents(supabase, { tenantId, patientId, limit }): Promise<TimelineEvent[]>`. Internamente, **chama os mesmos `list*` que `assembleProntuarioBundle` chama** (`listClinicalRecords`, `listVitalSigns`, etc.) — não há query nova nem duplicação de SQL.

**Alternatives considered**:
- Função única `assemblePatientView` com dois modos: aumenta complexidade interna, hoje viola SRP. Reabrir se três consumidores diferentes aparecerem.

---

## R7 — Recharts dentro da timeline para sinais vitais?

**Question**: A timeline filtrada por "Sinais vitais" deve mostrar cada medição como evento expansível **e** o gráfico atual (`VitalSignsSection` usa `LineChart` do recharts) deve continuar acessível?

**Decision**: A timeline mostra **eventos individuais expansíveis** (uma medição = um evento). O **gráfico de série temporal** continua acessível em **uma seção dedicada** na aba "Clínico" — pode ser:
- Opção A: **Botão "Ver gráfico" no chip de filtro "Sinais vitais"** que troca a renderização da timeline por um modo gráfico. Sem nova rota, é só um React state.
- Opção B: Card colapsável "Tendência de sinais vitais" no topo da timeline quando o filtro está em "Sinais vitais".

**Decision final**: **Opção A** — `[Filtro: Sinais vitais]` ativa um toggle adicional `[Lista | Gráfico]`. Default = Lista. Reusa o componente `LineChart` do `VitalSignsSection` quase 1:1, só mudando o invólucro.

**Action**: Marcar como follow-up no `tasks.md`; não bloqueia entrega da timeline base.

---

## R8 — Comportamento ao mudar de paciente com Sheet aberto (Edge case spec.md)

**Question**: O edge case "Sheet aberto e usuário navega para outro paciente: deve fechar automaticamente". Como garantir?

**Decision**: O state do Sheet vive em React state local do componente da rota dinâmica `[id]`. Quando o `params.id` muda, o Next.js desmonta e remonta a árvore (App Router behavior). O state do Sheet é resetado por desmontagem. **Comportamento já garantido pela arquitetura**, sem código extra.

**Verification**: smoke-test no `quickstart.md` cobre o caso (cenário "Trocar paciente com Sheet aberto").

---

## R9 — Indicador visual de alergia "grave" no header mobile colapsado (Edge case)

**Question**: O edge case exige indicador visual de alergia grave mesmo com sidebar colapsada em mobile.

**Decision**: O `mobile-quick-view-header.tsx` (header colapsável <768px) renderiza, ao lado do botão "Ver detalhes", um ícone `AlertTriangle` (lucide-react) em vermelho com badge contendo a contagem de alergias graves, quando `allergies.some(a => a.severity === 'grave')`. Ao clicar no header (toggle), expande os blocos completos.

**Action**: Especificar no `component-contracts.md` (props do `<MobileQuickViewHeader>`).

---

## R10 — Quem é "Recente" no histórico financeiro da sidebar (FR-010)

**Question**: O bloco "Resumo financeiro" do FR-010 menciona "Última consulta paga em". O DTO atual `PatientFinancialSummary` tem essa informação?

**Decision**: O `summary` retornado por `getPatient` já contém `lastAppointmentAt`. Para "última consulta paga", precisamos do mais recente `payment_record` com status `paid` em `listPaymentsForPatient`. Se o helper já agrega isso, reusar; senão, calcular client-side a partir do `payments.records` que `page.tsx` já recebe — é apenas `records.find(r => r.status === 'paid')?.paidAt`. Trivial, sem nova query.

**Action**: Documentar em `data-model.md` (`QuickViewSnapshot.financial.lastPaidAt`).

---

## Resumo de decisões

| ID | Decisão | Bloqueia algo? |
|----|---------|----------------|
| R1 | shadcn Sheet cobre a11y; usar `<SheetTitle>`/`<SheetDescription>` | ✅ Pronto |
| R2 | Tabs com URL via `router.replace` shallow | ✅ Pronto |
| R3 | Adicionar `src/components/ui/tabs.tsx` (shadcn wrapper) como parte desta feature | ✅ Pronto |
| R4 | `resolveAuthors()` batch: doctors + user_profile, retorna `Map<userId, name>` | ✅ Pronto |
| R5 | Sem virtualização para ≤200 eventos | ✅ Pronto |
| R6 | `assembleTimelineEvents` separado de `assembleProntuarioBundle` | ✅ Pronto |
| R7 | Toggle Lista/Gráfico quando filtro = "Sinais vitais" | ✅ Pronto |
| R8 | Cleanup automático de Sheet ao mudar paciente (arquitetura RSC) | ✅ Pronto |
| R9 | Header mobile mostra alerta vermelho se alergia "grave" presente | ✅ Pronto |
| R10 | `QuickViewSnapshot.financial.lastPaidAt` deriva de `payments.records` client-side | ✅ Pronto |

Nenhuma decisão aberta. Phase 1 pode prosseguir.
