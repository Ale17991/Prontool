# Phase 1 — Data Model: Odontograma Interativo

Migration: **`0134_odontogram.sql`** (aditiva, idempotente). Aplicar local com `pnpm supabase:reset` + suíte antes de produção.

## Entidade 1 — `dental_status_catalog` (global da plataforma)

Catálogo de status disponíveis no odontograma. **Sem `tenant_id`** (referência global, padrão `tuss_codes`). Editável só por super-admin.

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | UUID PK | `DEFAULT gen_random_uuid()` |
| `code` | TEXT | **UNIQUE**, slug estável (ex.: `caries`, `restoration`, `missing`, `none`). Imutável após criação. |
| `label` | TEXT | NOT NULL. Rótulo exibido (ex.: "Cárie"). Editável. |
| `color` | TEXT | NOT NULL. Cor hex `#RRGGBB` (CHECK regex). Editável. |
| `icon` | TEXT | NULL. Nome de ícone `lucide-react`. Editável. |
| `scope` | TEXT | NOT NULL. `CHECK (scope IN ('tooth','face','both'))`. |
| `tuss_code_id` | UUID | NULL `REFERENCES public.tuss_codes(id) ON DELETE SET NULL`. Espera-se `tuss_table='22'` (validado na app/seed). |
| `sort_order` | INT | NOT NULL DEFAULT 0. Ordem na paleta. |
| `is_active` | BOOLEAN | NOT NULL DEFAULT TRUE. Desativar oculta de novas marcações (FR-012/FR-013). |
| `is_system` | BOOLEAN | NOT NULL DEFAULT FALSE. TRUE para os semeados que não devem ser excluídos (ex.: `none`). |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() |
| `created_by` | UUID | NULL `REFERENCES auth.users(id)`. NULL para linhas do seed. |
| `updated_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() |
| `updated_by` | UUID | NULL `REFERENCES auth.users(id)`. |

- **RLS**: `ENABLE ROW LEVEL SECURITY`. Policy SELECT para `authenticated` (sem filtro de tenant — global). Escrita **não** liberada a `authenticated` (só service-role). `GRANT SELECT ON dental_status_catalog TO authenticated`.
- **Mutabilidade**: tabela de referência — admin pode `UPDATE` (label, color, icon, scope, tuss_code_id, sort_order, is_active). `code` e `is_system` protegidos (trigger BEFORE UPDATE impede mudança de `code`; impede DELETE de `is_system=TRUE`).
- **Auditoria**: via `created_by`/`updated_by`/timestamps (decisão D2). Não escreve em `audit_log` (entidade global, sem tenant).
- **Índice**: `(is_active, sort_order)` para a paleta.

### Seed padrão (idempotente, `ON CONFLICT (code) DO NOTHING`)

| code | label | scope | cor sugerida | is_system |
|---|---|---|---|---|
| `none` | Sem registro | both | neutro (cinza claro) | TRUE |
| `caries` | Cárie | face | vermelho | FALSE |
| `restoration` | Restauração | face | azul | FALSE |
| `sealant` | Selante | face | verde | FALSE |
| `fracture` | Fratura | face | laranja | FALSE |
| `missing` | Ausente | tooth | cinza escuro | FALSE |
| `implant` | Implante | tooth | roxo | FALSE |
| `crown` | Coroa | tooth | dourado/amarelo | FALSE |
| `extraction_indicated` | Extração indicada | tooth | vermelho escuro | FALSE |
| `root_canal` | Tratamento de canal | tooth | ciano | FALSE |

> Cores finais a alinhar com o design system (paleta 016); as acima são placeholders semânticos.

## Entidade 2 — `dental_chart_entries` (per-tenant, append-only)

Cada marcação aplicada a uma posição (dente ou face). Imutável; correção = novo registro.

| Coluna | Tipo | Regras |
|---|---|---|
| `id` | UUID PK | `DEFAULT gen_random_uuid()` |
| `tenant_id` | UUID | NOT NULL `REFERENCES public.tenants(id) ON DELETE CASCADE` |
| `patient_id` | UUID | NOT NULL `REFERENCES public.patients(id) ON DELETE CASCADE` |
| `appointment_id` | UUID | NULL `REFERENCES public.appointments(id) ON DELETE SET NULL` (FR-018) |
| `tooth_fdi` | SMALLINT | NOT NULL. CHECK no conjunto FDI válido (permanentes 11–48, decíduos 51–85). |
| `surface` | TEXT | NULL. `CHECK (surface IN ('mesial','distal','occlusal_incisal','vestibular','lingual_palatal'))`. NULL ⇔ marcação de escopo dente. |
| `status_id` | UUID | NOT NULL `REFERENCES public.dental_status_catalog(id) ON DELETE RESTRICT` |
| `note` | TEXT | NULL. `CHECK (note IS NULL OR length(note) <= 2000)` (FR-017a). |
| `recorded_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() (UTC) |
| `created_by` | UUID | NOT NULL `REFERENCES auth.users(id) ON DELETE RESTRICT` |
| `created_at` | TIMESTAMPTZ | NOT NULL DEFAULT now() |

