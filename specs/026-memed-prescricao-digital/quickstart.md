# Quickstart — Validar em homologação

Pré: Docker + stack local (`pnpm supabase:start`), migrations aplicadas (`pnpm supabase:reset`), `PATIENT_DATA_ENCRYPTION_KEY` no `.env`.

## 1. Conectar a clínica à Memed (homologação)
Como `admin`, em `/configuracoes/integracoes/memed`, conectar com as **credenciais públicas de homologação** da doc:
- API_KEY: `iJGiB4kjDGOLeDFPWMG3no9VnN7Abpqe3w1jEFm6olkhkZD6oSfSmYCm`
- SECRET_KEY: `Xe8M5GvBGCr4FStKfxXKisRo3SfYKI7KrTMkJpCAstzu2yXVN4av5nmL`
- environment: `staging`.

Verifique: `tenant_memed_config` tem 1 linha `connected=true`; nenhuma chave aparece em resposta de API/HTML (DevTools → Network/Source).

## 2. Habilitar um profissional como prescritor
Cadastre/edite um profissional com **CPF, conselho + UF e data de nascimento** preenchidos. Em "Habilitar como prescritor", confirme `memed_prescribers.status='registered'`. Teste o bloqueio: um profissional sem CPF deve retornar erro claro apontando a edição.

## 3. Emitir prescrição em um atendimento
Abra um atendimento com paciente que tenha nome, CPF, e-mail, celular e nascimento. Clique **"Prescrever"**:
- a tela da Memed abre com o paciente já carregado (sem redigitar);
- emita uma prescrição de teste; confirme `prescription_records` com `status='issued'` vinculado ao atendimento e `audit_log` com `prescription.issued`.

## 4. Excluir e auditar
Exclua a prescrição na tela da Memed; confirme `prescription_records.status='deleted'` + `deleted_at` e `audit_log` com `prescription.deleted`. Tente `UPDATE`/`DELETE` direto na tabela ⇒ deve falhar (trigger de imutabilidade).

## 5. Testes automatizados
```bash
pnpm typecheck && pnpm lint:auth
pnpm test:contract   # isolamento multi-tenant, RBAC por endpoint, append-only
pnpm test:integration
```

## Checklist de prontidão para produção (US5)
- [ ] Cadastro de prescritor completo (CPF/conselho+UF/nascimento)
- [ ] `setPaciente` completo
- [ ] Eventos `prescricaoImpressa` e `prescricaoExcluida` tratados
- [ ] Termo de responsabilidade aceito (`terms_accepted_at`)
- [ ] Zero credenciais no frontend (verificado por inspeção)
- [ ] Solicitar credenciais de produção à Memed (parceria)
