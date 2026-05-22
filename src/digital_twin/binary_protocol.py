"""BINARY PROTOCOL — сжатие LLM-сообщений для LoRa"""

import struct

# ═══════════════════════════════════════════════════════════════
# PRE-SHARED CODEBOOK (зашит в каждом дроне)
# ═══════════════════════════════════════════════════════════════

ACTIONS = {
    0x01: "patrol",      0x02: "investigate", 0x03: "attack",
    0x04: "evade",       0x05: "rtb",          0x06: "hold",
    0x07: "relay_mode",  0x08: "assist",       0x09: "witness",
    0x0A: "sabbath",     0x0B: "decline",
}
ACTIONS_REV = {v:k for k,v in ACTIONS.items()}

TARGETS = {
    0x10: "strongpoint", 0x11: "bunker",    0x12: "ew_station",
    0x13: "vehicle",     0x14: "person",    0x15: "decoy",
    0x16: "enemy_drone", 0x17: "operator",  0x18: "obstacle",
    0x19: "civilian",
}
TARGETS_REV = {v:k for k,v in TARGETS.items()}

ROLES = {0x20: "scout", 0x21: "interceptor", 0x22: "fpv", 0x23: "relay"}
ROLES_REV = {v:k for k,v in ROLES.items()}

PRIORITIES = {0x00: "low", 0x40: "normal", 0x80: "high", 0xC0: "critical"}

# ═══════════════════════════════════════════════════════════════
# MESSAGE PACKER (JSON → binary)
# ═══════════════════════════════════════════════════════════════

class BinaryProtocol:
    """Сжатие тактических сообщений: 112 байт → 5-12 байт"""
    
    @staticmethod
    def pack_tactical(action, target=None, x=None, z=None, confidence=0, priority="normal", reason_code=0):
        """
        Упаковка тактического решения Serafim в бинарный пакет.
        
        Формат пакета (5-12 байт):
          [action:1B] [target:1B] [x:2B] [z:2B] [conf:1B] [flags:1B]
          flags = priority(2b) | has_reason(1b) | reserved(5b)
        """
        buf = bytearray()
        
        # Action (1 byte)
        buf.append(ACTIONS_REV.get(action, 0x00))
        
        # Target (1 byte, optional)
        if target:
            buf.append(TARGETS_REV.get(target, 0x00))
        else:
            buf.append(0x00)
        
        # Coordinates (2+2 bytes, optional)
        if x is not None and z is not None:
            buf.extend(struct.pack('<hh', int(x), int(z)))  # int16, little-endian
        else:
            buf.extend(b'\x00\x00\x00\x00')
        
        # Confidence (1 byte, 0-255)
        buf.append(min(255, int(confidence * 255)))
        
        # Flags (1 byte)
        prio_bits = {'low': 0x00, 'normal': 0x40, 'high': 0x80, 'critical': 0xC0}
        flags = prio_bits.get(priority, 0x40)
        if reason_code: flags |= 0x01  # has_reason
        buf.append(flags)
        
        return bytes(buf)
    
    @staticmethod
    def unpack_tactical(data):
        """Распаковка бинарного пакета → dict"""
        if len(data) < 5: return None
        
        action = ACTIONS.get(data[0], "unknown")
        target = TARGETS.get(data[1])
        x, z = None, None
        if len(data) >= 9:
            x, z = struct.unpack('<hh', data[2:6])
        conf = data[6] / 255.0 if len(data) >= 7 else 0
        flags = data[7] if len(data) >= 8 else 0
        priority = 'low'
        if flags & 0xC0 == 0xC0: priority = 'critical'
        elif flags & 0xC0 == 0x80: priority = 'high'
        elif flags & 0xC0 == 0x40: priority = 'normal'
        
        return {'action':action,'target':target,'x':x,'z':z,'confidence':conf,'priority':priority}
    
    @staticmethod
    def pack_gift(sender, receiver, gift_type, weight=1):
        """GIFT-сообщение: 6 байт"""
        buf = bytearray([0xF0])  # GIFT magic
        buf.append(ROLES_REV.get(sender, 0x20))
        buf.append(ROLES_REV.get(receiver, 0x20))
        buf.append({'data':0,'help':1,'witness':2,'attack':3,'decline':4,'sabbath':5}.get(gift_type,0))
        buf.append(min(255, weight))
        return bytes(buf)
    
    @staticmethod
    def pack_detect(drone_role, target_type, x, z, confidence):
        """DETECT: 8 байт"""
        buf = bytearray([0xD0])  # DETECT magic
        buf.append(ROLES_REV.get(drone_role, 0x20))
        buf.append(TARGETS_REV.get(target_type, 0x10))
        buf.extend(struct.pack('<hh', int(x), int(z)))
        buf.append(min(255, int(confidence * 255)))
        return bytes(buf)
    
    @staticmethod
    def pack_heartbeat(drone_role, battery_pct):
        """HEARTBEAT: 3 байта"""
        return bytes([0xE0, ROLES_REV.get(drone_role, 0x20), min(255, int(battery_pct))])
    
    @staticmethod
    def unpack(data):
        """Авто-определение типа пакета"""
        if not data: return None
        magic = data[0]
        if magic == 0x01: return BinaryProtocol.unpack_tactical(data)
        if magic == 0xD0 and len(data) >= 8:
            x,z = struct.unpack('<hh', data[3:7])
            return {'type':'detect','role':ROLES.get(data[1],'?'),'target':TARGETS.get(data[2],'?'),'x':x,'z':z,'conf':data[7]/255.0}
        if magic == 0xE0:
            return {'type':'heartbeat','role':ROLES.get(data[1],'?'),'battery':data[2]}
        if magic == 0xF0:
            return {'type':'gift','sender':ROLES.get(data[1],'?'),'receiver':ROLES.get(data[2],'?'),'gift':data[3],'weight':data[4]}
        return {'type':'unknown','data':data}

# ═══════════════════════════════════════════════════════════════
# COMPRESSION RATIO DEMO
# ═══════════════════════════════════════════════════════════════

def demo():
    """Показать сравнение JSON vs Binary"""
    tests = [
        ('Тактическое решение', 
         '{"action":"attack","target":"strongpoint","confidence":0.87,"xy":[300,200]}',
         BinaryProtocol.pack_tactical('attack','strongpoint',300,200,0.87,'high')),
        ('Обнаружение цели',
         'WITNESS|Scout-1|strongpoint|300|200',
         BinaryProtocol.pack_detect('scout','strongpoint',300,200,0.92)),
        ('Heartbeat',
         '{"type":"heartbeat","role":"scout","battery":78}',
         BinaryProtocol.pack_heartbeat('scout',78)),
        ('Gift-сообщение',
         'GIFT|Scout-1|Interceptor-1|witness|1',
         BinaryProtocol.pack_gift('scout','interceptor','witness',1)),
    ]
    
    print(f"{'Тип':<20} {'JSON (байт)':<12} {'Binary (байт)':<14} {'Экономия':<10} {'По LoRa':<12}")
    print("-"*70)
    for name, json_str, binary in tests:
        json_size = len(json_str.encode())
        bin_size = len(binary)
        ratio = json_size / bin_size
        time_json = json_size * 8 / 62500 * 1000  # ms at 62.5 kbps
        time_bin = bin_size * 8 / 62500 * 1000
        print(f"{name:<20} {json_size:<12} {bin_size:<14} ×{ratio:<8.1f} {time_json:.0f}ms→{time_bin:.0f}ms")

if __name__ == "__main__":
    demo()
