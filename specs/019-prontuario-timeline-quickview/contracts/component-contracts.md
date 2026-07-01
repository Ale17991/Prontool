# Phase 1 — Component Contracts

**Feature**: 019 — Prontuário Clínico unificado (Timeline + Quick-View)
**Date**: 2026-05-20

> Não há contratos HTTP novos (sem nova rota). Os "contratos" desta feature são as **interfaces de componente React** (props, eventos emitidos, invariantes mantidas). Cada seção abaixo descreve o contrato de um componente novo e o consumidor pode validá-lo via teste unitário/componente.

---

## C1 — `<PatientQuickView />` (sidebar sticky)

**Localização**: `src/app/(dashboard)/operacao/pacientes/[id]/_components/patient-quick-view.tsx`
**Tipo**: Client Component (precisa `'use client'` por causa dos handlers de Sheet)

### Props

```ts
interface PatientQuickViewProps {
  patientId: string
  snapshot: QuickViewSnapshot
  /** Callbacks disparados pelos botões de ação. O pai gerencia o Sheet ativo. */
  onOpenSheet: (sheet: SheetKind) => void
  /** Para o atalho "Editar dados cadastrais" — chama router.replace para ?tab=cadastro. */
  onSwitchToCadastro: () => void
}

type SheetKind =
  | 'new-evolution'
  | 'new-anamnese'
  | 'new-text'
  | 'upload-file'
  | 'new-vital'
  | 'new-allergy'
  | 'new-history'
  | 'new-diagnosis'
```

### Invariantes

- **I-1**: Quando `snapshot.identity.isAnonymized === true`, renderiza **apenas** o card de aviso de anonimização. Nenhum outro bloco é renderizado (FR-026).
- **I-2**: Blocos `allergies`, `diagnoses`, `lastVital`, `financial` são **omitidos** se vazios (FR-006). Bloco `identity` sempre renderiza.
- **I-3**: Botão de ação renderiza **somente se** o `snapshot.permissions[acao] === true` (FR-011, FR-028).
- **I-4**: Bloco `allergies` exibe no máximo 5 chips; se houver mais, mostra "+N mais" clicável que abre Sheet com a lista completa (FR-007).
- **I-5**: Bloco `diagnoses` renderiza apenas status `ativo` e `em_acompanhamento`; `ativo` aparece primeiro; `em_acompanhamento` traz badge sutil distinguindo (FR-008).

### Acessibilidade

- Botões de ação têm `aria-label` descritivo ("Registrar nova evolução SOAP").
- Chips de alergia têm `role="status"` quando severidade é `grave` para ênfase em leitores de tela.

### Testes esperados

- Renderiza todos os blocos com snapshot completo.
- Omite blocos vazios.
- Renderiza apenas aviso quando anonimizado.
- Esconde botões sem permissão.
- "+N mais" aparece com 6+ alergias.

---

## C2 — `<ClinicalTimeline />`

**Localização**: `src/app/(dashboard)/operacao/pacientes/[id]/_components/clinical-timeline.tsx`
**Tipo**: Client Component

### Props

```ts
interface ClinicalTimelineProps {
  patientId: string
  events: TimelineEvent[] // já ordenados desc
  authors: AuthorMap
  isAnonymized: boolean
  /** Para abrir o sheet correspondente quando o usuário clica em "Adicionar ao plano" etc. */
  onOpenSheet: (sheet: SheetKind) => void
  /** Para botões inline em alguns tipos de evento (ex.: "Importar atendimento ao plano"). */
  onImportAppointmentToPlan?: (appointmentId: string) => void
  /** Permissões para gates de ações inline (ex.: deletar anamnese). */
  permissions: QuickViewSnapshot['permissions']
}
```

### Invariantes

- **I-1**: `events` MUST estar pré-ordenado por `occurredAt` desc; o componente não re-ordena (Single Source of Truth).
- **I-2**: Filtro ativo é state local; mudança não dispara fetch.
- **I-3**: Quando filtro atual retorna 0 eventos, exibe mensagem "Nenhum evento neste filtro" + botão "Limpar filtro" (FR-017).
- **I-4**: Quando `isAnonymized === true`, render apenas eventos `kind === 'payment'` ou `kind === 'appointment'` (FR-026).
- **I-5**: Toggle "Lista | Gráfico" aparece **apenas** quando filtro = `'vitais'` (R7).
- **I-6**: Navegação por teclado: `Tab` percorre itens; `Enter`/`Space` expande; `Esc` colapsa todos (FR-031).

### Eventos emitidos

- `onOpenSheet(sheet)`: pai abre o Sheet correspondente.
- `onImportAppointmentToPlan(appointmentId)`: pai chama API atual `/api/.../plan-steps` (mesma do botão atual).

---

## C3 — `<TimelineEventItem />`