- **Coerência escopo↔surface**: trigger/CHECK garante que `surface IS NULL` quando o status é `scope='tooth'` e `surface IS NOT NULL` quando `scope='face'`; `scope='both'` (status `none`) aceita ambos. (Validação também na app por UX, mas o banco é a fonte de verdade.)
- **RLS**: `ENABLE ROW LEVEL SECURITY`.
  - SELECT: `tenant_id = public.jwt_tenant_id()`.
  - INSERT: `tenant_id = public.jwt_tenant_id() AND public.jwt_role() IN ('admin','profissional_saude')` (FR-021). (Escrita real passa por service-role na rota, mas a policy reforça defesa em camadas.)
  - `GRANT SELECT, INSERT ON dental_chart_entries TO authenticated`.
- **Append-only**: `BEFORE UPDATE OR DELETE` → `enforce_append_only_columns('')` (FR-016).
- **Consistência de tenant** (padrão `appointment_materials`): `BEFORE INSERT` valida que `patient_id` e `appointment_id` (quando presente) pertencem ao `tenant_id` da linha.
- **Auditoria**: `AFTER INSERT` → `log_audit_event(tenant_id, 'dental_chart_entries', id, 'created', NULL, json{...}, 'feature 039 — marcação odontográfica')` (FR-019, Princípio II).
- **Índices**:
  - `(tenant_id, patient_id, tooth_fdi, surface, recorded_at DESC)` — base do "estado atual" e do histórico por posição.
  - `(tenant_id, appointment_id)` — marcações de um atendimento.

## RPC — `dental_chart_current(p_tenant_id UUID, p_patient_id UUID)`

`SECURITY DEFINER`, `SET search_path = public`. Retorna o registro mais recente por posição:

```sql
SELECT DISTINCT ON (tooth_fdi, surface)
       id, tooth_fdi, surface, status_id, note, recorded_at, appointment_id, created_by
  FROM public.dental_chart_entries
 WHERE tenant_id = p_tenant_id AND patient_id = p_patient_id
 ORDER BY tooth_fdi, surface, recorded_at DESC;
```

- **Guarda de tenant**: a rota só chama com o `tenant_id` da sessão; adicionalmente a função pode validar `p_tenant_id = public.jwt_tenant_id()` quando chamada por `authenticated` (igual padrão `patient_portal_*`). `GRANT EXECUTE TO authenticated`.
- Retorna **uma** linha por `(tooth_fdi, surface)`; o cliente projeta sobre a carta dentária. Status `none` é tratado como "sem registro" na renderização.

## Modelo de posição (domínio, não tabela) — `src/lib/core/dental/teeth.ts`

- `PERMANENT_TEETH: number[]` e `DECIDUOUS_TEETH: number[]` (conjuntos FDI).
- `SURFACES = ['mesial','distal','occlusal_incisal','vestibular','lingual_palatal'] as const`.
- `dentitionOf(toothFdi)` → `'permanent' | 'deciduous'` (deriva do quadrante).
- `isAnterior(toothFdi)` → rotula `occlusal_incisal` como "Incisal" (anteriores) vs "Oclusal" (posteriores).
- `assertValidTooth(toothFdi)` / `assertValidSurface(surface)` — usados pela validação Zod das rotas.

## Relações

```
dental_status_catalog (global) 1 ──< dental_chart_entries >── 1 patients
                                          │
                                          └──? appointments (opcional)
dental_status_catalog ?──> tuss_codes (tabela 22, opcional)
```

## Conformidade constitucional

- **III (multi-tenant)**: `dental_chart_entries.tenant_id` + RLS + triggers de consistência + RPC com guarda de tenant. Catálogo global intencional (padrão `tuss_codes`).
- **I/II (append-only + auditoria)**: trigger append-only + `log_audit_event` por INSERT.
- **IV (TUSS)**: FK opcional a `tuss_codes` (tabela 22).
- **V (RBAC)**: policies + `requireRole`/`requireSuperAdmin` nas rotas.
