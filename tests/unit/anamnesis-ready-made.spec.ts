/**
 * Modelos de anamnese prontos — o catálogo precisa ser instalável.
 *
 * Um modelo pronto só serve se passar na MESMA validação que a rota de criação
 * aplica: `id` único, todo campo com label, e campo de opções sem lista vazia.
 * Um erro aqui só apareceria no clique de "Instalar", em produção.
 */
import { describe, expect, it } from 'vitest'
import { READY_MADE_TEMPLATES, readyMadeTemplate } from '@/lib/core/anamnesis/ready-made'

const COM_OPCOES = new Set(['radio', 'select', 'checkbox'])

describe('catálogo de modelos prontos', () => {
  it('tem ao menos um modelo e nenhum slug duplicado', () => {
    expect(READY_MADE_TEMPLATES.length).toBeGreaterThan(0)
    const slugs = READY_MADE_TEMPLATES.map((m) => m.slug)
    expect(new Set(slugs).size).toBe(slugs.length)
  })

  it('nenhum título duplicado — título é chave de unicidade no banco', () => {
    const titles = READY_MADE_TEMPLATES.map((m) => m.title)
    expect(new Set(titles).size).toBe(titles.length)
  })

  for (const model of READY_MADE_TEMPLATES) {
    describe(model.title, () => {
      it('tem título, descrição e ao menos um campo', () => {
        expect(model.title.trim().length).toBeGreaterThan(0)
        expect(model.description.trim().length).toBeGreaterThan(0)
        expect(model.fields.length).toBeGreaterThan(0)
      })

      it('ids de campo são únicos', () => {
        const ids = model.fields.map((f) => f.id)
        expect(new Set(ids).size, `ids repetidos em ${model.slug}`).toBe(ids.length)
      })

      it('todo campo tem label não vazio', () => {
        for (const f of model.fields) {
          expect(f.label.trim().length, `campo ${f.id} sem label`).toBeGreaterThan(0)
        }
      })

      it('todo campo de escolha tem ao menos uma opção', () => {
        for (const f of model.fields) {
          if (!COM_OPCOES.has(f.type)) continue
          expect(f.options?.length ?? 0, `campo ${f.id} sem opções`).toBeGreaterThan(0)
        }
      })

      it('campos sem opções não carregam lista de opções órfã', () => {
        for (const f of model.fields) {
          if (COM_OPCOES.has(f.type)) continue
          expect(f.options, `campo ${f.id} não deveria ter opções`).toBeUndefined()
        }
      })

      it('não repete o que o cadastro do paciente já sabe', () => {
        // O motor pré-preenche nome/CPF/contato/endereço via `is_default`.
        // Repetir aqui faria a profissional digitar de novo.
        const proibidos = ['cpf', 'e-mail', 'email', 'telefone', 'celular', 'cep', 'endereço']
        for (const f of model.fields) {
          // Casa PALAVRA INTEIRA: "contraceptivo" contém "cep" como substring e
          // não tem nada a ver com o CEP do cadastro.
          const palavras = f.label.toLowerCase().split(/[^0-9a-zà-ú-]+/)
          for (const p of proibidos) {
            expect(palavras.includes(p), `campo "${f.label}" duplica o cadastro`).toBe(false)
          }
        }
      })

      it('o título de seção não é confundível com pergunta obrigatória', () => {
        for (const f of model.fields) {
          if (!f.label.startsWith('—')) continue
          expect(f.required, `seção ${f.id} não pode ser obrigatória`).toBe(false)
        }
      })
    })
  }

  it('resolve modelo por slug e devolve undefined em slug desconhecido', () => {
    expect(readyMadeTemplate('anamnese-alimentar')?.title).toBe('Anamnese Alimentar')
    expect(readyMadeTemplate('nao-existe')).toBeUndefined()
  })
})
