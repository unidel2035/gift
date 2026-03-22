/**
 * GiftEventBus — простая синхронная шина событий
 *
 * Pub/sub для внутренней координации подсистем Gift Engine.
 * Подписчики получают неизменяемые GiftEvent объекты.
 *
 * Поддерживает:
 *   - Конкретные типы: bus.on('gift:offered', fn)
 *   - Wildcards: bus.on('gift:*', fn) — все gift:xxx
 *   - Глобальный: bus.on('*', fn) — все события
 */
class GiftEventBus {
  constructor() {
    this._listeners = new Map();  // type → Set<fn>
    this._wildcards = new Map();  // prefix → Set<fn>  (e.g. 'gift' for 'gift:*')
    this._globals = new Set();    // '*' listeners
  }

  /**
   * Subscribe to events.
   * @param {string} type — event type, 'prefix:*' for wildcard, '*' for all
   * @param {function} fn — callback(event)
   * @returns {function} unsubscribe
   */
  on(type, fn) {
    if (type === '*') {
      this._globals.add(fn);
      return () => this._globals.delete(fn);
    }

    if (type.endsWith(':*')) {
      const prefix = type.slice(0, -2);
      if (!this._wildcards.has(prefix)) this._wildcards.set(prefix, new Set());
      this._wildcards.get(prefix).add(fn);
      return () => this._wildcards.get(prefix)?.delete(fn);
    }

    if (!this._listeners.has(type)) this._listeners.set(type, new Set());
    this._listeners.get(type).add(fn);
    return () => this._listeners.get(type)?.delete(fn);
  }

  /**
   * Emit an event to all matching subscribers.
   * Synchronous — all subscribers called before emit() returns.
   *
   * @param {string} type — event type
   * @param {object} event — the GiftEvent (should be frozen)
   */
  emit(type, event) {
    // Exact match
    const exact = this._listeners.get(type);
    if (exact) {
      for (const fn of exact) {
        try { fn(event); } catch (e) {
          console.error(`[GiftEventBus] Subscriber error on ${type}:`, e.message);
        }
      }
    }

    // Wildcard match (e.g. 'gift' matches 'gift:offered')
    const colonIdx = type.indexOf(':');
    if (colonIdx > 0) {
      const prefix = type.slice(0, colonIdx);
      const wildcardListeners = this._wildcards.get(prefix);
      if (wildcardListeners) {
        for (const fn of wildcardListeners) {
          try { fn(event); } catch (e) {
            console.error(`[GiftEventBus] Wildcard subscriber error on ${type}:`, e.message);
          }
        }
      }
    }

    // Global listeners
    for (const fn of this._globals) {
      try { fn(event); } catch (e) {
        console.error(`[GiftEventBus] Global subscriber error on ${type}:`, e.message);
      }
    }
  }

  /**
   * Remove all listeners (for testing / teardown).
   */
  clear() {
    this._listeners.clear();
    this._wildcards.clear();
    this._globals.clear();
  }

  /**
   * Stats for diagnostics.
   */
  stats() {
    let exactCount = 0;
    for (const s of this._listeners.values()) exactCount += s.size;
    let wildcardCount = 0;
    for (const s of this._wildcards.values()) wildcardCount += s.size;
    return {
      exact: exactCount,
      wildcard: wildcardCount,
      global: this._globals.size,
      total: exactCount + wildcardCount + this._globals.size,
    };
  }
}

export default GiftEventBus;
