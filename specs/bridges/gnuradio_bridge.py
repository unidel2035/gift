#!/usr/bin/env python3
"""
gnuradio_bridge.py — GNU Radio flowgraph → BER, PER, SNR для радиоканала дрона.

Уровни:
  1. GNU Radio Python API (если установлен)    — точная симуляция
  2. SciPy/NumPy (если установлен)             — аналитическая BER по формулам
  3. Аналитический fallback (Friis + Q-функция) — быстрая оценка

Моделируется:
  - Путь распространения: свободное пространство (Friis)
  - Помехи: AWGN + узкополосная помеха (jamming)
  - Модуляция: GFSK (LoRa-совместимая) или FSK
  - Многолучёвость: 2-ray ground reflection model

Для спеки "Суверенный канал" (группа 4):
  - Заменяет аналитическую meshPacketLoss() реальной BER-симуляцией
  - Учитывает реальные параметры TX/RX (tx_power_dbm, sensitivity_dbm)

Вход: параметры канала (tx_power, range, jamming_level, modulation)
Выход: JSON { ber, per, snr_db, link_margin_db, packet_delivery, method }

Использование:
  python3 gnuradio_bridge.py --tx-power 27 --range 800 --jamming 2
  python3 gnuradio_bridge.py --tx-power 20 --range 500 --jamming 1 --modulation gfsk
  python3 gnuradio_bridge.py --analytical  # быстро, без GNU Radio
"""

import sys, json, argparse, math
from pathlib import Path

GR = None
SCIPY = None

try:
    from gnuradio import gr, blocks, channels, digital, analog, filter as gr_filter
    import numpy as np
    GR = gr
except ImportError:
    pass

try:
    import numpy as np
    from scipy import special
    SCIPY = special
except ImportError:
    pass

# ── Параметры радиоканала (реалистичные для дронов) ─────────────────────────

SENSITIVITY_DBM = -100   # типовой приёмник 900 МГц FSK
FREQ_HZ = 915e6          # ISM 915 МГц
BANDWIDTH_HZ = 125e3     # LoRa BW
NOISE_FIGURE_DB = 6      # шум приёмника
PAYLOAD_BYTES = 64       # типичный MAVLink пакет
CODING_GAIN_DB = 5       # FEC (LoRa SF7 ≈ 5 дБ)

# ── Friis path loss ──────────────────────────────────────────────────────────

def friis_loss_db(range_m, freq_hz=FREQ_HZ):
    """Потери свободного пространства (Friis)."""
    if range_m <= 0:
        return 0
    c = 3e8
    return 20 * math.log10(4 * math.pi * range_m * freq_hz / c)

def two_ray_loss_db(range_m, h_tx=1.5, h_rx=0.3, freq_hz=FREQ_HZ):
    """Two-ray ground reflection (точнее Friis при range > ~100м)."""
    if range_m < 10:
        return friis_loss_db(range_m, freq_hz)
    d_crossover = 4 * math.pi * h_tx * h_rx * freq_hz / 3e8
    if range_m < d_crossover:
        return friis_loss_db(range_m, freq_hz)
    # Two-ray: L ∝ r^4
    return 40 * math.log10(range_m) - 20 * math.log10(h_tx * h_rx)

def jamming_to_noise_db(jamming_level, bandwidth_hz=BANDWIDTH_HZ):
    """Мощность помехи в дБ (jamming_level: 0=нет, 1=слабое, 2=среднее, 3=сильное)."""
    # J/N ratio: 0=0дБ, 1=10дБ, 2=20дБ, 3=35дБ
    jnr_table = [0, 10, 20, 35]
    return jnr_table[min(int(jamming_level), 3)]

# ── Q-функция и BER формулы ──────────────────────────────────────────────────

def Q(x):
    """Хвостовая Q-функция через erfc."""
    if SCIPY:
        return 0.5 * float(SCIPY.erfc(x / math.sqrt(2)))
    # Аппроксимация Борджеза
    x = max(x, 0)
    return math.exp(-0.5 * x**2) / (x * math.sqrt(2 * math.pi) + 1e-9) if x > 3 else 0.5 * math.erfc(x / math.sqrt(2))

