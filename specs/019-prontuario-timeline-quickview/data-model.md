# Phase 1 — Data Model

**Feature**: 019 — Prontuário Clínico unificado (Timeline + Quick-View)
**Date**: 2026-05-20

> **Importante**: Esta feature **não cria entidades persistidas**. Os tipos abaixo são **tipos virtuais TypeScript**, montados em runtime a partir das tabelas existentes. Não há migration nova, nenhuma coluna acrescentada, nenhuma policy RLS tocada.

---

## 1. `TimelineEvent` (união discriminada)

Representa um item da timeline. Cada variante é polimórfica pelo `kind` e carrega o registro de origem em `source` (preservando tipos atuais, sem mapping com perda).

```ts
// lib/core/patient-timeline/types.ts

export type TimelineEventKind =
  | 'anamnese'
  | 'evolucao' // SOAP
  | 'texto' // texto livre
  | 'arquivo' // upload em clinical_records
  | 'vital'
  | 'appointment' // realizado, cancelado, em-aberto
  | 'payment' // recebimento ou registro financeiro

export interface TimelineEventBase {
  /** ID único do evento (composto se necessário: `${kind}:${rowId}`). */
  id: string
  kind: TimelineEventKind
  /** Timestamp ISO para ordenação. Sempre UTC, como no banco. */
  occurredAt: string
  /** user_id de quem registrou; resolvido para nome via AuthorMap. */
  authorUserId: string
  /** Nome resolvido (preenchido em runtime pelo consumidor com AuthorMap). */
  authorDisplay?: string
}

export interface AnamneseEvent extends TimelineEventBase {
  kind: 'anamnese'
  source: ClinicalRecordRow // type='anamnese', com anamnesisData não-null
}

export interface EvolucaoEvent extends TimelineEventBase {
  kind: 'evolucao'
  source: ClinicalRecordRow // type='evolucao', com soapData não-null
}

export interface TextoEvent extends TimelineEventBase {
  kind: 'texto'
  source: ClinicalRecordRow // type='texto'
}

export interface ArquivoEvent extends TimelineEventBase {
  kind: 'arquivo'
  source: ClinicalRecordRow // type='arquivo'
}

export interface VitalEvent extends TimelineEventBase {
  kind: 'vital'
  source: VitalSignsDTO
}

export interface AppointmentEvent extends TimelineEventBase {
  kind: 'appointment'
  source: AppointmentHistoryRow // já agregada com stepId em page.tsx
}

export interface PaymentEvent extends TimelineEventBase {
  kind: 'payment'
  source: PaymentRecordDTO
}

export type TimelineEvent =
  | AnamneseEvent
  | EvolucaoEvent
  | TextoEvent
  | ArquivoEvent
  | VitalEvent
  | AppointmentEvent
  | PaymentEvent
```

### Regras de montagem

- **`occurredAt`** deriva da fonte:
  - `clinical_records` → `created_at`
  - `vital_signs` → `measured_at`
  - `appointments_effective` → `appointment_at`
  - `payment_record` → `paid_at` (ou `created_at` se ainda não pago)
- **`authorUserId`**:
  - `clinical_records` → `created_by`
  - `vital_signs` → `measured_by`
  - `appointments` → `created_by` (se disponível) senão `doctor.user_id`
  - `payment_record` → `recorded_by`
- **Ordenação**: `occurredAt` desc; em caso de empate (mesmo timestamp ao milissegundo), desempate por `kind` (ordem semântica: `evolucao` > `anamnese` > `vital` > `appointment` > `arquivo` > `texto` > `payment`) para resultado estável.
- **Filtro de paciente anonimizado**: se `patient.anonymizedAt != null`, retorna apenas eventos `kind === 'payment'` e `kind === 'appointment'` (consistente com renderização atual).

---

## 2. `QuickViewSnapshot`

Agregado para a sidebar. Construído em runtime a partir dos arrays já carregados em `page.tsx` (não dispara queries novas além das já feitas).

