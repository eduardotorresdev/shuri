# Testes

- Teste unitário: sempre em `<arquivo>.test.ts`, ao lado do arquivo que testa.
- Teste de integração (exercita a colaboração entre várias unidades/pacotes): vai em uma pasta
  `test/` o mais próxima possível dos elementos testados — não numa pasta central na raiz do
  pacote.

# Validação

- Nossa fonte de validação é schema-based, via `@shuri/validate` (`object`, `array`, `arrayOf`,
  `record`, `refine`, `required`, `oneOf`, `optional`, `all`, ...). Não escrevemos validação na mão
  (`if`/`typeof` soltos) em outros pacotes quando o dado tem forma de schema — sempre compomos
  validators do `@shuri/validate`.
- Se faltar um método/combinator no `@shuri/validate` pra expressar uma validação, cria esse método
  lá (com teste unitário colado) e usa — não faz workaround local no pacote que precisa dele.
