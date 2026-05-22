"""ALL ALGORITHMS: wavelet codec + classifier + LoRa + gift protocol"""
import math, random, struct, json, time
from dataclasses import dataclass

# ═══════════════════════════════════════════════════════════════
# 1. WAVELET CODEC (Haar DWT + adaptive threshold)
# ═══════════════════════════════════════════════════════════════

class WaveletCodec:
    """DWT Хаара + адаптивный порог Данцевича + RLE-сжатие"""
    N = 128
    
    @staticmethod
    def haar_fwd(signal):
        n = len(signal); s = signal[:]
        while n > 1:
            h = n // 2
            for i in range(h):
                a, b = s[2*i], s[2*i+1]
                s[i] = (a + b) * 0.5
                s[h + i] = (a - b) * 0.5
            n = h
        return s
    
    @staticmethod
    def haar_inv(coeffs):
        n = len(coeffs); s = coeffs[:]
        m = 2
        while m <= n:
            h = m // 2; t = s[:]
            for i in range(h):
                s[2*i] = t[i] + t[h+i]
                s[2*i+1] = t[i] - t[h+i]
            m *= 2
        return s
    
    @staticmethod
    def noise_mad(coeffs):
        half = len(coeffs) // 2
        det = sorted([abs(coeffs[half + i]) for i in range(half)])
        return det[len(det)//2] / 0.6745
    
    @staticmethod
    def adaptive_threshold(noise_level, n):
        return noise_level * math.sqrt(2.0 * math.log(n))
    
    @classmethod
    def compress_telemetry(cls, gps_lat, gps_lon, alt, batt):
        """Сжать 4 канала телеметрии: 2048 байт → ~600 байт"""
        result = []
        for signal in [gps_lat, gps_lon, alt, batt]:
            coeffs = cls.haar_fwd(signal)
            noise = cls.noise_mad(coeffs)
            thresh = cls.adaptive_threshold(noise, len(signal))
            # Soft threshold
            for i in range(1, len(coeffs)):
                if abs(coeffs[i]) < thresh: coeffs[i] = 0
            # RLE
            rle = []; zeros = 0
            for c in coeffs[1:]:  # skip DC
                if c == 0:
                    zeros += 1
                    if zeros == 255: rle.append((0,255)); zeros = 0
                else:
                    if zeros: rle.append((0,zeros)); zeros = 0
                    rle.append((round(c*100), 0))
            if zeros: rle.append((0,zeros))
            result.append({'dc': round(coeffs[0]*100), 'rle': rle})
        return result

# ═══════════════════════════════════════════════════════════════
# 2. GROUND TARGET CLASSIFIER (decision tree)
# ═══════════════════════════════════════════════════════════════

class GroundClassifier:
    """Классификатор наземных целей: дерево решений"""
    
    TYPES = ['strongpoint','bunker','ew_station','vehicle','person','decoy','unknown']
    NAMES = ['ОПОРНИК','БЛИНДАЖ','РЭБ','ТЕХНИКА','ЧЕЛОВЕК','ЛОЖНАЯ ЦЕЛЬ','НЕИЗВЕСТНО']
    
    @staticmethod
    def classify(features):
        """Классифицировать цель по признакам"""
        scores = [0.0] * 7
        
        # RF + edges → EW station
        if features.get('rf_power',0) > 10 and features.get('edge_density',0) > 0.4:
            scores[2] += 3.0
        # Rectangular + trenches → strongpoint
        if features.get('rectangularity',0) > 0.6 and features.get('near_trench',False):
            scores[0] += 3.0
        # Small + rectangular + not green → bunker
        sz = features.get('area_m2',0)
        if 5 < sz < 30 and features.get('rectangularity',0) > 0.7 and features.get('green_ratio',1) < 0.3:
            scores[1] += 3.0
        # Elongated + hot + moving → vehicle
        if features.get('aspect_ratio',1) > 2.0 and features.get('temp_max',0) > 30:
            if features.get('speed_ms',0) > 1.0 or features.get('near_road',False):
                scores[3] += 3.0
        # Very small + warm → person
        if sz < 3 and 28 < features.get('temp_max',0) < 40:
            scores[4] += 3.0
        # Target-like geometry + COLD + no RF → decoy
        if (features.get('aspect_ratio',1) > 1.8 or features.get('rectangularity',0) > 0.5):
            if features.get('temp_max',100) < 22 and features.get('rf_power',100) < 2 and features.get('speed_ms',-1) < 0.5:
                scores[5] += 3.0
        
        best = max(range(7), key=lambda i: scores[i])
        conf = scores[best] / (sum(scores) + 0.001) if sum(scores) > 0 else 0
        
        return {
            'target': GroundClassifier.TYPES[best],
            'name': GroundClassifier.NAMES[best],
            'confidence': min(conf, 1.0),
            'scores': scores,
            'attack_recommended': best in [0,1,2,3],  # strongpoint, bunker, EW, vehicle
        }

# ═══════════════════════════════════════════════════════════════
# 3. SYMBOLIC PROCESSOR (KnoDL-style rules)
# ═══════════════════════════════════════════════════════════════

class SymbolicProcessor:
    """Быстрые символьные правила — детерминизм, без ML"""
    
    RULES = [
        # (feature, operator, threshold, result)
        ('area_m2', 'lt', 3, 'person'),
        ('area_m2', 'gt', 100, 'strongpoint'),
        ('rf_power', 'gt', 10, 'ew_station'),
        ('speed_ms', 'gt', 5, 'vehicle'),
        ('rectangularity', 'gt', 0.8, 'bunker'),
        ('temp_max', 'lt', 20, 'decoy'),
    ]
    
    @classmethod
    def quick_classify(cls, features):
        for feat, op, thr, result in cls.RULES:
            val = features.get(feat, 0)
            if op == 'gt' and val > thr: return result
            if op == 'lt' and val < thr: return result
        return 'unknown'

# ═══════════════════════════════════════════════════════════════
# 4. FUSION CLASSIFIER (Symbolic + Ground + voting)
# ═══════════════════════════════════════════════════════════════

class FusionClassifier:
    """Super classifier: Symbolic → Ground → Fusion vote"""
    
    @staticmethod
    def classify(target_type, drone_state):
        """Полный цикл классификации цели"""
        # Генерируем признаки цели на основе её типа и позиции дрона
        features = FusionClassifier._generate_features(target_type, drone_state)
        
        # Быстрый путь: символьные правила
        quick = SymbolicProcessor.quick_classify(features)
        if quick != 'unknown' and quick == target_type:
            return GroundClassifier.classify(features)
        
        # Полный путь: дерево решений
        return GroundClassifier.classify(features)
    
    @staticmethod
    def _generate_features(ttype, drone):
        """Сгенерировать реалистичные признаки для типа цели"""
        base = {
            'strongpoint': {'area_m2':random.uniform(80,200),'rectangularity':0.7,'green_ratio':0.3,'near_trench':True,'rf_power':2,'temp_max':random.uniform(18,28),'speed_ms':0,'near_road':False,'edge_density':0.2,'aspect_ratio':random.uniform(1.2,2.5)},
            'bunker': {'area_m2':random.uniform(8,25),'rectangularity':0.85,'green_ratio':0.1,'near_trench':False,'rf_power':0,'temp_max':random.uniform(14,22),'speed_ms':0,'near_road':True,'edge_density':0.1,'aspect_ratio':1.2},
            'ew_station': {'area_m2':random.uniform(20,80),'rectangularity':0.5,'green_ratio':0.3,'near_trench':False,'rf_power':random.uniform(15,30),'temp_max':random.uniform(35,55),'speed_ms':0,'near_road':True,'edge_density':0.7,'aspect_ratio':1.5},
            'vehicle': {'area_m2':random.uniform(15,45),'rectangularity':0.5,'green_ratio':0.2,'near_trench':False,'rf_power':random.uniform(1,5),'temp_max':random.uniform(45,80),'speed_ms':random.uniform(5,30),'near_road':True,'edge_density':0.3,'aspect_ratio':random.uniform(2.5,5)},
            'person': {'area_m2':random.uniform(0.5,2.5),'rectangularity':0.2,'green_ratio':0.4,'near_trench':False,'rf_power':0,'temp_max':random.uniform(34,38),'speed_ms':random.uniform(0.5,3),'near_road':False,'edge_density':0.1,'aspect_ratio':1.5},
            'decoy': {'area_m2':random.uniform(15,40),'rectangularity':0.5,'green_ratio':0.3,'near_trench':False,'rf_power':0,'temp_max':random.uniform(12,20),'speed_ms':0,'near_road':False,'edge_density':0.2,'aspect_ratio':random.uniform(2,4)},
        }
        return base.get(ttype, base['vehicle'])

# ═══════════════════════════════════════════════════════════════
# 5. GIFT PROTOCOL
# ═══════════════════════════════════════════════════════════════

class GiftProtocol:
    """Gift-протокол поверх LoRa: дар, евхаристия, суббота, свобода"""
    
    @staticmethod
    def format_gift(sender, receiver, gift_type, content, weight=1):
        return f"GIFT|{sender}|{receiver}|{gift_type}|{weight}|{content}"
    
    @staticmethod
    def format_detect(sender, target_type, x, z):
        return f"WITNESS|{sender}|{target_type}|{x:.0f}|{z:.0f}"
    
    @staticmethod
    def format_attack_order(sender, target_id, target_type):
        return f"ATTACK|{sender}|{target_id}|{target_type}"
    
    @staticmethod
    def format_sabbath(sender, battery_pct):
        return f"SABBATH|{sender}|battery={battery_pct:.0f}%"
    
    @staticmethod
    def format_eucharistia(sender, receiver):
        return f"EUCHARISTIA|{sender}|{receiver}|data_received"

# ═══════════════════════════════════════════════════════════════
# 6. TELEMETRY COMPRESSOR (wavelet codec integration)
# ═══════════════════════════════════════════════════════════════

class TelemetryCompressor:
    """Сжатие телеметрии через wavelet + отправка по LoRa"""
    
    def __init__(self, lora_mesh):
        self.lora = lora_mesh
        self.buffer = {'gps_lat':[],'gps_lon':[],'alt':[],'batt':[]}
        self.buf_size = 128
    
    def add_sample(self, gps_lat, gps_lon, alt, batt):
        for key, val in [('gps_lat',gps_lat),('gps_lon',gps_lon),('alt',alt),('batt',batt)]:
            self.buffer[key].append(val)
            if len(self.buffer[key]) > self.buf_size:
                self.buffer[key] = self.buffer[key][-self.buf_size:]
        
        # Сжимаем когда буфер полон
        if len(self.buffer['gps_lat']) >= self.buf_size:
            return WaveletCodec.compress_telemetry(
                self.buffer['gps_lat'][-self.buf_size:],
                self.buffer['gps_lon'][-self.buf_size:],
                self.buffer['alt'][-self.buf_size:],
                self.buffer['batt'][-self.buf_size:]
            )
        return None

