# Quickstart — Verificar permissões granulares + autonomia de admin

## Pré-requisitos
- `pnpm supabase:reset` (aplica até `0163`) + `pnpm seed:demo`.
- `pnpm dev`.

## Cenário A — Override concede capacidade (admin da clínica)
1. Em `/configuracoes/usuarios`, abra "Permissões" de um **recepcionista**.
2. Conceda `finance.view_values`. Salve.
3. Logado como esse recepcionista, confirme que passa a ver valores financeiros.
4. Confirme no `audit_log` a entrada da concessão (ator/alvo/antes-depois).

## Cenário B — Override revoga (deny prevalece)
1. Para um **financeiro** (papel tem `appointment.reverse`), revogue `appointment.reverse`.
2. Tente estornar um atendimento como esse usuário → **negado no servidor**.
3. Tente chamar a rota de estorno diretamente (sem UI) → também negado (UI não é a segurança).

## Cenário C — Ação protegida (Princípio V)
1. No diálogo de permissões, tente conceder `price.write` a uma recepcionista.
2. Esperado: a ação é **bloqueada** (não-overridável por padrão) — ou, se o stakeholder decidir liberar, exige a emenda da constituição antes.

## Cenário D — Aviso em ação sensível
1. Conceda uma ação sensível (não-protegida) a um usuário.
2. Esperado: a UI mostra **aviso explícito** antes de confirmar.

## Cenário E — Super-admin gerencia usuários (cross-tenant)
1. No `/admin`, abra uma clínica → Usuários.
2. Crie um usuário admin, troque papel de outro, resete senha.
3. Confirme: usuário criado loga na clínica; reset gera e-mail/link; tudo auditado com o `tenant_id` da clínica; último admin não pode ser desativado.

## Cenário F — Editar dados da clínica pelo /admin
1. No detalhe da clínica, edite nome/CNPJ/contato e salve.
2. CNPJ inválido → rejeitado; válido → atualizado e auditado.

## Cenário G — Impersonação read-only
1. No `/admin`, "Entrar na clínica". Banner de impersonação aparece.
2. Navegue pelas telas (leitura OK). Tente qualquer escrita → **negada** no servidor.
3. Encerrar (ou expirar) → volta ao contexto de plataforma; início/fim auditados.

## Testes (alvo)
- unit `canUser`: grant adiciona; deny remove (vence papel e grant); `[]` = `can`.
- integration: endpoint de escrita respeita override (deny nega via API direta); ação cross-tenant não afeta outro tenant; último admin protegido em todas as frentes.

> ⚠️ Rodar testes apaga o banco local; re-seedar com `pnpm seed:demo`.