**Localização**: `src/app/(dashboard)/operacao/pacientes/[id]/_components/timeline-event-item.tsx`
**Tipo**: Client Component

### Props

```ts
interface TimelineEventItemProps {
  event: TimelineEvent
  expanded: boolean
  onToggleExpanded: () => void
  authorDisplay: string // já resolvido (fallback para ID truncado se ausente)
  /** Ações inline disponíveis para este tipo. */
  actions?: {
    onImportToPlan?: () => void
    onPrint?: () => void
    onDelete?: () => void
  }
  permissions: QuickViewSnapshot['permissions']
}
```

### Invariantes por `kind`

| `kind`        | Conteúdo expandido                                                                      | Ações inline                                            |
| ------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------- |
| `anamnese`    | Reusa `<AnamneseView />` (já existe em `clinical-records-section.tsx`)                  | Imprimir + Deletar (se `permissions.canDeleteAnamnese`) |
| `evolucao`    | Reusa `<SoapView />` (já existe)                                                        | Imprimir                                                |
| `texto`       | Render do `record.content` em `<p>` com whitespace-pre-wrap                             | —                                                       |
| `arquivo`     | Link de download via signed URL + nome + tamanho                                        | —                                                       |
| `vital`       | Tabela compacta de PA/FC/Peso/IMC + nota                                                | —                                                       |
| `appointment` | Procedimento, médico, plano, valor; se órfão (sem `stepId`), botão "Adicionar ao plano" | Import-to-plan se órfão                                 |
| `payment`     | Valor, status, método; data de pagamento                                                | —                                                       |

### Acessibilidade

- Botão de expansão tem `aria-expanded={expanded}` + `aria-controls={contentId}`.
- Ícone tem `aria-hidden="true"` (texto adjacente carrega significado).

---

## C4 — `<CadastroTab />`

**Localização**: `src/app/(dashboard)/operacao/pacientes/[id]/_components/cadastro-tab.tsx`
**Tipo**: Server Component (pode ser RSC porque só compõe outros componentes)

### Props

```ts
interface CadastroTabProps {
  patient: PatientDetail
  treatmentSteps: TreatmentStep[]
  procedures: ProcedureOption[]
  healthPlans: HealthPlanOption[]
  doctors: DoctorOption[]
  remindersOptIn: boolean
  canEditPatient: boolean
  canWriteTreatment: boolean
  canConfigReminders: boolean
}
```

### Composição

Renderiza em ordem vertical (mesma do layout atual):

1. `<AddressEditor />`
2. `<RemindersOptInToggle />`
3. **Bloco "Plano de saúde"** com `<PatientPlanEditor />` em destaque
4. `<TreatmentStepsSection />`

### Invariantes

- **I-1**: Quando paciente está anonimizado, **a aba "Cadastro" não é renderizada** (e o `<Tabs>` não mostra a aba). Consistente com o layout atual.
- **I-2**: Cada componente existente é usado **sem refactor** — esta tab é puro wrapping.

---

## C5 — Sheets (8 componentes irmãos)

**Localização**: `src/app/(dashboard)/operacao/pacientes/[id]/_components/sheets/*.tsx`
**Tipo**: Client Components

Todos os Sheets seguem a mesma estrutura. Documento aqui o contrato comum + variações por sheet.

### Props comuns

```ts
interface BaseSheetProps {
  open: boolean
  onOpenChange: (open: boolean) => void // Radix pattern; chamado por Esc/overlay/X
  patientId: string
  /** Disparado após salvamento bem-sucedido. O pai chama router.refresh() e fecha o sheet. */
  onSuccess: () => void
}
```

### Variações

| Sheet                 | Componente interno reutilizado                                    | Props extras                             |
| --------------------- | ----------------------------------------------------------------- | ---------------------------------------- |
| `<NewEvolutionSheet>` | `<NewEvolutionForm />` (extraído)                                 | —                                        |
| `<NewAnamneseSheet>`  | `<NewAnamneseForm />` (extraído)                                  | `patientPrefill: AnamnesePatientPrefill` |
| `<NewTextSheet>`      | `<NewTextForm />` (extraído)                                      | —                                        |
| `<UploadFileSheet>`   | `<UploadFileForm />` (extraído)                                   | —                                        |
| `<NewVitalSheet>`     | `<NewVitalForm />` (já existe via `<VitalSignsSection>`; extrair) | —                                        |
| `<NewAllergySheet>`   | form interno de `<MedicalHistorySection>` (extrair)               | —                                        |
| `<NewHistorySheet>`   | form interno de `<MedicalHistorySection>` (extrair)               | —                                        |
| `<NewDiagnosisSheet>` | form interno de `<DiagnosticsSection>` (extrair)                  | —                                        |

### Invariantes comuns

