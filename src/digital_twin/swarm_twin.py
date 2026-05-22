#!/usr/bin/env python3
"""SWARM TWIN: рой из 3 дронов — scout, interceptor, fpv"""
import math, random, time, json, threading
from http.server import HTTPServer, BaseHTTPRequestHandler

# ── Targets ────────────────────────────────────────────────────
targets = [
    {"id":0,"type":"strongpoint","x":300,"z":200,"detected":False,"classified":"","attack":False,"killed":False},
    {"id":1,"type":"bunker","x":-200,"z":350,"detected":False,"classified":"","attack":False,"killed":False},
    {"id":2,"type":"ew_station","x":500,"z":-300,"detected":False,"classified":"","attack":False,"killed":False},
    {"id":3,"type":"vehicle","x":-400,"z":-200,"detected":False,"classified":"","attack":False,"killed":False},
    {"id":4,"type":"person","x":100,"z":500,"detected":False,"classified":"","attack":False,"killed":False},
    {"id":5,"type":"decoy","x":-500,"z":100,"detected":False,"classified":"","attack":False,"killed":False},
]

# ── Swarm ──────────────────────────────────────────────────────
swarm = [
    {"id":"Scout-1","role":"scout","x":0,"z":0,"y":120,"vx":0,"vz":0,"heading":0,"battery":92,
     "phase":"patrol","target_idx":0,"search_angle":0,"classifying":False,"class_timer":0,"killed":False},
    {"id":"Interceptor-1","role":"interceptor","x":100,"z":-100,"y":140,"vx":0,"vz":0,"heading":180,"battery":88,
     "phase":"patrol","patrol_x":200,"patrol_z":-200,"classifying":False,"class_timer":0,"killed":False},
    {"id":"FPV-1","role":"fpv","x":-100,"z":-100,"y":80,"vx":0,"vz":0,"heading":90,"battery":95,
     "phase":"hold","target_id":None,"classifying":False,"class_timer":0,"killed":False},
]
events = []

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path == "/" or self.path == "/index.html":
            self.send_response(200); self.send_header("Content-Type","text/html; charset=utf-8"); self.end_headers()
            self.wfile.write(open("/home/unidel/gift/src/digital_twin/index_battlefield.html").read().encode())
            return
        if self.path == "/api/swarm":
            self.send_json({"drones":[
                {"id":d["id"],"role":d["role"],"x":d["x"],"z":d["z"],"y":d["y"],
                 "heading":d["heading"],"battery":d["battery"],"phase":d["phase"],"killed":d["killed"],
                 "vx":d["vx"],"vz":d["vz"]} for d in swarm],
                "targets":[{"id":t["id"],"type":t["type"],"x":t["x"],"z":t["z"],
                 "detected":t["detected"],"classified":t["classified"],"attack":t["attack"],"killed":t["killed"]} for t in targets],
                "events":events[-15:]})
        elif self.path == "/api/state":
            d = swarm[0]
            self.send_json({"x":d["x"],"z":d["z"],"y":d["y"],"heading":d["heading"],"battery":d["battery"],
                "phase":d["phase"],"vx":d["vx"],"vz":d["vz"],"pitch":0,"roll":0,"mode":"AUTO","classifying":d["classifying"]})
        elif self.path == "/api/targets":
            self.send_json([{"id":t["id"],"type":t["type"],"x":t["x"],"z":t["z"],
                "detected":t["detected"],"classified":t["classified"],"attack":t["attack"],"name":t["type"]} for t in targets])
        else:
            self.send_error(404)
    def send_json(self, data):
        self.send_response(200); self.send_header("Content-Type","application/json")
        self.send_header("Access-Control-Allow-Origin","*"); self.end_headers()
        self.wfile.write(json.dumps(data,ensure_ascii=False).encode())
    def log_message(self,*a): pass

