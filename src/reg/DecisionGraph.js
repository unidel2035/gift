/**
 * DecisionGraph — REG (Registry Graph) для Мета КБ
 *
 * Не RAG (поиск по документам), а REG (реестр-граф проектных решений).
 * Каждое решение — узел. Связи: depends_on, conflicts_with, supersedes, compatible_with.
 * Provenance: кто принял, когда, на основании чего, с кем.
 *
 * Закон Рида (V ∝ 2^N): ценность = числу возможных комбинаций кентавров.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const REG_DIR = resolve(ROOT, 'data', 'reg');
const DECISIONS_FILE = resolve(REG_DIR, 'decisions.jsonl');
const LINKS_FILE = resolve(REG_DIR, 'links.jsonl');

function ensure() {
  if (!existsSync(REG_DIR)) mkdirSync(REG_DIR, { recursive: true });
}

// ── Decision Node ────────────────────────────────────────────────────────────

export class DecisionGraph {
  constructor() {
    this.decisions = [];
    this.links = [];
    ensure();
    this._load();
  }

  _load() {
    try {
      if (existsSync(DECISIONS_FILE)) {
        this.decisions = readFileSync(DECISIONS_FILE, 'utf8')
          .split('\n').filter(Boolean).map(JSON.parse);
      }
    } catch {}
    try {
      if (existsSync(LINKS_FILE)) {
        this.links = readFileSync(LINKS_FILE, 'utf8')
          .split('\n').filter(Boolean).map(JSON.parse);
      }
    } catch {}
  }

  _save() {
    writeFileSync(DECISIONS_FILE, this.decisions.map(JSON.stringify).join('\n') + '\n');
    writeFileSync(LINKS_FILE, this.links.map(JSON.stringify).join('\n') + '\n');
  }

  // ── Запись решения ──────────────────────────────────────────────────────

  recordDecision({ id, project, domain, title, description, madeBy, team,
                    files = [], verdict = 'decided', evidence = [], weight = 1,
                    status = 'active', supersedes = null }) {
    const d = {
      id: id || `dec-${Date.now()}-${Math.random().toString(36).slice(2,6)}`,
      ts: new Date().toISOString(),
      project: project || 'unknown',
      domain: domain || 'general',
      title,
      description: description?.slice(0, 500),
      madeBy,
      team: team || [madeBy],
      files,
      verdict,        // decided | rejected | postponed | superseded
      evidence,       // array of act-ids from act-index
      weight,
      status,
      supersedes,
    };
    this.decisions.push(d);
    this._save();
    return d;
  }

  // ── Связи между решениями ────────────────────────────────────────────────

  linkDecisions(fromId, toId, linkType) {
    const validTypes = ['depends_on', 'conflicts_with', 'supersedes', 'compatible_with', 'informs'];
    if (!validTypes.includes(linkType)) throw new Error(`Invalid link type: ${linkType}`);

    const link = {
      from: fromId,
      to: toId,
      type: linkType,
      ts: new Date().toISOString(),
    };
    this.links.push(link);
    this._save();

    // Auto-update superseded status
    if (linkType === 'supersedes') {
      const target = this.decisions.find(d => d.id === toId);
      if (target) { target.status = 'superseded'; this._save(); }
    }
    return link;
  }

  // ── Анамнезис: что известно о запросе ───────────────────────────────────

  anamnesis(query, { domain = null, project = null, limit = 10 } = {}) {
    const results = {
      query,
      timestamp: new Date().toISOString(),
      previousWork: [],
      relatedDecisions: [],
      activeCentaurs: [],
      compatibility: [],
      failures: [],
    };

    // Поиск: разбиваем запрос на слова, ищем ЛЮБОЕ совпадение
    const words = query.toLowerCase().split(/\s+/).filter(w => w.length > 1);
    const relevant = this.decisions
      .filter(d => {
        if (domain && d.domain !== domain) return false;
        if (project && d.project !== project) return false;
        const haystack = [
          (d.title || '').toLowerCase(),
          (d.description || '').toLowerCase(),
          (d.domain || '').toLowerCase(),
          (d.project || '').toLowerCase(),
          (d.team || []).join(' ').toLowerCase(),
        ].join(' ');
        // 1 слово — точное. 2+ слов — большинство слов должно совпасть
        if (words.length === 1) return haystack.includes(query.toLowerCase());
        const matched = words.filter(w => haystack.includes(w)).length;
        return matched >= Math.ceil(words.length / 2);
      })
      .slice(-limit);

    for (const d of relevant) {
      results.previousWork.push({
        id: d.id,
        title: d.title,
        team: d.team,
        verdict: d.verdict,
        status: d.status,
        when: d.ts,
        description: d.description?.slice(0, 150),
        domain: d.domain,
        project: d.project,
      });

      if (d.verdict === 'rejected' || d.status === 'superseded') {
        results.failures.push({
          id: d.id,
          title: d.title,
          reason: d.status === 'superseded' ? 'заменено более новым решением' : 'отклонено',
          team: d.team,
        });
      }
    }

    // Поиск связанных решений через граф
    const relatedIds = new Set();
    for (const d of relevant) {
      for (const l of this.links) {
        if (l.from === d.id && l.type === 'compatible_with') relatedIds.add(l.to);
        if (l.to === d.id && l.type === 'compatible_with') relatedIds.add(l.from);
      }
    }
    results.compatibility = [...relatedIds].map(id => {
      const d = this.decisions.find(dd => dd.id === id);
      return d ? { id: d.id, title: d.title, team: d.team, status: d.status } : null;
    }).filter(Boolean);

    return results;
  }

  // ── Совместимость команд ─────────────────────────────────────────────────

  teamCompatibility(teamA, teamB) {
    const sharedDecisions = this.decisions.filter(d =>
      d.team.some(a => teamA.includes(a)) && d.team.some(b => teamB.includes(b))
    );
    const sharedLinks = this.links.filter(l =>
      sharedDecisions.some(d => d.id === l.from || d.id === l.to)
    );

    const compatLinks = sharedLinks.filter(l => l.type === 'compatible_with').length;
    const conflictLinks = sharedLinks.filter(l => l.type === 'conflicts_with').length;

    return {
      teams: [teamA, teamB],
      sharedProjects: sharedDecisions.length,
      compatible: compatLinks > conflictLinks,
      score: compatLinks - conflictLinks,
      recentShared: sharedDecisions.filter(d =>
        Date.now() - new Date(d.ts).getTime() < 90 * 24 * 3600 * 1000
      ).length,
    };
  }

  // ── Статистика ───────────────────────────────────────────────────────────

  stats() {
    const byDomain = {};
    for (const d of this.decisions) {
      byDomain[d.domain] = (byDomain[d.domain] || 0) + 1;
    }
    const byVerdict = {};
    for (const d of this.decisions) {
      byVerdict[d.verdict] = (byVerdict[d.verdict] || 0) + 1;
    }
    return {
      totalDecisions: this.decisions.length,
      totalLinks: this.links.length,
      byDomain,
      byVerdict,
      activeDecisions: this.decisions.filter(d => d.status === 'active').length,
      supersededDecisions: this.decisions.filter(d => d.status === 'superseded').length,
      // Reed's Law value estimate
      teamCount: new Set(this.decisions.flatMap(d => d.team)).size,
      reedValue: Math.pow(2, new Set(this.decisions.flatMap(d => d.team)).size),
    };
  }
}
