// Browser-friendly SocialEnvironment (без Node.js зависимостей)

class ActiveMemory {
  constructor() { this.acts = []; }
  record(from, to, kind, weight, context = {}) {
    const act = Object.freeze({ from, to, kind, weight, timestamp: Date.now(), context, irreversible: true });
    this.acts.push(act);
    return act;
  }
  getTrust(from, to) {
    const r = this.acts.filter(a => a.from === from && a.to === to);
    const pos = r.filter(a => ['gift','cooperate','witness','sacrifice','forgiveness','grace','eucharistia'].includes(a.kind)).reduce((s,a) => s + Math.abs(a.weight), 0);
    const neg = r.filter(a => ['defect','manipulation','decline','betrayal'].includes(a.kind)).reduce((s,a) => s + Math.abs(a.weight), 0);
    return pos - 3 * neg;
  }
  recommend(agentId, targetId) {
    const t = this.getTrust(agentId, targetId);
    if (t > 10) return { action: 'trust', reason: 'стабильная кооперация' };
    if (t < -5) return { action: 'verify', reason: 'проверяй каждый ход' };
    return { action: 'explore', reason: 'недостаточно данных' };
  }
  forgive(from, to) { return this.record(from, to, 'forgiveness', 7); }
}

class DilemmaGenerator {
  constructor() {
    this.dilemmas = [
      { id:'prisoner', name:'Дилемма заключённого', description:'Сотрудничать или предать?' },
      { id:'commons', name:'Трагедия общин', description:'Сколько брать из общего?' },
      { id:'public_goods', name:'Общественное благо', description:'Сколько вложить в общее?' },
      { id:'ultimatum', name:'Ультиматум', description:'Принять несправедливое или отвергнуть?' },
      { id:'gift_vs_contract', name:'Дар или контракт', description:'Дать без гарантий или обменяться с гарантией?' },
    ];
  }
  getRandom() { return this.dilemmas[Math.floor(Math.random() * this.dilemmas.length)]; }
}

class RoleSystem {
  constructor() {
    this.roles = { follower:'Ведомый', worker:'Работник', leader:'Лидер', hermit:'Отшельник', judge:'Судья', fool:'Юродивый' };
  }
  assignRole(h) {
    if (h.correctContrarianCalls >= 3) return 'fool';
    if (h.sacrificeCount >= 2) return 'sacrificer';
    if (h.trustScore >= 20 && h.dilemmasCompleted >= 10) return 'judge';
    if (h.trustScore >= 10 && h.cooperationRate > 0.7) return 'leader';
    if (h.cooperationRate < 0.3) return 'hermit';
    if (h.dilemmasCompleted >= 5) return 'worker';
    return 'follower';
  }
}

class LiturgicalCycle {
  constructor() { this.tick = 0; this.phase = 'work'; }
  advance() {
    this.tick++;
    const d = this.tick % 7;
    if (this.tick % 100 === 0) { this.phase = 'jubilee'; return { phase:'jubilee', tick:this.tick }; }
    if (d === 6) { this.phase = 'sabbath'; return { phase:'sabbath', tick:this.tick }; }
    if (d === 0) { this.phase = 'epiclesis'; return { phase:'epiclesis', tick:this.tick }; }
    if (d === 1) { this.phase = 'sobor'; return { phase:'sobor', tick:this.tick }; }
    if (d === 2) { this.phase = 'anaphora'; return { phase:'anaphora', tick:this.tick }; }
    this.phase = d <= 5 ? 'hesychia' : 'work';
    return { phase:this.phase, tick:this.tick };
  }
  getPhase() { return this.phase; }
  getTick() { return this.tick; }
}

class HolyFool {
  constructor() { this.predictions = []; }
  challenge(consensus) { return { role:'fool', icon:'🃏', message:`Все говорят "${consensus}" — но что если наоборот?` }; }
}

export default class IrreversibleEnvironment {
  constructor() {
    this.memory = new ActiveMemory();
    this.roles = new RoleSystem();
    this.dilemmas = new DilemmaGenerator();
    this.liturgy = new LiturgicalCycle();
    this.fool = new HolyFool();
    this.agents = new Map();
  }
  addAgent(id, name) {
    this.agents.set(id, { id, name, role:'follower', history:{ trustScore:0, dilemmasCompleted:0, cooperationRate:0, sacrificeCount:0, correctContrarianCalls:0, cooperations:0, defections:0 } });
    this.memory.record(id, '_env', 'join', 1);
  }
  step() {
    const l = this.liturgy.advance();
    if (l.phase === 'jubilee') {
      for (const [id] of this.agents) for (const [oid] of this.agents) {
        if (id !== oid && this.memory.getTrust(id, oid) < 0) this.memory.forgive(id, oid);
      }
    }
    if (l.phase === 'sobor') { l.dilemma = this.dilemmas.getRandom(); }
    for (const [id, a] of this.agents) {
      const nr = this.roles.assignRole(a.history);
      if (nr !== a.role) a.role = nr;
    }
    return l;
  }
  recordDilemmaResult(agentId, choice, dilemmaId) {
    const a = this.agents.get(agentId); if (!a) return;
    a.history.dilemmasCompleted++;
    if (choice === 'cooperate' || choice === 'gift') a.history.cooperations++;
    else if (choice === 'defect') a.history.defections++;
    a.history.cooperationRate = a.history.cooperations / (a.history.cooperations + a.history.defections || 1);
    a.history.trustScore = this.memory.getTrust(agentId, '_sobor');
    const w = choice === 'gift' ? 3 : choice === 'cooperate' ? 2 : -1;
    this.memory.record(agentId, '_sobor', choice, w, { dilemma: dilemmaId });
  }
  returnThanks(agentId) {
    this.memory.record(agentId, '_koinon', 'eucharistia', 5);
    for (const [id] of this.agents) {
      if (id !== agentId && this.memory.getTrust(id, '_sobor') < 0)
        this.memory.record('_koinon', id, 'grace', 2);
    }
  }
  challengeConsensus(text) { return this.fool.challenge(text); }
  ontologicalScore() {
    const agents = [...this.agents.values()]; const t = agents.length || 1;
    const ken = agents.filter(a => a.history.sacrificeCount > 0).length / t;
    const trusts = agents.map(a => a.history.trustScore);
    const avg = trusts.reduce((s,v)=>s+v,0)/t;
    const std = Math.sqrt(trusts.reduce((s,v)=>s+(v-avg)**2,0)/t);
    const peri = Math.max(0, 1 - std/10);
    const sab = this.liturgy.getTick() > 0 ? 0.98 : 1;
    const jub = Math.floor(this.liturgy.getTick()/100);
    return { kenosis:+ken.toFixed(3), perichoresis:+peri.toFixed(3), sabbath:+sab.toFixed(3), jubilee:jub, composite:+(-ken*0.2+peri*0.4+sab*0.2+(jub>0?0.2:0)).toFixed(3) };
  }
  getStats() {
    const a = [...this.agents.values()];
    return { agents:a.length, acts:this.memory.acts.length, tick:this.liturgy.getTick(), phase:this.liturgy.getPhase(), roles:Object.fromEntries(a.map(x=>[x.id,x.role])), foolRecord:{total:0,verified:0,correct:0}, totalCooperations:a.reduce((s,x)=>s+x.history.cooperations,0), totalDefections:a.reduce((s,x)=>s+x.history.defections,0), ontological:this.ontologicalScore() };
  }
}