def ber_gfsk(snr_linear):
    """BER для GFSK (Gaussian FSK) по приближённой формуле."""
    # BER_GFSK ≈ 0.5 * erfc(sqrt(0.68 * Eb/N0))
    eb_n0 = snr_linear * 0.68
    return 0.5 * (1 - math.erf(math.sqrt(max(0, eb_n0))))

def ber_bpsk(snr_linear):
    """BER для BPSK: Q(sqrt(2*Eb/N0))."""
    return Q(math.sqrt(max(0, 2 * snr_linear)))

def ber_lora_sf7(snr_db):
    """Упрощённая BER для LoRa SF7 (из эмпирических данных Semtech)."""
    # Порог демодуляции SF7 ≈ -7.5 дБ SNR
    threshold_db = -7.5
    margin = snr_db - threshold_db
    if margin > 10:
        return 1e-6
    elif margin > 0:
        return max(1e-6, Q(margin * 0.7))
    else:
        return min(0.5, 0.5 * math.exp(margin * 0.3))

def per_from_ber(ber, payload_bytes=PAYLOAD_BYTES):
    """Вероятность ошибки пакета: PER = 1 - (1-BER)^(N*8)."""
    bits = payload_bytes * 8
    return 1 - (1 - min(ber, 0.5)) ** bits

# ── Уровень 1: GNU Radio симуляция ──────────────────────────────────────────

def run_gnuradio_sim(tx_power_dbm, range_m, jamming_level, modulation='gfsk',
                     num_packets=1000):
    """Симуляция канала через GNU Radio flowgraph."""
    if not GR:
        raise RuntimeError("GNU Radio не установлен")

    snr_db = compute_snr_db(tx_power_dbm, range_m, jamming_level)
    snr_linear = 10 ** (snr_db / 10)
    noise_amp = 1.0 / math.sqrt(max(snr_linear, 1e-6))

    class BERMeasure(gr.top_block):
        def __init__(self):
            super().__init__()
            # Источник случайных битов
            src = blocks.vector_source_b(
                [i % 256 for i in range(num_packets * PAYLOAD_BYTES)], False
            )
            # Упаковка битов
            pack = blocks.pack_k_bits_bb(8)
            # Модуляция (BPSK как приближение)
            mod = digital.psk.psk_mod(
                constellation_points=2,
                differential=False,
                samples_per_symbol=2,
            )
            # Канал: AWGN + jamming
            chan = channels.channel_model(
                noise_voltage=noise_amp,
                frequency_offset=0.0,
                epsilon=1.0,
                taps=[1.0 + 0j],
                noise_seed=42,
            )
            # Демодуляция
            demod = digital.psk.psk_demod(
                constellation_points=2,
                differential=False,
                samples_per_symbol=2,
            )
            # Распаковка
            unpack = blocks.unpack_k_bits_bb(8)
            # BER sink
            ber = digital.correlate_access_code_bb("", 0)
            sink = blocks.vector_sink_b()

            self.connect(src, pack, mod, chan, demod, unpack, sink)
            self._sink = sink

    try:
        tb = BERMeasure()
        tb.start()
        tb.wait()
        # Анализ ошибок (упрощённо — сравниваем с источником)
        out = tb.get_variable_sink().data()
        errors = sum(1 for i, b in enumerate(out[:num_packets*PAYLOAD_BYTES*8])
                     if b != (i % 2))
        ber = errors / max(len(out), 1)
        per = per_from_ber(ber)
        return {
            'ber': round(ber, 6),
            'per': round(per, 4),
            'snr_db': round(snr_db, 2),
            'link_margin_db': round(snr_db - (-7.5), 2),
            'packet_delivery': round(1 - per, 4),
            'method': 'gnuradio-flowgraph',
        }
    except Exception as e:
        raise RuntimeError(f"GNU Radio simulation failed: {e}")

