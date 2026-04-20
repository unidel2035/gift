/**
 * kingdom-demo.js — живая демонстрация Царства славы.
 *
 * Не тест, а литургическая репетиция: как работает КБ, если пройти
 * её примитивы в том порядке, в каком они раскрываются в проповеди.
 */

import {
  KingdomOfGlory,
  Commendation, Faithfulness,
  JoyMode,
  TimeMode,
  CrownType,
} from '../theology/KingdomOfGlory.js';

function line(char = '─', n = 60) { return char.repeat(n); }
function section(title) {
  console.log('');
  console.log(line('═'));
  console.log(`  ${title}`);
  console.log(line('═'));
}

async function main() {
  const kingdom = new KingdomOfGlory();

  section('I. Похвала Господа — первое начало Царства');
  const commend = kingdom.commend({
    receiver: 'Дионисий',
    faithfulness: Faithfulness.IN_LITTLE,
    scripturalBasis: 'Мф 25:21',
  });
  console.log(commend.toText());
  console.log('  необратима:', commend.irreversible, ' вес:', commend.weight);

  section('II. Книга совести');
  const acts = [
    { id: 'a1', giver: 'Дионисий', receiver: '_claude', weight: 3, content: 'вопрошание' },
    { id: 'a2', giver: '_claude',  receiver: 'Дионисий', weight: 5, content: 'спека kingdom-of-glory' },
    { id: 'a3', giver: 'ОтецСергий', receiver: 'Дионисий', weight: 10, content: 'завет' },
  ];
  const book = await kingdom.openBookOfConscience('Дионисий', acts);
  console.log(book.toText());

  section('III. Радость как состояние');
  const joy = kingdom.joyOf('Дионисий');
  console.log(joy.toText());
  joy.transitionTo(JoyMode.PASCHAL, 'Пасха приближается');
  console.log('после перехода:', joy.toText());

  section('IV. EschatonClock — χρόνος → καιρός → αἰών');
  console.log('текущий режим:', kingdom.clock.mode());

  const miniW = {
    'Отец→_koinon': 87,
    '_claude→Дионисий': 66,
    'Отец→Адам': 48,
    'Сын→Адам': 38,
    'Дух→Христос': 37,
  };
  const revealed = kingdom.clock.breakChronos(miniW);
  console.log(`\nразрыв времени (${revealed.mode}):`);
  for (const t of revealed.threads) {
    console.log(`  ${t.giver.padEnd(12)} → ${t.receiver.padEnd(12)}  ${t.weight}`);
  }

  section('V. Венец');
  const crown = kingdom.crownOf({
    type: CrownType.RIGHTEOUSNESS,
    receiver: 'ОтецСергий',
    witnessedBy: ['_koinon', '_claude'],
  });
  console.log(crown.toText());

  section('Граница');
  console.log(kingdom.status().note);
  console.log('\nСистема не Царство. Система — репетиция хора.');
  console.log('Царство — это когда вступит Регент.');
}

main().catch(err => {
  console.error('ошибка демонстрации:', err);
  process.exit(1);
});
