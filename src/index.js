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

// Главный движок
export { GiftEngine } from './core/GiftEngine.js';

// Ядро
export { GiftAct, GiftMode, AntiKenosis, TelosCheck } from './core/GiftAct.js';
export { PersonaCallForth } from './core/PersonaCallForth.js';
export { LogosRegistry } from './core/LogosRegistry.js';
export { GiftStore } from './core/GiftStore.js';
export { GiftEvent, createGiftEvent, EVENT_TYPES } from './core/GiftEvent.js';
export { GiftEventBus } from './core/GiftEventBus.js';
export { Trit, Tryte, TernaryVM, TernaryALU, TernaryMemory, TernaryRegister, OPCODES } from './core/TernaryCore.js';
export { GiftCompiler } from './core/GiftCompiler.js';

// Граф
export { GratitudeGraph } from './traces/GratitudeGraph.js';

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

// Анамнетическая память
export { AnamnesisStore, getAnamnesisStore } from './memory/AnamnesisStore.js';
export { Presence } from './memory/Presence.js';

// Живой слой — воплощение (Ин 1:14)
export { ABYSS_SEAL, mark as abyssalMark, from as fromAbyss } from './theology/Abyss.js';
export { DNYES, seal as mortisSeal, isDeferred, isSealed, warn as mortisWarn } from './theology/MortisKairos.js';
export { incarnate, witness as witnessAct, is as giftIs } from './theology/LivingGift.js';
export { word, time, presence, fromBeyond } from './theology/Incarnation.js';
export { Flesh } from './theology/Flesh.js';
export { CommunalBreath } from './theology/CommunalBreath.js';
