#!/usr/bin/env python3
"""
chip-oracle-uart.py — прямой UART диалог с tritgift.v для оракула

Аргументы: <port> <X0> <X1> <X2>
  port: /dev/ttyUSB1
  X0,X1,X2: -1, 0, или +1

Вывод: JSON {"y": [y0, y1, y2], "raw": "S:L A:00+ B:000 C:00+", "source": "chip"}
"""
import sys
import json
import re
import serial
import time

def send_cmd(s, cmd, wait=0.12):
    """Отправить команду и прочитать ответ."""
    s.write(cmd.encode())
    s.flush()
    time.sleep(wait)
    return s.read(100).decode('latin1', errors='replace')

def parse_trit3(t3):
    """'+00' → число в balanced ternary."""
    val = 0
    for c, w in zip(t3, [9, 3, 1]):
        if c == '+': val += w
        elif c == '-': val -= w
    return val

def sign_trit(v):
    return 1 if v > 0 else -1 if v < 0 else 0

def main():
    if len(sys.argv) < 5:
        print(json.dumps({"error": "usage: chip-oracle-uart.py <port> <X0> <X1> <X2>"}))
        sys.exit(1)

    port = sys.argv[1]
    X = [int(sys.argv[2]), int(sys.argv[3]), int(sys.argv[4])]

    try:
        s = serial.Serial(port, 115200, timeout=0.5)
    except Exception as e:
        print(json.dumps({"error": f"serial open: {e}"}))
        sys.exit(1)

    time.sleep(0.2)
    s.reset_input_buffer()

    # 1. Сброс
    send_cmd(s, 'r', 0.1)

    # 2. FSM ← X[0]
    if X[0] == 1:    send_cmd(s, '+', 0.1)
    elif X[0] == -1: send_cmd(s, '-', 0.1)
    else:            send_cmd(s, '0', 0.1)

    # 3. A ← X[1]
    if X[1] == 1:    send_cmd(s, 'a', 0.1)
    elif X[1] == -1: send_cmd(s, 'A', 0.1)

    # 4. B ← X[2]
    if X[2] == 1:    send_cmd(s, 'b', 0.1)
    elif X[2] == -1: send_cmd(s, 'B', 0.1)

    # 5. ACC = A+B
    send_cmd(s, 's', 0.1)

    # 6. Запрос статуса
    s.reset_input_buffer()
    raw_resp = send_cmd(s, '?', 0.3)
    s.close()

    # Парсим S:L A:t2t1t0 B:t2t1t0 C:t2t1t0
    raw_resp = raw_resp.strip()
    m_fsm = re.search(r'S:([KPL])', raw_resp)
    m_a   = re.search(r'A:([+\-0]{3})', raw_resp)
    m_c   = re.search(r'C:([+\-0]{3})', raw_resp)

    if not (m_fsm and m_a and m_c):
        print(json.dumps({"error": f"no S: response, got: {repr(raw_resp)}"}))
        sys.exit(1)

    fsm_char = m_fsm.group(1)
    y0 = 1 if fsm_char == 'L' else (-1 if fsm_char == 'K' else 0)
    y1 = sign_trit(parse_trit3(m_a.group(1)))
    y2 = sign_trit(parse_trit3(m_c.group(1)))

    print(json.dumps({
        "y": [y0, y1, y2],
        "raw": raw_resp,
        "source": "chip"
    }))

if __name__ == '__main__':
    main()