def sim_loop():
    dt = 0.1
    while True:
        # ═══ SCOUT: search and classify ═══════════════════════════════
        scout = swarm[0]
        if not scout["killed"]:
            ti = scout["target_idx"]
            if ti < len(targets):
                t = targets[ti]
                if t["killed"]:  # skip killed targets
                    scout["target_idx"] += 1
                else:
                    dx, dz = t["x"]-scout["x"], t["z"]-scout["z"]
                    dist = math.sqrt(dx*dx+dz*dz)
                    if dist > 50:
                        spd = 50.0
                        scout["vx"] = dx/dist*spd; scout["vz"] = dz/dist*spd
                        scout["heading"] = math.degrees(math.atan2(dx, dz))
                        scout["phase"] = "patrol"
                    else:
                        scout["vx"] *= 0.9; scout["vz"] *= 0.9
                        if not t["detected"]:
                            t["detected"] = True; scout["classifying"] = True; scout["class_timer"] = 1.5
                            scout["phase"] = "classify"
                            events.append({"ts":time.time(),"event":"DETECT","drone":"Scout-1","target":t["type"]})
                        elif scout["classifying"] and scout["class_timer"] > 0:
                            scout["class_timer"] -= dt
                            if scout["class_timer"] <= 0:
                                t["classified"] = t["type"]
                                t["attack"] = t["type"] in ["strongpoint","bunker","ew_station","vehicle"]
                                scout["classifying"] = False
                                if t["attack"]:
                                    scout["phase"] = "attack"  # signal FPV
                                    events.append({"ts":time.time(),"event":"ATTACK_ORDER","drone":"Scout-1","target":t["type"]})
                                    # Dispatch FPV!
                                    fpv = swarm[2]
                                    if not fpv["killed"]:
                                        fpv["phase"] = "attack"
                                        fpv["target_id"] = ti
                                        events.append({"ts":time.time(),"event":"FPV_LAUNCH","drone":"FPV-1","target":t["type"]})
                                else:
                                    events.append({"ts":time.time(),"event":"NO_ATTACK","drone":"Scout-1","target":t["type"]})
                                scout["target_idx"] += 1
                                if scout["target_idx"] >= len(targets):
                                    scout["phase"] = "rtb"
            else:
                scout["vx"] *= 0.95; scout["vz"] *= 0.95; scout["phase"] = "rtb"

        # ═══ INTERCEPTOR: patrol perimeter ═══════════════════════════
        inter = swarm[1]
        if not inter["killed"]:
            px, pz = inter["patrol_x"], inter["patrol_z"]
            dx, dz = px-inter["x"], pz-inter["z"]
            dist = math.sqrt(dx*dx+dz*dz)
            if dist < 30:
                # Switch patrol point
                inter["patrol_x"] = random.uniform(-600,600)
                inter["patrol_z"] = random.uniform(-600,600)
            spd = 35.0
            inter["vx"] = dx/dist*spd if dist>1 else 0
            inter["vz"] = dz/dist*spd if dist>1 else 0
            inter["heading"] = math.degrees(math.atan2(dx, dz))
            inter["phase"] = "patrol"

        # ═══ FPV: hold → attack when ordered ════════════════════════
        fpv = swarm[2]
        if not fpv["killed"] and fpv["phase"] == "attack" and fpv["target_id"] is not None:
            t = targets[fpv["target_id"]]
            if t["killed"]:
                fpv["phase"] = "rtb"
            else:
                dx, dz = t["x"]-fpv["x"], t["z"]-fpv["z"]
                dist = math.sqrt(dx*dx+dz*dz)
                if dist > 10:
                    spd = 60.0  # FPV fast!
                    fpv["vx"] = dx/dist*spd; fpv["vz"] = dz/dist*spd
                    fpv["heading"] = math.degrees(math.atan2(dx, dz))
                    fpv["y"] = 80 + dist*0.05  # dive toward target
                else:
                    # IMPACT!
                    t["killed"] = True
                    fpv["killed"] = True
                    fpv["vx"] = 0; fpv["vz"] = 0
                    fpv["phase"] = "dead"
                    events.append({"ts":time.time(),"event":"TARGET_KILLED","drone":"FPV-1","target":t["type"]})
        elif not fpv["killed"] and fpv["phase"] != "attack":
            fpv["phase"] = "hold"
            fpv["vx"] *= 0.9; fpv["vz"] *= 0.9

        # ═══ Physics + battery ═════════════════════════════════════
        for d in swarm:
            if d["killed"]: continue
            d["x"] += d["vx"]*dt; d["z"] += d["vz"]*dt
            d["battery"] -= 0.015 if d["role"]!="fpv" or d["phase"]!="attack" else 0.1
            if d["battery"] < 20: d["phase"] = "rtb"
            if d["battery"] < 0: d["killed"] = True

        time.sleep(dt)

threading.Thread(target=sim_loop, daemon=True).start()
print("SWARM TWIN: 3 drones — http://localhost:8100/api/swarm")
HTTPServer(("0.0.0.0",8100), Handler).serve_forever()