```ts
// lib/core/patient-timeline/types.ts

export interface QuickViewSnapshot {
  identity: {
    fullName: string | null
    cpf: string | null
    birthDate: string | null
    ageYears: number | null
    isAnonymized: boolean
    ghlContactId: string | null
  }
  contact: {
    phone: string | null
    whatsappUrl: string | null // pré-computado via buildWhatsAppUrl
    email: string | null
  }
  plan: {
    id: string | null
    name: string | null
  }
  /** Lista de alergias ativas (todas, com severidade). Sidebar exibe top 5 + "+N mais". */
  allergies: PatientAllergyDTO[]
  /** Diagnósticos com status 'ativo' OU 'em_acompanhamento'. Ordenação: ativo primeiro. */
  diagnoses: PatientDiagnosisDTO[]
  /** Última medição vital (ou null se nenhuma). */
  lastVital: VitalSignsDTO | null
  financial: {
    receivedCents: number
    pendingCents: number
    lastPaidAt: string | null // ISO, ou null se nunca pago
  }
  /** Permissões de RBAC para decidir quais botões renderizar (computado a partir de session.role). */
  permissions: {
    canCreateEvolution: boolean
    canCreateAnamnesis: boolean
    canCreateVital: boolean
    canCreateAllergy: boolean
    canCreateHistory: boolean
    canCreateDiagnosis: boolean
    canUploadFile: boolean
    canEditPatient: boolean
    canPrint: boolean
  }
}
```

### Regras de montagem

- **`identity.ageYears`** já vem calculado por `calculateAge(birthDate)`.
- **`identity.isAnonymized`** = `patient.anonymizedAt != null`. Quando `true`, **TODOS os outros blocos** retornam vazio/null (a sidebar mostra apenas o card de aviso de anonimização).
- **`contact.whatsappUrl`** = `buildWhatsAppUrl(phone)` (já existe).
- **`allergies`** = recebe o array de `listAllergies` e ordena por `severity` desc (grave → moderada → leve).
- **`diagnoses`** = filtra do array de `listDiagnoses` apenas `status IN ('ativo', 'em_acompanhamento')`; ordena `ativo` primeiro.
- **`lastVital`** = primeiro elemento do array já ordenado por `measured_at` desc.
- **`financial.receivedCents`** = soma de `records.filter(r => r.status === 'paid').amountCents`.
- **`financial.pendingCents`** = soma de `records.filter(r => r.status === 'pending').amountCents`.
- **`financial.lastPaidAt`** = `records.find(r => r.status === 'paid')?.paidAt ?? null` (records já vem ordenado por data desc).
- **`permissions`** = derivado de `session.role` usando `can(role, …)` existente em `lib/auth/rbac`. **Botão renderiza só se permissão true** — server-side continua validando (defesa em profundidade).

---

## 3. `AuthorMap`

Resolução em batch para FR-013/13a.

```ts
// lib/core/patient-timeline/types.ts

export type AuthorMap = ReadonlyMap<string, string>
// chave: user_id (UUID)
// valor: nome resolvido (full_name de doctors, ou display_name de user_profile)

// lib/core/patient-timeline/resolve-authors.ts

export async function resolveAuthors(
  supabase: SupabaseClient<Database>,
  args: {
    tenantId: string
    userIds: ReadonlySet<string>
    /** Optional pre-loaded doctors list (já carregada em page.tsx) — short-circuit dos user_ids cobertos. */
    knownDoctors?: ReadonlyArray<{ user_id: string | null; full_name: string }>
  },
): Promise<AuthorMap>
```

### Regras de montagem

