# Quickstart — Configurações da Clínica, Perfil, Equipe e Navegação

**Feature**: 009-configuracoes-clinica-equipe
**Audience**: dev validando localmente que a feature está funcionando ponta a ponta.
**Prerequisites**: Docker rodando + `pnpm` + Supabase CLI + ambiente `.env.local` configurado.

---

## 1. Subir o stack local

```bash
supabase start                      # sobe Postgres :54321 + Auth + Storage
pnpm install
pnpm supabase:reset                 # aplica todas as migrations, incluindo 0064
pnpm dev                            # Next.js em http://localhost:3000
```

Confirme que a migration `0064_clinic_profile_and_team_management.sql` apareceu no log do reset.

---

## 2. Story 1 — Perfil da clínica + logo nos PDFs (P1)

1. Login como **admin**.
2. Navegue na sidebar para **Configurações → Clínica**. A página deve abrir sem barra de abas horizontais.
3. Faça upload de uma logo (`tests/fixtures/logo.png`, < 2 MB). Pré-visualização aparece. Confirme.
4. Preencha:
   - Nome: `Clínica Demo`
   - CNPJ: `04.252.011/0001-10` (válido)
   - Telefone: `(11) 9 0000-0000`
   - E-mail: `contato@demo.test`
   - CEP: `01310100` → ao digitar 8 dígitos, o sistema consulta ViaCEP e preenche `Avenida Paulista`, `Bela Vista`, `São Paulo`, `SP`.
   - Número: `100`
   - Responsável técnico: `Dra. Demo`, conselho `CRM`, registro `123456-SP`
5. **Salvar**. Esperado:
   - Toast de sucesso.
   - Logo aparece imediatamente no topo da sidebar (sem F5).
6. Vá para **Operação → Pacientes**, abra um paciente e gere o **Prontuário PDF**. Confirme:
   - Cabeçalho traz a logo + razão social + CNPJ + endereço resumido + responsável técnico.
7. Repita o passo 6 para Anamnese (PDF), Relatório financeiro mensal e comprovante de despesa — todos devem trazer o mesmo cabeçalho.

**Falha esperada**: tente subir um arquivo `.exe` renomeado para `.png` → rejeição com `400 invalid_image_format`.

---

## 3. Story 2 — Sidebar reorganizada e fim das abas (P2)

1. Confirme que a sidebar mostra três grupos:
   - **Operação**: Agenda, Pacientes, Alertas, Pendências.
   - **Análise**: Relatórios, Comissões, Despesas, Auditoria.
   - **Configurações**: Clínica, Meu Perfil, Usuários, Procedimentos, Convênios, Profissionais, Modelos de Anamnese, Integrações.
2. Navegue para **Configurações → Procedimentos**. A página deve carregar **sem** barra de abas no topo.
3. Cole a URL antiga `http://localhost:3000/cadastros/procedimentos` no browser → você deve ser redirecionado para `/configuracoes/procedimentos` (DevTools → Network → ver status `301`).
4. Repita para `/cadastros/planos` (→ `/configuracoes/convenios`), `/cadastros/profissionais`, `/cadastros/anamnese` (→ `/configuracoes/modelos-anamnese`) e `/cadastros/despesas` (→ `/analise/despesas`).
5. Como **recepcionista**, abra a sidebar: o grupo Configurações deve aparecer com **apenas** Meu Perfil (sem Clínica, sem Usuários, sem Procedimentos, etc.).

---

## 4. Story 3 — Perfil pessoal (P3)

1. Login como qualquer usuário. Navegue para **Configurações → Meu Perfil**.
2. Preencha nome completo `Fulano de Tal` e troque o fuso para `America/Manaus`.
3. Faça upload de avatar PNG.
4. **Salvar**. Esperado: avatar aparece ao lado do e-mail na sidebar; ao abrir um paciente alterado por você, o `Alterado por` mostra o avatar.
5. Abra a aba **Trocar senha**. Tente:
   - Senha atual errada → `400 invalid_current_password`.
   - Nova senha `123` → `400 weak_password` (`reason: too_short`).
   - Nova senha válida (`abc12345`) com confirmação igual → 204 e toast de sucesso.
6. Faça logout e login novamente com a nova senha.
7. Confirme em `/analise/auditoria` que a entrada `entity=user_profile, field=password` aparece com timestamp.

---

## 5. Story 4 — Gestão da equipe (P4)

Pré-requisito: ter ao menos uma admin além de você no tenant (use o seed de teste ou o helper `tests/helpers/seed-admin.ts`).

1. Login como admin. Navegue para **Configurações → Usuários**.
2. Veja a lista com colunas Nome / E-mail / Função / Status / Último acesso.
3. Clique **Convidar**. Informe `convidada@test.local` e função `recepcionista`. Confirme.
4. Esperado:
   - Status da nova linha: `Convite pendente`.
   - O e-mail enviado pelo Supabase local é capturado em `inbucket` (`http://localhost:54324`).
5. Abra o link do e-mail, defina senha. Volte à lista — status agora é `Ativo` e `Último acesso` está preenchido.
6. Mude a função da convidada para `financeiro` → toast de sucesso, audit gravado.
7. Tente desativar a si mesma → `409 cannot_disable_self`.
8. Tente rebaixar a si mesma sendo a única admin → bloqueado pelo trigger DB (`409 last_admin`).
9. Desative a convidada → status `Desativado`. O usuário desativado, na próxima requisição, é redirecionado para `/login`.
10. Reative-a → status volta para `Ativo` sem novo e-mail enviado.

---

## 6. Cross-cutting validations

- **RLS cross-tenant**: numa segunda janela, faça login num tenant diferente. As páginas Clínica / Usuários só mostram dados do próprio tenant; nenhuma logo do outro tenant é acessível por URL direta.
- **Auditoria**: cada ação acima deixa uma linha em `audit_log`. `/analise/auditoria` mostra autor + ação + timestamp.
- **Performance**: medir `Time to Interactive` da página `/configuracoes/clinica` < 800 ms p95 em `pnpm build && pnpm start`.

---

## 7. Comandos úteis

```bash
pnpm test                                # vitest full suite
pnpm test tests/contract/api-configuracoes-clinica.test.ts
pnpm test tests/integration/team-invite-flow.test.ts
pnpm test tests/integration/last-admin-trigger.test.ts
pnpm test tests/integration/cadastros-redirects-301.test.ts
pnpm typecheck
pnpm lint:auth                            # confirma requireRole nos novos endpoints
```

---

## 8. Rollback (dev)

```bash
pnpm supabase:reset                       # recria do zero
```

Não há plano de rollback parcial — a migration 0064 é aditiva e idempotente.
