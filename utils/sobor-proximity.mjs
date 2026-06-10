#!/usr/bin/env node
/**
 * sobor-proximity — Proximity-агент собора (третья шестерёнка Co-Scientist).
 *
 * У Google: «maps and clusters generated hypotheses to help ensure a diverse,
 * comprehensive exploration». Без него турнир ранжирует почти-дубликаты как
 * разные гипотезы, а эволюция скрещивает близкое с близким → вырождение.
 *
 * Что делает: кластеризует кандидатов по смысловой близости (порог),
 * оставляет от каждого кластера одного представителя (самого содержательного),
 * к нему прикрепляет поглощённых (merged) — чтобы турнир сравнивал РАЗНОЕ,
 * а не оттенки одного. Лица не теряются: merged видны в результате.
 *
 * Мера близости — та же, что у заземления: embeddings (Ollama nomic) если есть,
 * иначе лексическая косинусная. Детерминированно и офлайн-безопасно.
 *
 * Запуск:
 *   node utils/sobor-proximity.mjs --selftest
 */
import { similarity } from './sobor-ground-judge.mjs';

// Жадная кластеризация по порогу: первый непоглощённый — центр кластера.
// Возвращает массив кластеров [{ rep, members:[...] }], rep — представитель.
export function cluster(candidates, { threshold = 0.82, simFn = similarity } = {}) {
  const clusters = [];
  const taken = new Array(candidates.length).fill(false);
  // Содержательность: длина текста как грубая прокси (на равной близости берём более развёрнутого).
  const richness = c => String(c.text || '').length;

  for (let i = 0; i < candidates.length; i++) {
    if (taken[i]) continue;
    const members = [candidates[i]];
    taken[i] = true;
    for (let j = i + 1; j < candidates.length; j++) {
      if (taken[j]) continue;
      const { sim } = simFn(candidates[i].text, candidates[j].text);
      if (sim >= threshold) { members.push(candidates[j]); taken[j] = true; }
    }
    // представитель кластера — самый содержательный (но если у кого-то есть trial, он в приоритете:
    // испытуемая гипотеза важнее красноречивой)
    const rep = members.slice().sort((a, b) =>
      (Number(!!b.trial) - Number(!!a.trial)) || (richness(b) - richness(a)))[0];
    clusters.push({ rep, members });
  }
  return clusters;
}

/**
 * Дедуп для турнира: список представителей + карта поглощённых.
 * diverse — что идёт в турнир; merged — поглощённые (text) по id представителя.
 */
export function diversify(candidates, opts) {
  const clusters = cluster(candidates, opts);
  const diverse = clusters.map(c => ({
    ...c.rep,
    mergedCount: c.members.length - 1,
    merged: c.members.filter(m => m !== c.rep).map(m => ({ id: m.id, text: m.text })),
  }));
  return { diverse, clusters };
}

// ── Самопроверка (детерминированная, без сети — лексическая мера) ────
if (import.meta.url === `file://${process.argv[1]}`) {
  if (process.argv.includes('--selftest')) {
    const cands = [
      { id: 'a1', text: 'базовый PID контур держит точку при возмущениях в пределах допуска' },
      { id: 'a2', text: 'базовый PID контур удерживает точку при возмущениях в пределах допуска норм' }, // почти дубль a1
      { id: 'b1', text: 'рой из пятидесяти аппаратов самоорганизуется без центрального управления' },
      { id: 'c1', text: 'предиктивная модель ветра снимает остаточный риск срыва миссии' },
    ];
    const { diverse, clusters } = diversify(cands, { threshold: 0.6 });
    console.log(`Кандидатов: ${cands.length} → кластеров: ${clusters.length}`);
    for (const c of clusters) {
      console.log(`  • [${c.rep.id}] ${c.rep.text.slice(0, 50)}…` + (c.members.length > 1 ? ` (+${c.members.length - 1} поглощено: ${c.members.filter(m => m !== c.rep).map(m => m.id).join(',')})` : ''));
    }
    // ожидаем: a1≈a2 схлопнулись → 3 кластера, b1 и c1 отдельны
    const ok = clusters.length === 3 && diverse.some(d => d.mergedCount === 1);
    console.log(ok ? '\n✓ selftest passed (почти-дубль схлопнут, разное сохранено)' : '\n✗ selftest FAILED');
    process.exit(ok ? 0 : 1);
  }
  console.log('Использование: node utils/sobor-proximity.mjs --selftest');
}
