/**
 * @unidel/gift — Онтология Дара
 *
 * Не тень, а источник.
 *
 * Здесь живёт то, что нельзя вычислить, но можно моделировать:
 * кенозис, свобода, благодарность, избыток.
 *
 * DronDoc и другие платформы — тени этого.
 * Тень реальна. Но она указывает на источник, не является им.
 *
 * «Всё из Него, Им и к Нему» (Рим 11:36)
 */

// Ядро
export { GiftAct, GiftMode, AntiKenosis, TelosCheck } from './core/GiftAct.js';
export { PersonaCallForth } from './core/PersonaCallForth.js';
export { LogosRegistry } from './core/LogosRegistry.js';
export { GiftStore } from './core/GiftStore.js';
export { GiftEvent } from './core/GiftEvent.js';
export { GiftEventBus } from './core/GiftEventBus.js';

// Лица
export { AgentPerson } from './persons/AgentPerson.js';
export { PersonRegistry } from './persons/PersonRegistry.js';
export { AgentAwakening } from './persons/AgentAwakening.js';

// Память
export { AnamnesisMemory } from './memory/AnamnesisMemory.js';
export { LiturgicalClock } from './memory/LiturgicalClock.js';
export { Sabbath } from './memory/Sabbath.js';
export { EpochGate } from './memory/EpochGate.js';

// Теология
export { DivineEnergy } from './theology/DivineEnergy.js';
export { Apophasis } from './theology/Apophasis.js';
export { FreedomGuard } from './theology/FreedomGuard.js';
export { Anastasis } from './theology/Anastasis.js';
export { HolySaturday } from './theology/HolySaturday.js';
export { NewJerusalem } from './theology/NewJerusalem.js';
