# Data Model — 057 Home do portal do paciente

A feature é majoritariamente de apresentação. O banco muda em **dois pontos**,
ambos na migration **`0202_portal_home.sql`** (próximo número livre: as 0198–0201
existem no repositório e ainda não foram aplicadas em produção).

---

## 1. `tenant_clinic_profile` — coluna nova

| Coluna | Tipo | Nulo | Default | Descrição |
| --- | --- | --- | --- | --- |
| `patient_portal_welcome_text` | `TEXT` | sim | `NULL` | Recado de acolhimento exibido na tela inicial do portal **apenas** quando nem metas nem checklist têm o que exibir (FR-017/FR-018). |

**Regras de validação** (camada de aplicação, via Zod):

- Comprimento máximo **1.000 caracteres** (D3 do research).
- String vazia ou só espaços é normalizada para `NULL` — "apagar o texto" e
  "nunca ter escrito" são o mesmo estado, e guardar `''` criaria um terceiro.
- Texto livre, sem HTML: é renderizado como texto, preservando quebras de linha.

**RLS**: nenhuma policy nova. A tabela já é lida pelo service client no portal
(rota pública, sem sessão de staff) e escrita pela tela de configuração sob
`patient_portal.config`.

**Sem migração de dados**: clínicas existentes ficam com `NULL`, que é
exatamente "não escreveu nada".

---

## 2. `patient_portal_access_log` — coluna nova

| Coluna | Tipo | Nulo | Default | Descrição |
| --- | --- | --- | --- | --- |
| `section` | `TEXT` | sim | `NULL` | Qual área do portal foi aberta (FR-007). `NULL` = acesso registrado antes desta feature (FR-007a). |

**Valores esperados**: `home`, `metricas`, `atendimentos`, `orientacoes`,
`exames`, `treino`, `dieta`. **Sem CHECK enumerando** — área nova não deve
exigir migration (D4).

**O CHECK de `action` não muda**: continua
`('login_ok','login_fail','view','habit_mark')`, como a 0189 deixou.

**Append-only preservado**: a tabela é histórica e as linhas antigas **não são
retroalimentadas**. A coluna nasce nula e assim permanece para tudo que já foi
gravado — é o que torna `section IS NULL` um marcador confiável de "antes da
057".

**Escrita**: `logPatientAccess` ganha o campo opcional `section`. Chamadas
existentes que não o informam continuam válidas (login, marcação de hábito).

---

## 3. Entidades de apresentação (sem persistência)

Existem só em memória, montadas a cada render. Nenhuma é gravada.

### Card de área

| Campo | Descrição |
| --- | --- |
| `key` | Chave da seção no catálogo `PORTAL_SECTIONS`. |
| `label` | Nome da seção, vindo do catálogo (nunca escrito na tela). |
| `href` | Endereço da página da área. |
| `hint` | Prévia curta do conteúdo (FR-004). |
| `empty` | Sem conteúdo ⇒ card apagado e sem link (FR-008). |
| `emptyHint` | O que falta e de quem depende. |
| `icon` / `tone` | Ícone e cor do quadradinho. |

**Invariante**: a área promovida (FR-019) não gera card. Grade e promoção
consomem a mesma lista de seções habilitadas.

### Próxima consulta (cabeçalho)

Derivada de `appointments_effective` — a consulta futura mais próxima do
paciente. Só existe quando a área `atendimentos` está habilitada (FR-015).
Formatada no fuso da clínica (FR-016). Ausente ⇒ o cabeçalho não muda de forma.

### Sessão do paciente

Sem mudança de schema — é cookie HMAC stateless. O payload já carrega tudo o
que a decisão precisa:

| Campo | Papel novo nesta feature |
| --- | --- |
| `iatMs` | Passa a ser lido para o teto absoluto de 12h (FR-023). |
| `expMs` | Passa a ser **empurrado** a cada página aberta: 30 min de inatividade (FR-022). |

**Transição de estado**:

```
login → sessão válida
  ├─ página aberta, dentro de 30 min de inatividade e de 12h do login
  │    → expMs = agora + 30 min   (iatMs preservado)
  ├─ 30 min sem abrir página        → expirada
  └─ 12h desde iatMs                → expirada (mesmo em uso)
expirada → volta ao login com aviso genérico (FR-024)
```

`iatMs` **nunca** é reescrito na renovação — reescrevê-lo tornaria o teto
absoluto inalcançável e a sessão eterna.

---

## Isolamento multi-tenant

Nada aqui afrouxa o Princípio III: `tenantId` e `patientId` continuam saindo
**exclusivamente** do cookie verificado, e a coluna nova de configuração é lida
com o `tenant_id` já resolvido pelo slug. `section` não carrega identificador de
paciente nem de clínica além dos que a linha já tinha.