- **I-1**: Cada Sheet tem `<SheetTitle>` e `<SheetDescription>` para a11y (R1).
- **I-2**: Após `POST` HTTP 2xx, **chama `onSuccess()`** — o pai faz `router.refresh()` + `onOpenChange(false)` (R4 do clarify).
- **I-3**: Validação de campos e payloads é **idêntica** à dos formulários atuais (Single Source of Truth: extração, não reescrita).
- **I-4**: `Esc`, clique no overlay e botão X chamam `onOpenChange(false)` sem persistir o draft (FR-020).
- **I-5**: O formulário interno **MUST NOT** chamar `router.refresh()` por conta própria — quem refresha é o pai (evita race conditions e double-refresh).

### Acessibilidade

- Focus inicial vai ao primeiro campo do formulário ao abrir.
- Ao fechar, foco retorna ao botão que abriu (Radix automatic).

---

## C6 — `<MobileQuickViewHeader />`

**Localização**: `src/app/(dashboard)/operacao/pacientes/[id]/_components/mobile-quick-view-header.tsx`
**Tipo**: Client Component (state de colapsado)

### Props

```ts
interface MobileQuickViewHeaderProps {
  snapshot: QuickViewSnapshot
  defaultExpanded?: boolean // default: false
}
```

### Invariantes

- **I-1**: Renderiza apenas em viewport <768px (controlado via Tailwind `md:hidden`).
- **I-2**: Quando colapsado, mostra: avatar, nome, idade, **+ ícone vermelho de alerta se `snapshot.allergies.some(a => a.severity === 'grave')`** (R9).
- **I-3**: Quando expandido, mostra todos os blocos da sidebar inline (não cria sheet).

---

## C7 — `<MobileActionBar />`

**Localização**: `src/app/(dashboard)/operacao/pacientes/[id]/_components/mobile-action-bar.tsx`
**Tipo**: Client Component

### Props

```ts
interface MobileActionBarProps {
  permissions: QuickViewSnapshot['permissions']
  onOpenSheet: (sheet: SheetKind) => void
  onPrint: () => void
}
```

### Invariantes

- **I-1**: `position: fixed; bottom: 0` (FAB-like).
- **I-2**: Renderiza apenas em <768px.
- **I-3**: Botões respeitam permissões (mesmas regras de `<PatientQuickView>` C1).
- **I-4**: Em telas com `safe-area-inset-bottom`, adiciona padding (para iPhone com home bar).

---

## C8 — `<TimelineFilters />`

**Localização**: `src/app/(dashboard)/operacao/pacientes/[id]/_components/timeline-filters.tsx`
**Tipo**: Client Component

### Props

```ts
interface TimelineFiltersProps {
  activeFilter: TimelineFilter
  onChange: (filter: TimelineFilter) => void
  counts: Record<TimelineFilter, number> // contagens pré-computadas pelo pai
}

type TimelineFilter =
  | 'todos'
  | 'evolucoes'
  | 'anamneses'
  | 'exames' // arquivos
  | 'vitais'
  | 'atendimentos'
  | 'pagamentos'
```

### Invariantes

- **I-1**: Exatamente um filtro ativo por vez.
- **I-2**: Cada chip exibe contagem (ex.: "Evoluções (12)").
- **I-3**: Chips com contagem 0 ficam **desabilitados** (não escondem — preserva mental model do usuário).
- **I-4**: Estado do filtro **NÃO** vai para URL nesta versão (mantém leve; preferência de iteração futura).

---

## C9 — Refactor de `page.tsx`

`page.tsx` permanece um Server Component (RSC). Acresce:

1. Lê `searchParams.tab` para definir aba inicial.
2. Chama `assembleTimelineEvents()` + `buildQuickViewSnapshot()` + `resolveAuthors()` **em paralelo via Promise.all** com as queries que já existem (não muda o padrão atual de try/catch + safeFail).
3. Renderiza `<PatientDetailLayout>` (novo Client Component que orquestra Sidebar + Tabs + Sheets).
4. Passa todos os dados via props (sem context provider — mantém RSC simples).
5. **Mantém o failures card de admin no topo** (FR-025).

---

## Resumo do "contrato"

| Item                                                  | Garantia                              |
| ----------------------------------------------------- | ------------------------------------- |
| Sem fetch novo (exceto `resolveAuthors`)              | ✅                                    |
| Componentes existentes não reescritos                 | ✅ (apenas extraídos para sheets)     |
| RBAC respeitado em UI + Server                        | ✅                                    |
| LGPD: anonimização preserva renderização restrita     | ✅                                    |
| A11y: trap de foco, Esc, retorno de foco, aria-labels | ✅ via Radix + manual onde necessário |
| Deep-link `?tab=cadastro`                             | ✅                                    |
| Mobile responsivo (<768px)                            | ✅                                    |
| Failures card de admin preservado                     | ✅                                    |

Phase 1 design satisfaz 100% das FRs e os critérios de sucesso da spec.
