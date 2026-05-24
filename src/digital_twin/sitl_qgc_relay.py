#!/usr/bin/env python3
"""SITL → QGroundControl relay. Запусти и QGC увидит дрон."""
import dronekit_sitl, socket, time, threading, struct

sitl = dronekit_sitl.start_default()
conn = sitl.connection_string()
print(f'SITL: {conn}')
time.sleep(5)

host, port = conn[4:].split(':')
tcp = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
tcp.connect((host, int(port)))
tcp.settimeout(0.3)

udp = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
print(f'Sending MAVLink to UDP 14550...')

def relay():
    while True:
        try:
            data = tcp.recv(4096)
            if data: udp.sendto(data, ('127.0.0.1', 14550))
        except socket.timeout: pass
        except: break

threading.Thread(target=relay, daemon=True).start()

def cmd(c, p1=0,p2=0,p3=0,p4=0,p5=0,p6=0,p7=0):
    pl = struct.pack('<fffffffHHBB', p1,p2,p3,p4,p5,p6,p7, c, 255, 1, 0)
    h = struct.pack('<BBBBBB', 0xFD, len(pl), 0, 0, 0, 255)
    h += struct.pack('<BB', 1, 76)
    crc = 0xFFFF
    for b in h[1:] + pl: crc ^= (b<<8); crc = (crc<<1)^0x1021 if crc&0x8000 else crc<<1
    tcp.send(h + pl + struct.pack('<H', crc&0xFFFF))

time.sleep(2)
cmd(176, 1, 4); time.sleep(1)  # GUIDED
cmd(400, 1); time.sleep(2)      # ARM
cmd(22, 0,0,0,0,0,0,80); time.sleep(5)  # TAKEOFF

print('✅ Дрон в воздухе! QGC → UDP :14550')
import signal
signal.signal(signal.SIGINT, lambda *_: (sitl.stop(), exit()))
while True: time.sleep(10)