1. Inicializa `result: Map<string, string>` com os `(user_id → full_name)` de `knownDoctors` (filtrando `user_id != null`).
2. `remaining = args.userIds - keys(result)`.
3. Se `remaining.size === 0`: retorna `result`.
4. Faz `SELECT user_id, full_name FROM doctors WHERE tenant_id = $1 AND user_id IN (remaining) AND user_id IS NOT NULL`. Acrescenta ao Map.
5. `remaining = args.userIds - keys(result)`.
6. Se `remaining.size === 0`: retorna `result`.
7. Faz `SELECT user_id, display_name FROM user_profile WHERE tenant_id = $1 AND user_id IN (remaining)`. Acrescenta ao Map.
8. Retorna `result`. Usuários ausentes ficam fora do Map → consumidor faz fallback para `${userId.slice(0, 8)}`.

### Invariantes

- **Tenant isolation**: ambos SELECTs aplicam `eq('tenant_id', tenantId)`. Defesa em profundidade sobre RLS.
- **LGPD**: nomes vêm de tabelas com RLS já adequada (`doctors`, `user_profile`); nenhum dado novo é exposto.
- **Performance**: O(1) consultas SQL no pior caso (1 ou 2), independente do número de eventos.

---

## 4. Diagrama de fontes → TimelineEvent

```
patients (1)
    │
    ├─→ getPatient ──→ identity, contact, plan, allergies, diagnoses, lastVital → QuickViewSnapshot
    │
    ├─→ listClinicalRecords ──→ TimelineEvent { kind: 'anamnese' | 'evolucao' | 'texto' | 'arquivo' }
    │
    ├─→ listVitalSigns ──→ TimelineEvent { kind: 'vital' }
    │
    ├─→ appointments_effective ──→ TimelineEvent { kind: 'appointment' }
    │
    └─→ listPaymentsForPatient ──→ TimelineEvent { kind: 'payment' } + financial summary

doctors + user_profile
    │
    └─→ resolveAuthors ──→ AuthorMap (resolve authorUserId → authorDisplay)
```

Todas as fontes acima já são carregadas pelo `page.tsx` atual; **o trabalho desta feature é apenas mesclar**, não fazer novas queries (exceto `resolveAuthors`, que adiciona 1-2 SELECTs leves).

---

## 5. Estados de transição

Esta feature não introduz novos estados persistidos. Os estados de UI são:

- **Aba ativa**: `'clinico' | 'cadastro'` (via `?tab=` na URL; default `'clinico'`).
- **Filtro de timeline ativo**: `'todos' | 'evolucoes' | 'anamneses' | 'exames' | 'vitais' | 'atendimentos' | 'pagamentos'` (React state local).
- **Sheet aberto**: `null | 'new-evolution' | 'new-anamnese' | 'new-text' | 'upload-file' | 'new-vital' | 'new-allergy' | 'new-history' | 'new-diagnosis'` (React state local).
- **Item expandido na timeline**: `Set<string>` de IDs (React state local).

Nenhum destes é persistido entre sessões. Trocar de paciente reseta tudo (cleanup automático via desmontagem do componente).

---

## 6. Validações

Por ser leitura agregada, não há validação de entrada que esta feature acrescente. Validações de criação (Sheets) reusam as validações dos componentes existentes (ex.: `createEvolutionRecord` exige S e A não-vazios). Não há reescrita.

---

## 7. Tenant Isolation — checklist

| Fonte                             | Filtragem aplicada                                                       |
| --------------------------------- | ------------------------------------------------------------------------ |
| `getPatient`                      | `eq('tenant_id', tenantId)` + RLS                                        |
| `listClinicalRecords`             | RLS sobre `clinical_records.tenant_id`                                   |
| `listVitalSigns`                  | `eq('tenant_id', tenantId)` + RLS                                        |
| `appointments_effective` (view)   | herda RLS de `appointments`                                              |
| `listPaymentsForPatient`          | helper existente já filtra                                               |
| `listAllergies/Diagnoses/History` | RLS sobre `patient_*.tenant_id`                                          |
| `resolveAuthors` (NOVO)           | `eq('tenant_id', tenantId)` em `doctors` e `user_profile` + RLS de ambas |

✅ Nenhum vazamento possível entre tenants. Princípio III preservado.