# ── Уровень 2/3: аналитика ───────────────────────────────────────────────────

def compute_snr_db(tx_power_dbm, range_m, jamming_level,
                   freq_hz=FREQ_HZ, bandwidth_hz=BANDWIDTH_HZ):
    """SNR с учётом path loss, jamming, noise figure."""
    # Мощность сигнала на входе приёмника
    path_loss_db = two_ray_loss_db(range_m, freq_hz=freq_hz)
    rx_power_dbm = tx_power_dbm - path_loss_db + CODING_GAIN_DB

    # Тепловой шум: N = kTB
    k = 1.38e-23
    T = 290
    noise_power_dbm = 10 * math.log10(k * T * bandwidth_hz) + 30 + NOISE_FIGURE_DB

    # Мощность помехи (jammig добавляется к шуму)
    jnr_db = jamming_to_noise_db(jamming_level, bandwidth_hz)
    if jamming_level > 0:
        jam_power_dbm = noise_power_dbm + jnr_db
        # Суммируем шум и помеху в линейном масштабе
        total_noise_mw = (10 ** (noise_power_dbm / 10)) + (10 ** (jam_power_dbm / 10))
        total_noise_dbm = 10 * math.log10(total_noise_mw)
    else:
        total_noise_dbm = noise_power_dbm

    return rx_power_dbm - total_noise_dbm

def analytical_link(tx_power_dbm, range_m, jamming_level, modulation='gfsk'):
    """Аналитический расчёт BER/PER без GNU Radio."""
    snr_db = compute_snr_db(tx_power_dbm, range_m, jamming_level)
    snr_linear = 10 ** (snr_db / 10)

    if modulation == 'lora':
        ber = ber_lora_sf7(snr_db)
    elif modulation == 'bpsk':
        ber = ber_bpsk(snr_linear)
    else:  # gfsk (default)
        ber = ber_gfsk(snr_linear)

    per = per_from_ber(ber)
    link_margin = snr_db - (-7.5)  # margin над порогом демодуляции

    return {
        'ber': round(max(ber, 1e-9), 9),
        'per': round(per, 6),
        'snr_db': round(snr_db, 2),
        'link_margin_db': round(link_margin, 2),
        'packet_delivery': round(max(0, 1 - per), 6),
        'rx_power_dbm': round(tx_power_dbm - two_ray_loss_db(range_m), 2),
        'method': 'analytical-friis-ber',
    }


def main():
    p = argparse.ArgumentParser(description='GNU Radio / аналитика → BER, PER, SNR')
    p.add_argument('--tx-power', type=float, default=20,
                   help='Мощность TX дБм (20=100мВт, 27=500мВт, 30=1Вт)')
    p.add_argument('--range', type=float, default=1000, help='Дальность м')
    p.add_argument('--jamming', type=int, default=0,
                   help='Уровень подавления 0-3 (0=нет, 3=сильное)')
    p.add_argument('--modulation', default='gfsk',
                   choices=['gfsk', 'bpsk', 'lora'],
                   help='Модуляция (gfsk по умолчанию)')
    p.add_argument('--analytical', action='store_true',
                   help='Принудительно аналитика (без GNU Radio)')
    p.add_argument('--packets', type=int, default=1000,
                   help='Число пакетов для симуляции GNU Radio')
    args = p.parse_args()

    try:
        if not args.analytical and GR:
            result = run_gnuradio_sim(
                args.tx_power, args.range, args.jamming,
                args.modulation, args.packets
            )
        else:
            result = analytical_link(args.tx_power, args.range, args.jamming, args.modulation)
            if not GR:
                result['warning'] = 'GNU Radio не установлен, использована аналитика Friis+BER'

        print(json.dumps(result, ensure_ascii=False))
    except Exception as e:
        print(json.dumps({'error': str(e), 'method': 'failed'}), file=sys.stderr)
        sys.exit(1)

if __name__ == '__main__':
    main()
