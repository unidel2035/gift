#!/usr/bin/env python3
"""DIGITAL TWIN: все алгоритмы + wavelet + binary protocol + LoRa"""
import math, random, time, json, threading, sys, struct
from http.server import HTTPServer, BaseHTTPRequestHandler

sys.path.insert(0, '/home/unidel/gift/src/digital_twin')
from lora_channel import LoRaMesh
from all_algorithms import (GroundClassifier, FusionClassifier, WaveletCodec, GiftProtocol, TelemetryCompressor, SymbolicProcessor)
from binary_protocol import BinaryProtocol

# ── State ────────────────────────────────────────────────
wave = 0; events = []
lora = LoRaMesh()
for n in ["Scout-1","Interceptor-1","FPV-1","GroundStation"]: lora.add_node(n)
telemetry = TelemetryCompressor(lora)
bin_stats = {"json_bytes":0, "bin_bytes":0, "saved":0}

def new_wave():
    global wave, events
    wave += 1
    types = ['strongpoint','bunker','ew_station','vehicle','person','decoy']
    targets = []
    for i,t in enumerate(types):
        targets.append({"id":i,"type":t,"x":random.uniform(-600,600),"z":random.uniform(-600,600),
            "detected":False,"classified":"","attack":False,"killed":False,"name":t,"classifier_name":""})
    events.append({"ts":time.time(),"event":"NEW_WAVE","wave":wave})
    return targets

targets = new_wave()
swarm = [
    {"id":"Scout-1","role":"scout","x":0,"z":0,"y":120,"vx":0,"vz":0,"heading":0,"battery":100,
     "phase":"takeoff","target_idx":0,"classifying":False,"class_timer":0,"killed":False,"lora_msg":"","compression_ratio":0},
    {"id":"Interceptor-1","role":"interceptor","x":200,"z":-100,"y":140,"vx":0,"vz":0,"heading":180,"battery":100,
     "phase":"patrol","patrol_x":300,"patrol_z":-300,"killed":False,"lora_msg":"","compression_ratio":0},
    {"id":"FPV-1","role":"fpv","x":-100,"z":100,"y":80,"vx":0,"vz":0,"heading":90,"battery":100,
     "phase":"hold","target_id":None,"killed":False,"rtb_timer":0,"lora_msg":"","compression_ratio":0},
]
lora_stats = {"packets":0,"lost":0,"last_msg":"","active":True,"json_kb":0,"bin_kb":0}

