# Quickstart — 057 Home do portal do paciente

Como levantar, exercitar e conferir a feature.

## Pré-requisitos

```bash
supabase start          # stack local :54321 (Docker precisa estar rodando)
pnpm supabase:reset     # aplica todas as migrations, incluindo a 0202
pnpm seed:demo          # dados de apresentação
pnpm dev
```

> **Docker parado?** Só dá para validar estaticamente:
> `npx tsc --noEmit -p tsconfig.json`, `npx next lint`,
> `node scripts/check-require-role.mjs`.

> **Nunca rode `pnpm test` / `vitest` durante teste manual**: o setup chama
> `resetDatabase()` e apaga todos os dados e usuários do Supabase local.
> Re-semear depois com `pnpm seed:demo`.

## Ligando o portal para uma clínica

1. Entre como admin e vá a `/configuracoes/portal-paciente`.
2. Ligue o portal e confirme o endereço público (`slug`).
3. Em **Seções**, ligue o que quer expor. Lembre que exames, treino, dieta e
   hábitos exigem o módulo correspondente no plano da clínica (`/admin`).
4. Opcional: escreva o **texto de boas-vindas** (só aparece quando o paciente
   não tem metas nem checklist).

## Entrando como paciente

`/paciente/<slug>` — CPF e data de nascimento (DDMMAAAA) de um paciente da
clínica, com consentimento marcado.

## Roteiro de verificação

### Tela inicial (US1)

- [ ] Aparecem **apenas** metas, checklist e a grade de cards. Nenhum gráfico,
      plano ou histórico aberto.
- [ ] Com consulta futura marcada, o cabeçalho traz "Sua próxima consulta:
      DD/MM às HHh".
- [ ] Sem consulta futura, o cabeçalho **não** menciona a ausência.
- [ ] Desligue a área de atendimentos: a linha do cabeçalho some.
- [ ] Os cards seguem a ordem do catálogo, não a ordem em que foram ligados.

### Navegação (US2)

- [ ] Cada card abre a página da sua área, com o caminho de volta funcionando.
- [ ] Desligue uma seção e abra o endereço dela à mão
      (ex.: `/paciente/<slug>/painel/exames`): volta para a tela inicial sem
      mostrar conteúdo.
- [ ] Peça `/painel/dieta` numa clínica **sem o módulo `dieta`**: mesmo
      comportamento.
- [ ] Cookie de sessão de outra clínica não abre este portal.

### Áreas vazias (US3)

- [ ] Ligue treino sem cadastrar plano: card apagado, sem link, com a
      explicação de quem precisa cadastrar.
- [ ] Abra a página da área vazia pelo endereço: explica a ausência, não fica
      em branco.

### Promoção da tela inicial (FR-017–021)

- [ ] Desligue metas e hábitos numa clínica com texto de boas-vindas: a tela
      inicial mostra o texto **e**, abaixo, a primeira área com conteúdo aberta.
- [ ] A área promovida **não** aparece também como card.
- [ ] Sem texto cadastrado: só a área promovida.
- [ ] Sem texto e sem nenhuma área com conteúdo: mensagem de "ainda não há
      informações".
- [ ] Cadastre uma meta: a tela inicial volta ao normal e a área promovida
      retorna à grade de cards.

### Sessão (FR-022–024)

- [ ] Navegue entre áreas por mais de 30 minutos sem parar: **não** cai.
- [ ] Fique 30 minutos parado e abra uma página: volta ao login com aviso.
- [ ] Faça logout e confirme que a sessão não "revive" ao abrir uma página do
      portal (regressão do middleware).

### Trilha de acesso

```sql
select action, section, created_at
from patient_portal_access_log
where patient_id = '<uuid>'
order by created_at desc
limit 20;
```

- [ ] Cada página aberta gera uma linha com a `section` correspondente
      (`home`, `evolucao`… ) e `action='view'`.
- [ ] Linhas anteriores à feature continuam com `section` nulo — **não** foram
      retroalimentadas.

### Não-regressão da 050

- [ ] Com a área de exames ligada e resultados classificados, os mesmos
      analitos **não** aparecem também em "Minha evolução".

## Migration em produção

`0202_portal_home.sql` é aplicada **à mão**, colando no SQL Editor do Supabase,
e **antes** do deploy do código. Atenção: as `0198`–`0201` ainda estão
pendentes; aplique-as na ordem antes desta.
