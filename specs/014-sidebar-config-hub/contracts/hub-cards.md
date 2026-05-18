# Contract — Hub Cards

**Feature**: Sidebar enxuta + Configurações como hub
**Branch**: `014-sidebar-config-hub`

Define o contrato dos cards exibidos em `/configuracoes`. Combina FR-008 a FR-012 com a tabela de `data-model.md`.

---

## Ordem fixa (FR-009)

A ordem dos cards é **fixa no array `HUB_CARDS`** e renderizada na mesma ordem em que aparece na constante. Auditoria SEMPRE é o último card exibido (FR-009 / INV-2).

```
1. Clínica
2. Meu Perfil
3. Usuários
4. Procedimentos
5. Convênios
6. Profissionais
7. Modelos de Anamnese
8. Integrações
9. Auditoria
```

---

## Layout do card

Cada card deve conter, da esquerda para a direita / topo para base:

- **Ícone** (lucide-react, 24–28 px, com `aria-hidden="true"`).
- **Título** (`<h2>` ou similar; texto curto da tabela abaixo).
- **Descrição** (`<p>`, uma linha, ≤ 80 caracteres; truncamento ou wrap a critério do CSS).
- **Estado focus/hover** visível (ring + sutil background change) — acessibilidade por teclado.
- Card inteiro envolvido por `<Link href={card.href}>` (área de clique grande).

Não é necessário: badges, contadores, indicadores de novidade — todos fora de escopo.

---

## Tabela canônica (espelha `data-model.md`)

| # | id | Título | Descrição (1 linha) | Ícone (lucide) | Destino | Visibilidade |
|---|-----|--------|---------------------|----------------|---------|--------------|
| 1 | clinica | Clínica | Dados, logo e identidade visual da clínica | Building2 | /configuracoes/clinica | admin |
| 2 | perfil | Meu Perfil | Seus dados pessoais, avatar e preferências | UserCircle | /configuracoes/perfil | qualquer autenticado |
| 3 | usuarios | Usuários | Convide e gerencie quem tem acesso à clínica | Users | /configuracoes/usuarios | admin |
| 4 | procedimentos | Procedimentos | Catálogo de procedimentos e códigos TUSS | ListChecks | /configuracoes/procedimentos | `can('procedure.read')` |
| 5 | convenios | Convênios | Convênios atendidos e tabelas de preço | DollarSign | /configuracoes/convenios | `can('plan.read')` |
| 6 | profissionais | Profissionais | Profissionais de saúde e comissões | UserCheck | /configuracoes/profissionais | `can('doctor.read')` |
| 7 | modelos-anamnese | Modelos de Anamnese | Modelos clínicos reutilizáveis nos atendimentos | ClipboardCheck | /configuracoes/modelos-anamnese | admin + flag `anamnese` |
| 8 | integracoes | Integrações | Conexões com WhatsApp, GHL e outros sistemas | Plug | /configuracoes/integracoes | admin |
| 9 | auditoria | Auditoria | Trilha completa de alterações e acessos sensíveis | ScrollText | /configuracoes/auditoria | `can('audit.read')` |

> Os ícones acima são sugestões alinhadas ao que já é usado em `dashboard-shell.tsx` para os mesmos destinos. Implementador pode trocar contanto que continue sendo um ícone lucide-react e a substituição se justifique visualmente.

---

## Predicados (espelhar exatamente a sidebar atual)

Para evitar drift entre "antes" e "depois", os predicados de cada card replicam **exatamente** os predicados que estão em `dashboard-shell.tsx` hoje:

| Card | Predicado (TypeScript) |
|------|------------------------|
| clinica | `({ role }) => role === 'admin'` |
| perfil | `() => true` |
| usuarios | `({ role }) => role === 'admin'` |
| procedimentos | `({ role }) => can(role, 'procedure.read')` |
| convenios | `({ role }) => can(role, 'plan.read')` |
| profissionais | `({ role }) => can(role, 'doctor.read')` |
| modelos-anamnese | `({ role, flags }) => flags.anamnese && role === 'admin'` |
| integracoes | `({ role }) => role === 'admin'` |
| auditoria | `({ role }) => can(role, 'audit.read')` |

---

## Matriz role × visibilidade (esperada)

Para a matriz de tests (R7), o conjunto esperado de cards visíveis por role (com todas as flags `true`):

| Role | Cards visíveis (em ordem) |
|------|----------------------------|
| admin | clinica, perfil, usuarios, procedimentos, convenios, profissionais, modelos-anamnese, integracoes, auditoria |
| financeiro | perfil + (procedimentos/convenios/profissionais conforme `can()`) + (auditoria se `can('audit.read')`) |
| recepcionista | perfil + (procedimentos/convenios/profissionais conforme `can()`) |
| profissional_saude | perfil + (procedimentos/convenios/profissionais conforme `can()`) |

> O conjunto exato para roles não-admin é determinado pela tabela `can()` em `src/lib/auth/rbac.ts`. O teste vai consultar `can()` em vez de hard-coding os valores, para sobreviver a mudanças futuras no RBAC.

---

## Invariantes (testáveis)

Espelham as invariantes em `data-model.md`:

- **INV-1**: `HUB_CARDS.length === 9`.
- **INV-2**: `HUB_CARDS[8].id === 'auditoria'`.
- **INV-3**: Admin com todas flags `true` vê os 9 cards.
- **INV-4**: Qualquer role autenticado vê **pelo menos** o card `perfil` (nenhum hub vazio).
- **INV-5**: `card.id` é único.
- **INV-6**: Cada `card.href` resolve para uma rota existente no app (`/configuracoes/{id}` para id ≠ 'modelos-anamnese' que mantém o slug; auditoria aponta para nova rota).

---

## Status

Contract finalizado.
