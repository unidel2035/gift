#!/usr/bin/env bash
# Самозапускающийся смысловой контур: раз в сутки берёт одну тему,
# гонит Co-Scientist-собор с заземлением на живую мета-КБ и пишет
# победителя обратно решением (verdict proposed) на рассмотрение команды.
#
# Креды — в .env.metakb (gitignored). Расписание — crontab.
set -euo pipefail
cd "$(dirname "$0")/.."

# креды мета-КБ
[ -f .env.metakb ] && set -a && . ./.env.metakb && set +a

THEMES="utils/metakb-loop-themes.txt"
N=$(grep -cve '^[[:space:]]*$' "$THEMES")
DAY=$(date +%j)
LINE=$(( (10#$DAY % N) + 1 ))
THEME=$(sed -n "${LINE}p" "$THEMES")

echo "===== $(date -Iseconds) · тема: $THEME ====="
# 1) генератор (Адам): новое заземлённое решение
node utils/sobor-loop-metakb.mjs "$THEME" --n 3 --domain "Совместная разработка" --write
echo
# 2) критик (Ева): чистит дубли/мусор (reject применяется; accept — команде)
node utils/sobor-critic-metakb.mjs --apply
echo
