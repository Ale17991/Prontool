## Resumo

Primeira **superfície voltada ao paciente** do Clinni: um portal **somente leitura**, por clínica (`/paciente/[slug]`), onde o paciente entra com **CPF + data de nascimento (só números)** — sem criar conta — e vê seu **histórico de atendimentos** e a **evolução de métricas** (peso/IMC + metabólicas). As métricas vivem num **motor de medições genérico** (`patient_measurements`) reutilizável por outras especialidades; endocrinologia é a primeira configuração. A equipe registra as métricas metabólicas no prontuário (lado que alimenta o portal).

Feature spec completa em `specs/030-portal-paciente-endocrino/` (spec, plan, research, data-model, contratos, quickstart, tasks). **Sem dependências novas.**

## O que entra

- **Migration 0113** — `patient_measurements` (motor, append-only), `patient_metric_types` (catálogo + seed endócrino), `patient_portal_access_log` (auditoria append-only); ALTER do rate-limit (`+patient_login`); RPC `patient_portal_verify_login` (SECURITY DEFINER).
- **Cápsula `src/lib/core/patient-portal/`** — sessão (cookie HMAC stateless, reusa padrão do oauth/state), login (rate-limit + RPC + auditoria), measurements, read-portal (bundle), audit, metric-types.
- **Portal público `src/app/paciente/[slug]/`** — login (CPF+nascimento) + consentimento LGPD; `/painel` só-leitura com evolução de peso/IMC + gráficos metabólicos + "Meus atendimentos". Componente `evolution-chart` reaproveitável.
- **Rotas** — `/api/paciente/{login,logout,dados}` (identidade derivada **só do cookie**) + `/api/pacientes/[id]/medicoes` (staff: admin/profissional_saude).
- **Seção no prontuário** — `metabolic-metrics-section.tsx` para a equipe registrar glicemia/HbA1c/circunferência/lipídios.
- Middleware exempta `/paciente` do bloco de staff.

## Segurança (auth fraca por escolha do dono — mitigações obrigatórias)

- Anti-força-bruta (rate-limit por IP×slug e CPF×slug, bloqueio 429); sessão curta httpOnly/Secure/SameSite só-leitura; mensagens de login **genéricas** (não revela se CPF existe); auditoria append-only; IP só como **hash**; consentimento LGPD; pacientes anonimizados negados; PII decifrada só no servidor.
- Toda leitura do portal filtra por `patient_id`+`tenant_id` da **sessão verificada** — nunca do cliente.

## Testes

- **32 testes verdes** (7 arquivos): isolamento multi-tenant, login genérico + rate-limit, append-only, RBAC, login→bundle, registro staff, atendimentos.
- `pnpm typecheck` ✅ · `pnpm lint:auth` ✅ (153 handlers autenticam).

## Pós-merge (para operar em produção)

- [x] Migration **0113 aplicada em produção** (`supabase db push`)
- [ ] Setar **`PATIENT_SESSION_SECRET`** nas env vars de produção da Vercel
- [ ] Por clínica: definir **slug público** (`tenant_clinic_profile.public_booking_slug`)
- [ ] Operacional: pacientes com **CPF + nascimento** preenchidos; equipe registrar métricas; divulgar o link

🤖 Generated with [Claude Code](https://claude.com/claude-code)