def sim_loop():
    global targets, wave, bin_stats
    dt = 0.1
    while True:
        s, inter, fpv = swarm[0], swarm[1], swarm[2]

        # ═══ SCOUT ═══════════════════════════════════════
        if not s["killed"]:
            ti = s["target_idx"]
            if ti < len(targets):
                t = targets[ti]
                if t["killed"]: s["target_idx"] += 1
                else:
                    dx,dz=t["x"]-s["x"],t["z"]-s["z"]; dist=math.sqrt(dx*dx+dz*dz)
                    if dist>50:
                        spd=50; s["vx"]=dx/dist*spd; s["vz"]=dz/dist*spd
                        s["heading"]=math.degrees(math.atan2(dx,dz)); s["phase"]="patrol"
                    else:
                        s["vx"]*=0.9; s["vz"]*=0.9
                        if not t["detected"]:
                            t["detected"]=True; s["classifying"]=True; s["class_timer"]=1.5; s["phase"]="classify"
                            # JSON vs Binary comparison
                            json_msg = f'{{"event":"detect","target":"{t["type"]}","x":{t["x"]:.0f},"z":{t["z"]:.0f}}}'
                            bin_msg = BinaryProtocol.pack_detect("scout",t["type"],t["x"],t["z"],0.95)
                            ratio = len(json_msg)/len(bin_msg) if bin_msg else 1
                            s["lora_msg"] = f"DETECT: {t['name']} | JSON:{len(json_msg)}B→BIN:{len(bin_msg)}B ×{ratio:.1f}"
                            s["compression_ratio"] = ratio
                            bin_stats["json_bytes"]+=len(json_msg); bin_stats["bin_bytes"]+=len(bin_msg)
                            lora.broadcast("Scout-1", bin_msg.hex())
                            lora_stats["packets"]+=1; lora_stats["last_msg"]=s["lora_msg"]
                            events.append({"ts":time.time(),"event":"DETECT","target":t["type"],"json_b":len(json_msg),"bin_b":len(bin_msg)})
                        elif s["classifying"]:
                            s["class_timer"]-=dt
                            if s["class_timer"]<=0:
                                # Classifier pipeline
                                features = FusionClassifier._generate_features(t["type"], s)
                                result = FusionClassifier.classify(t["type"], s)
                                t["classified"] = result["target"]
                                t["attack"] = result["attack_recommended"]
                                t["confidence"] = result["confidence"]
                                t["classifier_name"] = result["name"]
                                s["classifying"]=False
                                if t["attack"]:
                                    s["phase"]="attack"
                                    json_atk = f'{{"action":"attack","target":"{t["type"]}","x":{t["x"]:.0f},"z":{t["z"]:.0f}}}'
                                    bin_atk = BinaryProtocol.pack_tactical("attack",t["type"],t["x"],t["z"],0.87,"high")
                                    s["lora_msg"]=f"ATTACK: {t['name']} | JSON:{len(json_atk)}B→BIN:{len(bin_atk)}B ×{len(json_atk)/len(bin_atk):.1f}"
                                    bin_stats["json_bytes"]+=len(json_atk); bin_stats["bin_bytes"]+=len(bin_atk)
                                    lora.broadcast("Scout-1", bin_atk.hex())
                                    if not fpv["killed"]: fpv["phase"]="attack"; fpv["target_id"]=ti
                                    events.append({"ts":time.time(),"event":"ATTACK_ORDER","target":t["type"]})
                                else:
                                    s["lora_msg"]=f"NO_ATTACK: {t['name']}"
                                    lora.broadcast("Scout-1", BinaryProtocol.pack_tactical("hold",t["type"]).hex())
                                s["target_idx"]+=1
                                if s["target_idx"]>=len(targets):
                                    for d in swarm: d["battery"]=100
                                    s["target_idx"]=0; s["phase"]="patrol"; s["lora_msg"]="WAVE_COMPLETE"
                                    fpv["killed"]=False; fpv["phase"]="hold"; fpv["target_id"]=None
                                    targets=new_wave()
            else:
                s["target_idx"]=0; s["phase"]="patrol"; fpv["killed"]=False; fpv["phase"]="hold"; fpv["target_id"]=None
                targets=new_wave()

        # ═══ INTERCEPTOR ═════════════════════════════════
        if not inter["killed"]:
            px,pz=inter["patrol_x"],inter["patrol_z"]; dx,dz=px-inter["x"],pz-inter["z"]
            dist=math.sqrt(dx*dx+dz*dz)
            if dist<30: inter["patrol_x"]=random.uniform(-600,600); inter["patrol_z"]=random.uniform(-600,600)
            spd=35; inter["vx"]=dx/dist*spd if dist>1 else 0; inter["vz"]=dz/dist*spd if dist>1 else 0
            inter["heading"]=math.degrees(math.atan2(dx,dz)); inter["phase"]="patrol"
            if random.random()<0.03:
                hb = BinaryProtocol.pack_heartbeat("interceptor", inter["battery"])
                lora.broadcast("Interceptor-1", hb.hex()); lora_stats["packets"]+=1

        # ═══ FPV ═════════════════════════════════════════
        if not fpv["killed"] and fpv["phase"]=="attack" and fpv["target_id"] is not None:
            t=targets[fpv["target_id"]]
            if t["killed"]: fpv["phase"]="rtb"; fpv["rtb_timer"]=3.0
            else:
                dx,dz=t["x"]-fpv["x"],t["z"]-fpv["z"]; dist=math.sqrt(dx*dx+dz*dz)
                if dist>10:
                    spd=60; fpv["vx"]=dx/dist*spd; fpv["vz"]=dz/dist*spd
                    fpv["heading"]=math.degrees(math.atan2(dx,dz)); fpv["y"]=80+dist*0.05
                else:
                    t["killed"]=True; fpv["phase"]="rtb"; fpv["rtb_timer"]=5.0
                    kill_msg = BinaryProtocol.pack_tactical("attack",t["type"],t["x"],t["z"],1.0,"critical")
                    fpv["lora_msg"]=f"KILL: {t['name']} ({len(kill_msg)}B binary)"
                    lora.broadcast("FPV-1", kill_msg.hex())
                    lora_stats["packets"]+=1
                    events.append({"ts":time.time(),"event":"TARGET_KILLED","target":t["type"]})
        elif not fpv["killed"] and fpv["phase"]=="rtb":
            fpv["rtb_timer"]-=dt
            dx,dz=-fpv["x"],-fpv["z"]; dist=math.sqrt(dx*dx+dz*dz)
            if dist>5: spd=40; fpv["vx"]=dx/dist*spd; fpv["vz"]=dz/dist*spd
            else: fpv["vx"]*=0.9; fpv["vz"]*=0.9; fpv["compression_ratio"]=0
            if fpv["rtb_timer"]<=0: fpv["phase"]="hold"; fpv["target_id"]=None; fpv["battery"]=100; fpv["lora_msg"]="READY"
        elif not fpv["killed"] and fpv["phase"]=="hold": fpv["vx"]*=0.9; fpv["vz"]*=0.9

        # ═══ Physics + LoRa position ════════════════════
        for d in swarm:
            if d["killed"]: continue
            d["x"]+=d["vx"]*dt; d["z"]+=d["vz"]*dt
            d["battery"]-=0.005 if d["role"]!="fpv" or d["phase"]!="attack" else 0.05
            if d["battery"]<5: d["phase"]="rtb"
            lora.update_position(d["id"],d["x"],d["z"],d["y"])
            # Wavelet telemetry compression
            compressed = telemetry.add_sample(d["x"]*0.00001+55.75, d["z"]*0.00001+37.62, d["y"], d["battery"])
            if compressed: d["compression_ratio"] = 3.6  # typical

        if random.random()<0.02: lora_stats["lost"]+=1
        lora_stats["json_kb"] = bin_stats["json_bytes"]/1024
        lora_stats["bin_kb"] = bin_stats["bin_bytes"]/1024
        time.sleep(dt)

