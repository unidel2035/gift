# -*- coding: utf-8 -*-
"""Извлекатель фактов из отраслевой базы знаний БАС (KAG dronedoc).
Использование: python3 utils/bas-knowledge.py "<запрос>" [limit]
Выводит JSON-массив фактов [{name,type,observation}] для заземления панелей.
"""
import sqlite3, json, sys, re, os

KAG = os.environ.get('BAS_KAG_PATH',
    '/home/unidel/dronedoc2026/backend/monolith/data/kag/kag.sqlite')

query = sys.argv[1] if len(sys.argv) > 1 else ''
limit = int(sys.argv[2]) if len(sys.argv) > 2 else 8

STOP = set('и в на от до для как что это при по со из под над без про или the and for'.split())
# доменные слова слишком общие — глушат различающие термины
DOMAIN_STOP = set('бпла бпас дрон дрона дроны дронов беспилотн система системы систем '
                  'управление управления канал канала каналов средства средствами'.split())

def keywords(text):
    words = re.findall(r'[A-Za-zА-Яа-яЁё]{3,}', text.lower())
    out = [w for w in dict.fromkeys(words) if w not in STOP and w not in DOMAIN_STOP]
    return out[:8]

def deobs(v):
    try:
        s = json.loads(v) if v else ''
        return s if isinstance(s, str) else str(s)
    except Exception:
        return str(v) if v else ''

facts = []
if not os.path.exists(KAG):
    print(json.dumps({'error': 'kag not found', 'path': KAG}, ensure_ascii=False)); sys.exit(0)

c = sqlite3.connect(KAG)
kws = keywords(query)
seen = set()

def add(name, typ, obs):
    if name and name not in seen:
        seen.add(name)
        facts.append({'name': name, 'type': typ, 'observation': deobs(obs)[:180]})

# 1) FTS по OR-набору ключевых слов с префиксами
if kws:
    fts = ' OR '.join(f'{w}*' for w in kws)
    try:
        for name, typ, obs in c.execute(
            "select e.name, e.type, e.observations from entities_fts f "
            "join entities e on e.rowid=f.rowid where entities_fts match ? limit ?",
            (fts, limit * 2)):
            add(name, typ, obs)
            if len(facts) >= limit: break
    except Exception:
        pass

# 2) fallback LIKE по отдельным словам
if len(facts) < limit:
    for w in kws:
        for name, typ, obs in c.execute(
            "select name, type, observations from entities where name like ? limit 3", (f'%{w}%',)):
            add(name, typ, obs)
        if len(facts) >= limit: break

print(json.dumps(facts[:limit], ensure_ascii=False))
