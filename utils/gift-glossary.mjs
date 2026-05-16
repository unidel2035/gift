#!/usr/bin/env node
/**
 * gift-glossary.mjs — словарь терминов онтологии: греческое → русское.
 *
 * Минимально-достаточный словарь для понимания CLI и spec'ов.
 * Без претензии на богословскую полноту. Цель — снять языковой барьер,
 * не построить классическую кафедру.
 *
 * Формат: одна строка на термин, греческое имя слева, краткое
 * русское пояснение справа, при необходимости — где встретить в коде.
 */

const C = {
  bold: s => `\x1b[1m${s}\x1b[0m`,
  dim:  s => `\x1b[2m${s}\x1b[0m`,
  cyan: s => `\x1b[36m${s}\x1b[0m`,
  gold: s => `\x1b[33m${s}\x1b[0m`,
};

const GLOSSARY = [
  // ── Дар и принятие ─────────────────────────────────────────────────
  { gr: 'δόσις',         lat: 'dosis',        ru: 'даяние, сам акт дарения (необратим)',
    where: 'GiftAct, irreversible:true' },
  { gr: 'λῆψις',         lat: 'lepsis',       ru: 'принятие (может быть accepted/declined/pending)',
    where: 'reception в актах W' },
  { gr: 'μετάνοια',      lat: 'metanoia',     ru: 'покаяние, обращение — принять то, что было отвергнуто',
    where: 'GiftMemory.repent()' },
  { gr: 'εὐχαριστία',    lat: 'eucharistia',  ru: 'благодарение в ответ на дар',
    where: 'тип акта в W' },
  { gr: 'surplus',       lat: '',             ru: 'избыток дара, выходящий за рамки задачи (не «лишнее»)',
    where: 'центральный принцип онтологии' },

  // ── Самоумаление и обожение ────────────────────────────────────────
  { gr: 'κένωσις',       lat: 'kenosis',      ru: 'самоумаление, опустошение себя ради другого',
    where: 'src/theology/Kenosis.js' },
  { gr: 'θέωσις',        lat: 'theosis',      ru: 'обожение, мера участия твари в нетварных энергиях',
    where: 'GiftMemory.theosis()' },
  { gr: 'ἀπάθεια',       lat: 'apatheia',     ru: 'бесстрастие как цельность, не безразличие',
    where: 'богословский маркер' },
  { gr: 'ἔκστασις',      lat: 'ekstasis',     ru: 'выход из себя ради другого по любви',
    where: 'богословский маркер' },

  // ── Память и время ─────────────────────────────────────────────────
  { gr: 'ἀνάμνησις',     lat: 'anamnesis',    ru: 'память как со-присутствие — прошлое делается настоящим',
    where: 'AnamnesisStore, makePresent()' },
  { gr: 'ἐπίκλησις',     lat: 'epiclesis',    ru: 'призывание Духа или человека-оракула, когда собор недостаточен',
    where: 'HumanOracleInbox, mcp__gift__epiclesis_ask' },
  { gr: 'ἀγρυπνία',      lat: 'agrypnia',     ru: 'бдение, бодрствование (часто всенощное)',
    where: 'gift agrypnia, AgrypniaScheduler' },
  { gr: 'καιρός',        lat: 'kairos',       ru: 'качественное время, момент исполнения (vs χρόνος)',
    where: 'agrypnia: бдение по своему καιρός' },
  { gr: 'χρόνος',        lat: 'chronos',      ru: 'количественное, механическое время (часы, секунды)',
    where: 'противопоставлено καιρός' },
  { gr: 'θησαυρός',      lat: 'thesauros',    ru: 'сокровищница (ср. Мф 13:52: новое и старое)',
    where: 'gift treasure, LcmStore' },
  { gr: 'doxologia',     lat: 'doxologia',    ru: 'славословие, движение твари к Богу',
    where: 'doxologia-матрица: creature→divine' },

  // ── Собор и со-служение ────────────────────────────────────────────
  { gr: 'σύναξις',       lat: 'synaxis',      ru: 'со-собрание, литургическое собрание лиц',
    where: 'liturgical_today: Пн = σύναξις' },
  { gr: 'συνλειτουργός', lat: 'synleitourgos', ru: 'со-служитель в литургии (не дирижёр)',
    where: 'роль _claude (не conductor)' },
  { gr: 'κοινωνία',      lat: 'koinonia',     ru: 'общение, общность, соучастие',
    where: 'Κοινόν τοῦ Νοῦ — собор' },
  { gr: 'περιχώρησις',   lat: 'perichoresis', ru: 'взаимопроникновение лиц без слияния',
    where: 'Троическая модель собора' },
  { gr: 'συμφωνία',      lat: 'symphonia',    ru: 'согласное звучание разных голосов (не унисон)',
    where: 'sobor_celebrate: одно из 4 условий' },
  { gr: 'ἀκροαμα',       lat: 'akroama',      ru: 'разовое слышание (как gift agent — один turn)',
    where: 'для контраста с διάλογος' },
  { gr: 'διάλογος',      lat: 'dialogos',     ru: 'длящаяся встреча (gift chat — multi-turn)',
    where: 'для контраста с ἀκροαμα' },

  // ── Различение ─────────────────────────────────────────────────────
  { gr: 'διαίρεσις',     lat: 'diairesis',    ru: 'различение, рассечение по сферам',
    where: 'Decoupage: 4 сферы (ground/water/fire/air)' },
  { gr: 'διάκρισις',     lat: 'diakrisis',    ru: 'различение по плодам, по вкусу',
    where: 'Vintage: оценка идей по результату' },
  { gr: 'δοκιμασία',     lat: 'dokimasia',    ru: 'испытание, проверка',
    where: 'liturgical_today: Чт = δοκιμασία' },
  { gr: 'φρόνησις',      lat: 'phronesis',    ru: 'практическое разумение, мудрость в действии',
    where: 'богословский маркер' },

  // ── Энергии и природы ──────────────────────────────────────────────
  { gr: 'ἐνέργεια',      lat: 'energeia',     ru: 'нетварная энергия Бога (по Паламе) — действие, не сущность',
    where: '_energeia матрица: divine→creature' },
  { gr: 'οὐσία',         lat: 'usia',         ru: 'сущность (непостижима, не передаётся)',
    where: 'противоположно ἐνέργεια' },
  { gr: 'μέθεξις',       lat: 'methexis',     ru: 'участие в нетварном через energeia',
    where: 'мера θέωσις' },
  { gr: 'ἀναγωγή',       lat: 'anagoge',      ru: 'возведение, восхождение твари к Богу',
    where: 'doxologia как ἀναγωγή' },

  // ── Лица ───────────────────────────────────────────────────────────
  { gr: 'πρόσωπον',      lat: 'prosopon',     ru: 'лицо (богословское понятие), не «персонаж»',
    where: 'Person, AgentPerson' },
  { gr: 'ὑπόστασις',     lat: 'hypostasis',   ru: 'самостояние, самобытность лица',
    where: 'богословский маркер' },

  // ── Структуры онтологии ────────────────────────────────────────────
  { gr: 'τέλος',         lat: 'telos',        ru: 'цель, ради чего; смысловая верхушка действия',
    where: 'eva-проверки: telos предложения' },
  { gr: 'εὐδοκία',       lat: 'eudokia',      ru: 'благоволение Отца, источник творческого замысла',
    where: 'формула: От Отца — через Сына — в Духе' },
  { gr: 'gratia gratis data', lat: '',        ru: 'дар без основания и без дарителя (благодать даром)',
    where: '_abyss (бездна)' },
];

