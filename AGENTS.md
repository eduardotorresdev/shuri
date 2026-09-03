# Testes

- Teste unitário: sempre em `<arquivo>.test.ts`, ao lado do arquivo que testa.
- Teste de integração (exercita a colaboração entre várias unidades/pacotes): vai numa pasta
  `test/` o mais próxima possível dos elementos testados, nunca numa pasta central na raiz do
  pacote.

# Validação

- Nossa fonte de validação é schema-based, via `@shuri/validate` (`object`, `array`, `arrayOf`,
  `record`, `refine`, `required`, `oneOf`, `optional`, `all`, ...). Em outros pacotes, sempre que o
  dado tem forma de schema, compomos validators do `@shuri/validate` em vez de validação na mão
  (`if`/`typeof` soltos).
- Se faltar um método/combinator no `@shuri/validate` pra expressar uma validação, cria esse método
  lá (com teste unitário colado) e usa a partir de lá.