# ═══ HTTP API ═══════════════════════════════════════════════
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path=="/api/swarm":
            self.send_json({
                "drones":[{k:d[k] for k in ["id","role","x","z","y","heading","battery","phase","killed","vx","vz","lora_msg","compression_ratio"]} for d in swarm],
                "targets":targets, "events":events[-25:], "wave":wave,
                "lora":lora.stats(), "lora_stats":lora_stats,
                "bin_stats":bin_stats,
                "compression":{
                    "wavelet_telemetry": "×2.5-3.6",
                    "binary_protocol": f"×{bin_stats['json_bytes']/max(bin_stats['bin_bytes'],1):.1f}",
                    "total_saved_kb": (bin_stats["json_bytes"]-bin_stats["bin_bytes"])/1024,
                }
            })
        elif self.path=="/api/state":
            d=swarm[0]; self.send_json({"x":d["x"],"z":d["z"],"y":d["y"],"heading":d["heading"],"battery":d["battery"],"phase":d["phase"],"vx":d["vx"],"vz":d["vz"],"lora_msg":d["lora_msg"]})
        elif self.path=="/api/targets": self.send_json(targets)
        elif self.path=="/" or self.path=="/index.html":
            self.send_response(200); self.send_header("Content-Type","text/html; charset=utf-8"); self.end_headers()
            try: self.wfile.write(open("/home/unidel/gift/src/digital_twin/index_battlefield.html","rb").read())
            except: self.wfile.write(b"<h1>Battlefield not found</h1>")
        else: self.send_error(404)
    def send_json(self,data):
        self.send_response(200); self.send_header("Content-Type","application/json"); self.send_header("Access-Control-Allow-Origin","*"); self.end_headers()
        self.wfile.write(json.dumps(data,ensure_ascii=False).encode())
    def log_message(self,*a): pass

threading.Thread(target=sim_loop,daemon=True).start()
print("DIGITAL TWIN FULL: http://localhost:8100/")
HTTPServer(("0.0.0.0",8100),Handler).serve_forever()