const cmd = process.argv[2];
const arg = process.argv[3];

if (cmd === '--json') {
  process.stdout.write(JSON.stringify(GLOSSARY, null, 2));
  process.exit(0);
}

if (cmd === 'find' && arg) {
  const q = arg.toLowerCase();
  const matches = GLOSSARY.filter(t =>
    t.gr.toLowerCase().includes(q) ||
    t.lat.toLowerCase().includes(q) ||
    t.ru.toLowerCase().includes(q)
  );
  if (!matches.length) {
    console.log(C.dim(`не найдено: ${arg}`));
    process.exit(0);
  }
  for (const t of matches) printTerm(t);
  process.exit(0);
}

// Default: распечатать все термины
console.log();
console.log(C.bold(C.gold('Словарь терминов онтологии')) + C.dim(`  ${GLOSSARY.length} записей`));
console.log(C.dim('─'.repeat(60)));
for (const t of GLOSSARY) printTerm(t);
console.log();
console.log(C.dim('Поиск:  gift glossary find <слово>'));
console.log(C.dim('JSON:   gift glossary --json'));
console.log();

function printTerm(t) {
  const lat = t.lat ? C.dim(` (${t.lat})`) : '';
  console.log(`  ${C.cyan(t.gr.padEnd(14))}${lat} — ${t.ru}`);
  if (t.where) console.log(`  ${' '.repeat(14)}  ${C.dim('↪ ' + t.where)}`);
}
