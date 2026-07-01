# Contract — Catálogo de módulos, pontos de gating e migração

Feature interna (sem API HTTP nova). O "contrato" relevante é o **catálogo de módulos**, os **pontos de gating** e o **comportamento da migração**.

## 1. Catálogo de módulos (`ModuleId`)

```
type ModuleId =
  | 'convenio'        // NOVO (absorve tiss)
  | 'odonto'          // NOVO
  | 'oftalmo'         // NOVO
  | 'portal_paciente'
  | 'telemedicina'
  | 'crm'
  | 'treino'
  | 'dieta'
  | 'endocrino'
// REMOVIDO: 'tiss'
```

- `ALL_MODULES` inclui os três novos; não inclui `tiss`.
- `MODULE_LABEL` (admin): `convenio: 'Convênio'`, `odonto: 'Odontologia'`, `oftalmo: 'Oftalmologia'`.

## 2. Pontos de gating (área → módulo)

| #   | Área                                      | Arquivo                                                 | Predicado (esconder quando)    |
| --- | ----------------------------------------- | ------------------------------------------------------- | ------------------------------ |
| G1  | Sidebar "Faturamento TISS"                | `sidebar-sections.ts`                                   | `!ent.hasModule('convenio')`   |
| G2  | Sidebar "Recebíveis Convênio"             | `sidebar-sections.ts`                                   | `!ent.hasModule('convenio')`   |
| G3  | Card "Convênios" (Config)                 | `_cards.ts`                                             | `!ent.hasModule('convenio')`   |
| G4  | Integração TISS (Config)                  | sub-rota/card TISS                                      | `!ent.hasModule('convenio')`   |
| G5  | Seletor convênio×particular (atendimento) | `new-appointment-form.tsx`, `add-procedure-section.tsx` | `!hasConvenio` ⇒ só particular |
| G6  | Campo convênio no cadastro do paciente    | `cadastro-tab.tsx`                                      | `!hasConvenio`                 |
| G7  | Aba "Odonto-Space" (prontuário)           | `patient-detail-layout.tsx`                             | `!hasOdonto`                   |
| G8  | Seção exames oftalmológicos (prontuário)  | `cadastro-tab.tsx` / `ophthal-exam-section.tsx`         | `!hasOftalmo`                  |
| G9  | Modelos de laudo oftalmo (Config)         | `_cards.ts` / modelos-laudo                             | `!ent.hasModule('oftalmo')`    |

Invariante de contrato: gating **fail-open** — se o entitlement não puder ser lido (erro/ausência), a área aparece (postura defensiva de `getTenantEntitlements`).

Invariante de degradação: acesso por URL a aba/área de módulo off ⇒ fallback para estado padrão válido (G7: aba default), sem erro.

## 3. Migração `0162_specialty_modules.sql` (contrato de comportamento)

Entrada: estado atual de `tenant_entitlements`.
Saída (por tenant):

- `modules` com `tiss` → `convenio` (rename, dedup).
- `convenio` presente se: tinha `tiss` OU `EXISTS appointment_procedures.plan_id` OU `EXISTS tenant_tiss_operator_config` OU `EXISTS tiss_guias`.
- `odonto` presente se: `EXISTS dental_chart_entries` OU `EXISTS perio_exams`.
- `oftalmo` presente se: `EXISTS ophthalmology_exams`.

Garantias:

- Idempotente (reexecução = no-op).
- Não remove módulos além do rename; não toca dados de domínio.
- Não-aplicável/inócua para tenants `legacy`.

## 4. Não-objetivos do contrato

- Sem bloqueio de API/DB por entitlement nesta fase (follow-up de defesa em profundidade).
- Sem mudança em `create_first_tenant` (novos tenants nascem com os três módulos off).
