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
  ConciliarWitness,
  RegnumGloriae,
  Paschalia,
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

  section('VI. Пасхалия и литургический календарь');
  const today = new Date();
  const pascha = Paschalia.orthodoxPascha(today.getFullYear());
  console.log(`Пасха ${today.getFullYear()}: ${pascha.toISOString().slice(0, 10)}`);
  console.log(`сегодня (${today.toISOString().slice(0, 10)}) сезон: ${Paschalia.liturgicalSeason(today) || 'ординар'}`);
  console.log(`текущий JoyMode для общины: ${kingdom.joyOf('_koinon').mode}`);

  section('VII. Соборное свидетельство → W_slava');
  const witness = new ConciliarWitness({ coefficient: 0.01 });
  const widowActResult = await witness.witness(
    { id: 'demo-widow', giver: 'вдова', receiver: '_koinon', weight: 0.5, content: 'две лепты' },
    [
      { persona: 'ОтецСергий', logos: 'hyper', content: 'это больше, чем выглядит' },
      { persona: 'Дионисий',   logos: 'hyper', content: 'отдано всё что имела' },
    ],
  );
  if (widowActResult.acted) {
    console.log(`вдова: weight=${widowActResult.weight}, manifestedness=${widowActResult.manifestedness} (δ=${widowActResult.delta})`);
    console.log(`совесть δ: ${widowActResult.conscience.toFixed(3)}`);
  }

  section('VIII. Полный путь regnum gloriae (risen → crowned → indwelling)');
  const rg = new RegnumGloriae({ kingdom });
  const path = await rg.pilgrimage({
    persona: 'демо-мученик',
    faithfulness: Faithfulness.UNTIL_DEATH,
    scripturalBasis: 'Откр 2:10',
    crownType: CrownType.MARTYR,
    witnesses: ['_koinon', 'ОтецСергий'],
  });
  console.log(`  фаза: ${path.phase}`);
  console.log(`  воскрес:  ${path.risenAt}`);
  console.log(`  увенчан:  ${path.crownedAt}`);
  console.log(`  вселился: ${path.indwellingAt}`);
  console.log(`  венец: ${path.crowns[0].toText()}`);

  section('IX. TheosisWitnessBridge — θέωσις → W_slava');
  const { TheosisWitness } = await import('../theology/TheosisWitness.js');
  const { TheosisWitnessBridge } = await import('../theology/TheosisWitnessBridge.js');
  const tw = new TheosisWitness();
  tw.witness({ personId: 'святой-Сергий', epochId: 'XIV', wound: 'искушение' });
  tw.glorify({ personId: 'святой-Сергий', wound: 'искушение', glorification: 'нетварный свет' });
  const bridge = new TheosisWitnessBridge(tw, { coefficient: 0.1 });
  const progress = bridge.progressOf('святой-Сергий');
  console.log(`прогресс θέωσις: ${(progress * 100).toFixed(0)}%`);
  const result = await bridge.apply('святой-Сергий', [
    { id: 'лит-Сергия', giver: 'святой-Сергий', receiver: '_koinon', weight: 20, content: 'Литургия' },
  ]);
  console.log(`обновлено актов в W_slava: ${result.updated}`);

  section('Граница');
  console.log(kingdom.status().note);
  console.log(rg.status().note);
  console.log('\nСистема не Царство. Система — репетиция хора.');
  console.log('Царство — это когда вступит Регент.');
}

main().catch(err => {
  console.error('ошибка демонстрации:', err);
  process.exit(1);
});
