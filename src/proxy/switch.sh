#!/bin/bash
# Quick switch backend from inside Claude Code
# Usage: ! ~/deepclaude/switch.sh ra    (or ds, or, fw, anthropic)
# Usage: ! ~/deepclaude/switch.sh       (show current status)

PROXY="http://127.0.0.1:3200"

if [[ -z "$1" ]]; then
    # Status
    curl -s "$PROXY/_proxy/status" 2>/dev/null | python3 -c "
import sys,json
r=json.load(sys.stdin)
print(f\"Backend: {r.get('mode','?')}  |  Requests: {r.get('requests',0)}\")
" 2>/dev/null || echo "Proxy not running"
    exit 0
fi

BACKEND="$1"
case "$BACKEND" in
    ds)  BACKEND="deepseek" ;;
    ra)  BACKEND="routerai" ;;
    or)  BACKEND="openrouter" ;;
    fw)  BACKEND="fireworks" ;;
esac

RESULT=$(curl -sX POST "$PROXY/_proxy/mode" -d "backend=$BACKEND" 2>/dev/null)
if [[ $? -ne 0 ]]; then
    echo "Proxy not running. Start with: deepclaude"
    exit 1
fi

python3 -c "
import sys,json
r=json.loads('$RESULT')
if 'error' in r:
    print(f'ERROR: {r[\"error\"]}')
else:
    print(f'{r.get(\"previous\",\"?\")} → {r.get(\"mode\",\"?\")}')
" 2>/dev/null
