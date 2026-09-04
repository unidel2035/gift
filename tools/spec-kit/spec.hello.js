/** Мини-спека: формат одного файла, который отдаётся команде. */
export const meta = { module: 'hello', description: 'пример для команды', tags: [] }
export const specs = [
  {
    name: 'two-plus-two',
    clause: 'HL-001',
    given: 'простая арифметика',
    when: 'складываю 2 и 2',
    then: 'получаю 4',
    falsifier: 'сумма не равна 4',
    async run(ctx) { ctx.assert(2 + 2 === 4, 'математика сломана') },
  },
]
