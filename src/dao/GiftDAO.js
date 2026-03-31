/**
 * GiftDAO — управление общиной Claude-пользователей
 *
 * Не «скинемся на подписку».
 * А: помогаешь другим → зарабатываешь доступ к AI.
 *
 * Логика доступа (антиатомизм):
 *   base_tokens = взнос в общину (деньги = тоже дар, тип offering)
 *   bonus_tokens = surplus в W-матрице (помогаешь → получаешь)
 *   total = base + bonus * GIFT_MULTIPLIER
 *
 * Кто много даёт — получает больше AI. Не богатые — щедрые.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { GiftMemory } from '../core/GiftMemory.js';
import { CommunityDiagnostic } from '../core/GiftOptimizer.js';

const MEMBERS_PATH = './data/dao/members.json';
const SNAP_PATH    = './data/dao/community-W.json';

// Токены в месяц: 1 токен ≈ 1000 Claude-токенов
const BASE_TOKENS_PER_UNIT  = 50_000;   // за каждый взнос-юнит
const GIFT_MULTIPLIER       = 10_000;   // surplus * это = бонусные токены
const MAX_TOKENS_PER_MONTH  = 2_000_000;

export class GiftDAO {
  constructor() {
    this._members = this._loadMembers();
    this._mem     = this._loadCommunity();
  }

  // ── Участники ─────────────────────────────────────────────────────────

  _loadMembers() {
    if (!existsSync(MEMBERS_PATH)) return {};
    return JSON.parse(readFileSync(MEMBERS_PATH, 'utf8'));
  }

  _saveMembers() {
    writeFileSync(MEMBERS_PATH, JSON.stringify(this._members, null, 2));
  }

  _loadCommunity() {
    if (!existsSync(SNAP_PATH)) return new GiftMemory(['_koinon']);
    return GiftMemory.fromSnapshot(JSON.parse(readFileSync(SNAP_PATH, 'utf8')));
  }

  _saveCommunity() {
    writeFileSync(SNAP_PATH, JSON.stringify(this._mem.snapshot(), null, 2));
  }

  // ── Вступление ────────────────────────────────────────────────────────
  //
  // userId — Telegram ID
  // name   — имя в общине
  // units  — сколько взнос-юнитов внёс (1 юнит = минимальный взнос)

  join(userId, name, units = 1) {
    const id = String(userId);
    if (!this._members[id]) {
      this._members[id] = {
        name,
        userId: id,
        units:  0,
        usedTokens: 0,
        monthStart: new Date().toISOString(),
        joinedAt:  new Date().toISOString(),
      };
    }
    this._members[id].units += units;
    this._members[id].name   = name;

    // Взнос = дар типа offering в общину
    this._mem.receive({
      giverId: name, receiverId: '_koinon',
      weight: units * 6, type: 'offering',
      content: `взнос ${units} юнит`,
      irreversible: true,
    });
    this._saveMembers();
    this._saveCommunity();
    return this._members[id];
  }

  // ── Записать дар помощи ───────────────────────────────────────────────

  recordHelp(fromName, toName, type = 'presence', content = '') {
    const WEIGHTS = { time: 10, presence: 7, code: 4, word: 3, question: 5 };
    this._mem.receive({
      giverId: fromName, receiverId: toName,
      weight: WEIGHTS[type] ?? 5, type,
      content, irreversible: true,
    });
    this._saveCommunity();
  }

  // ── Доступ: сколько токенов у участника ──────────────────────────────

  tokensAvailable(userId) {
    const id     = String(userId);
    const member = this._members[id];
    if (!member) return 0;

    // Сбросить счётчик если новый месяц
    const monthStart = new Date(member.monthStart);
    const now        = new Date();
    if (now.getMonth() !== monthStart.getMonth() ||
        now.getFullYear() !== monthStart.getFullYear()) {
      member.usedTokens = 0;
      member.monthStart = now.toISOString();
      this._saveMembers();
    }

    const diag    = new CommunityDiagnostic(this._mem.snapshot());
    const given   = this._mem.totalGiven(member.name);
    const recv    = this._mem.totalReceived(member.name);
    const surplus = Math.max(0, given - recv);

    const base  = member.units * BASE_TOKENS_PER_UNIT;
    const bonus = Math.floor(surplus * GIFT_MULTIPLIER);
    const total = Math.min(base + bonus, MAX_TOKENS_PER_MONTH);
    const avail = Math.max(0, total - (member.usedTokens ?? 0));

    return { base, bonus, total, used: member.usedTokens ?? 0, available: avail };
  }

  // ── Использовать токены ───────────────────────────────────────────────

  consumeTokens(userId, amount) {
    const id = String(userId);
    if (!this._members[id]) return false;
    const { available } = this.tokensAvailable(userId);
    if (available < amount) return false;
    this._members[id].usedTokens = (this._members[id].usedTokens ?? 0) + amount;
    this._saveMembers();
    return true;
  }

  // ── Профиль участника ─────────────────────────────────────────────────

  profile(userId) {
    const id     = String(userId);
    const member = this._members[id];
    if (!member) return null;
    const tokens  = this.tokensAvailable(userId);
    const given   = this._mem.totalGiven(member.name);
    const recv    = this._mem.totalReceived(member.name);
    return { ...member, tokens, given, received: recv, surplus: given - recv };
  }

  // ── Таблица лидеров (по даяниям, не по деньгам) ────────────────────

  leaderboard(n = 10) {
    return Object.values(this._members)
      .map(m => ({
        name:    m.name,
        given:   this._mem.totalGiven(m.name),
        surplus: this._mem.totalGiven(m.name) - this._mem.totalReceived(m.name),
        tokens:  this.tokensAvailable(m.userId).available,
      }))
      .sort((a, b) => b.surplus - a.surplus)
      .slice(0, n);
  }

  get memberCount() { return Object.keys(this._members).length; }
  get actsCount()   { return this._mem.actsCount; }
}
