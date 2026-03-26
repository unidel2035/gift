/**
 * auto-backup — заглушка
 *
 * Автоматическое резервное копирование данных Integram.
 * Будет реализовано вместе с полным подключением к Integram V2.
 */

export function autoBackup(client, options = {}) {
  // Заглушка — бэкап не выполняется
  return {
    start: () => {},
    stop:  () => {},
    isRunning: () => false,
  };
}

export default autoBackup;
