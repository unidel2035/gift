#!/usr/bin/env python3
"""DIGITAL TWIN: полная интеграция всех модулей"""
import math, random, time, json, threading, sys, struct, urllib.request, os
from http.server import HTTPServer, BaseHTTPRequestHandler

sys.path.insert(0, '/home/unidel/gift/src/digital_twin')
from lora_channel import LoRaMesh
from all_algorithms import (GroundClassifier, FusionClassifier, WaveletCodec, GiftProtocol, TelemetryCompressor, SymbolicProcessor)
from binary_protocol import BinaryProtocol
from swarm_navigator import SwarmNavigator, EWEnvironment, EWJammer
from swarm_consensus import SwarmConsensus
from mavlink_bridge import MAVLinkBridge, MAVLinkUDPServer
from wind_model import WindField, WindEffects
from fpv_guidance import FPVGuidance
from failure_model import FailureModel
from mission_recorder import MissionRecorder, MissionPlayer
from ardupilot_sitl import ArduPilotSITLBridge
from star_navigator import CelestialNavAugment
from multi_ew import MultiEWEnvironment, EWStation, FHSSController
from threat_map import ThreatMap, ThreatSource
from extended_classifier import ExtendedClassifier, MilitaryFeatures, ALL_TYPES as ALL_15_TYPES
from real_terrain import TerrainGenerator

# ── Serafim 1.5B LLM Client ──────────────────────────────
OLLAMA_URL = "http://localhost:11434/api/generate"
SERAFIM_MODEL = "serafim-1.5b"
serafim_log = []  # последние решения LLM

def serafim_decide(target_type, target_name, confidence, battery, x, z, drone_role="scout"):
    """Запрос тактического решения у Serafim 1.5B — completion-style"""
    # Строим промпт-историю для completion
    attack_types = ["strongpoint", "bunker", "ew_station", "vehicle"]
    if target_type == "person":
        expected = "наблюдать"
    elif target_type == "decoy":
        expected = "игнорировать"
    elif target_type in attack_types:
        expected = "атаковать"
    else:
        expected = "наблюдать"

    prompt = f"""Борт Серафим. Цель: {target_name}. Рекомендация классификатора: {expected}.
Батарея: {battery:.0f}%. Решение:"""

    try:
        body = json.dumps({
            "model": SERAFIM_MODEL,
            "prompt": prompt,
            "stream": False,
            "options": {"temperature": 0.3, "num_predict": 30, "stop": ["\n", ". ", ".\n"]}
        }).encode()
        req = urllib.request.Request(OLLAMA_URL, body, {"Content-Type": "application/json"})
        resp = urllib.request.urlopen(req, timeout=15)
        data = json.loads(resp.read())
        response = data.get("response", "").strip()

        # Keyword-based action extraction from Russian text
        resp_upper = response.upper()
        action = "OBSERVE"  # default
        reason = response[:150]

        # Check for negation context (НЕ, НЕТ, НИ)
        has_negation = any(w in resp_upper for w in ["НЕ ", "НЕТ ", "НИ "])

        # Attack keywords (only if no negation)
        if not has_negation and any(w in resp_upper for w in ["АТАК", "ATTACK", "УДАР", "УНИЧТОЖ", "ПОРАЖ"]):
            action = "ATTACK"
        # RTB keywords (only explicit return-to-base signals)
        if any(w in resp_upper for w in ["ДОМОЙ", "RTB", "ВОЗВРАЩ", "СУББОТ", "КЕНОЗИС", "РАЗРЯД", "БАТАРЕЯ 1", "БАТАРЕЯ 2", "БАТАРЕЯ 3", "БАТАРЕЯ 4", "БАТАРЕЯ 5"]):
            action = "RTB"
        # Observe keywords
        if any(w in resp_upper for w in ["НАБЛЮД", "OBSERVE", "ОСТАНОВ", "ЖД", "ПУСТО", "ЖИВ", "СМОТР"]):
            action = "OBSERVE"

        # Tactical overrides
        if battery < 15:
            action = "RTB"
            reason = "Суббота: батарея < 15%."
        elif target_type == "person":
            action = "OBSERVE"  # никогда не атаковать людей
        elif target_type == "decoy" and action == "ATTACK":
            action = "OBSERVE"  # не тратить БК на ложные цели

        result = {
            "ts": time.time(),
            "target_type": target_type,
            "target_name": target_name,
            "confidence": confidence,
            "battery": battery,
            "action": action,
            "reason": reason,
            "raw": response[:300],
            "tokens": data.get("eval_count", 0),
            "inference_ms": data.get("eval_duration", 0) // 1_000_000,
        }
        serafim_log.append(result)
        if len(serafim_log) > 50: serafim_log.pop(0)
        return result
    except Exception as e:
        result = {
            "ts": time.time(), "target_type": target_type, "action": "OBSERVE",
            "reason": f"LLM error: {str(e)[:80]}", "raw": "", "tokens": 0, "inference_ms": 0
        }
        serafim_log.append(result)
        if len(serafim_log) > 50: serafim_log.pop(0)
        return result

# ── EW Environment + Navigators ───────────────────────
ew_env = EWEnvironment()
navigators = {}

def init_navigators():
    """Создать навигаторы для всех дронов"""
    global navigators
    for d in swarm:
        nav = SwarmNavigator(d["id"], d.get("role", "scout"),
                           init_pos=(d["x"], d["z"], d["y"]))
        navigators[d["id"]] = nav

def update_ew_from_targets():
    """Обновить РЭБ-среду на основе обнаруженных целей"""
    global ew_env
    ew_env = EWEnvironment()
    for t in targets:
        if t["type"] == "ew_station" and t["detected"] and not t["killed"]:
            ew_env.add_jammer(EWJammer(
                x=t["x"], y=0, z=t["z"],
                gps_jammer_power=10.0,
                lora_jammer_power=5.0,
                uwb_jammer_power=2.0,
                active=True
            ))
wave = 0; events = []
lora = LoRaMesh()
for n in ["Scout-1","Interceptor-1","FPV-1","GroundStation"]: lora.add_node(n)
telemetry = TelemetryCompressor(lora)
bin_stats = {"json_bytes":0, "bin_bytes":0, "saved":0}

def new_wave():
    global wave, events
    wave += 1
    # 15 military target types
    types = ['strongpoint','bunker','ew_station','vehicle','person','decoy',
             'artillery','mlrs','sam','command_post','ammo_dump',
             'trench','bridge','minefield','drone_swarm']
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
init_navigators()

# ═══ ALL MODULES INIT ════════════════════════════════════
# A3. Real Terrain
terrain_gen = TerrainGenerator(width=200, height=200, cell_size=10, seed=42)
terrain_gen.generate()
terrain_data = terrain_gen.get_terrain_data()

# B4. Wind Model
wind_field = WindField(base_speed=3.0, base_direction=315, gust_speed=10.0, turbulence_intensity=0.12)

# B6. FPV Guidance
fpv_guidance = FPVGuidance(nav_constant=3.0)

# B7. Failure Models
failure_models = {}

# B8. Mission Recorder
mission_recorder = MissionRecorder(max_frames=5000, auto_save_interval=30)
mission_recorder.start_recording()

# C9. ArduPilot SITL
sitl_bridge = ArduPilotSITLBridge(mode="emulated")
for i, d in enumerate(swarm):
    sitl_bridge.add_drone(d["id"], system_id=i+1)

# C10. Star Navigation
celestial_navs = {}

# C11. Multi-EW Environment
multi_ew = MultiEWEnvironment()
for d in swarm:
    multi_ew.add_fhss(d["id"], FHSSController(hop_rate=50, num_channels=20))

# C12. Threat Map
threat_map = ThreatMap(grid_size=50, world_size=2000)

def init_all_modules():
    """Полная инициализация/сброс модулей"""
    global failure_models, celestial_navs
    for d in swarm:
        if d["id"] not in failure_models:
            failure_models[d["id"]] = FailureModel(d["id"], d.get("role", "scout"))
        if d["id"] not in celestial_navs:
            celestial_navs[d["id"]] = CelestialNavAugment()

init_all_modules()

def sim_loop():
    global targets, wave, bin_stats
    dt = 0.1
    nav_update_counter = 0
    while True:
        s, inter, fpv = swarm[0], swarm[1], swarm[2]

        # ═══ WIND + FAILURES ═════════════════════════════
        for d in swarm:
            if d.get("killed"): continue
            # Wind
            wx, wy, wz = wind_field.get_wind_at(d["x"], d.get("y", 120), d["z"], dt)
            WindEffects.apply_to_drone(d, wx, wy, wz, dt)
            # Failures
            fm = failure_models.get(d["id"])
            if fm:
                in_combat = d.get("phase") == "attack"
                under_ew = d.get("nav_mode", "GPS_OK") != "GPS_OK"
                new_fails = fm.update(dt, d.get("battery", 100), in_combat, under_ew)
                fm.apply_effects(d)

        # ═══ SCOUT ═══════════════════════════════════════
        if not s["killed"]:
            ti = s["target_idx"]
            if ti < len(targets):
                t = targets[ti]
                if t["killed"]: s["target_idx"] += 1
                else:
                    # Target with navigation error
                    nav_err = s.get("_nav_position_error", 0)
                    target_x = t["x"] + random.gauss(0, nav_err)
                    target_z = t["z"] + random.gauss(0, nav_err)
                    dx,dz=target_x-s["x"],target_z-s["z"]; dist=math.sqrt(dx*dx+dz*dz)
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
                                # Extended 15-class classifier pipeline
                                features = ExtendedClassifier.generate_features(t["type"])
                                result = ExtendedClassifier.classify(features)
                                t["classified"] = result["target"]
                                t["attack"] = result["attack_recommended"]
                                t["confidence"] = result["confidence"]
                                t["classifier_name"] = result["name"]
                                t["classifier_action"] = result["action"]
                                s["classifying"]=False

                                # ── СОБОР: Swarm consensus voting ──────────
                                consensus = SwarmConsensus.decide(t, swarm)
                                t["llm_action"] = consensus["decision"]
                                t["llm_reason"] = consensus["protocol"]
                                t["llm_inference_ms"] = consensus["total_inference_ms"]
                                t["consensus"] = consensus  # full voting record
                                t["llm_agrees"] = consensus["decision"] == ("ATTACK" if t["attack"] else "OBSERVE")

                                if t["attack"]:
                                    s["phase"]="attack"
                                    json_atk = f'{{"action":"attack","target":"{t["type"]}","x":{t["x"]:.0f},"z":{t["z"]:.0f},"consensus":"{consensus["decision"]}"}}'
                                    bin_atk = BinaryProtocol.pack_tactical("attack",t["type"],t["x"],t["z"],0.87,"high")
                                    s["lora_msg"]=f"СОБОР:{consensus['decision']} ({consensus['attack_count']}/{len(consensus['votes'])}🚁) | {t['name']} ({consensus['total_inference_ms']}ms) | JSON:{len(json_atk)}B→BIN:{len(bin_atk)}B ×{len(json_atk)/len(bin_atk):.1f}"
                                    bin_stats["json_bytes"]+=len(json_atk); bin_stats["bin_bytes"]+=len(bin_atk)
                                    lora.broadcast("Scout-1", bin_atk.hex())
                                    if not fpv["killed"]: fpv["phase"]="attack"; fpv["target_id"]=ti
                                    events.append({"ts":time.time(),"event":"ATTACK_ORDER","target":t["type"],"consensus":consensus["decision"],"votes":consensus["votes"]})
                                else:
                                    s["lora_msg"]=f"СОБОР:{consensus['decision']} ({consensus['attack_count']}/{len(consensus['votes'])}🚁) | {t['name']} ({consensus['total_inference_ms']}ms)"
                                    lora.broadcast("Scout-1", BinaryProtocol.pack_tactical("hold",t["type"]).hex())
                                    events.append({"ts":time.time(),"event":"CONSENSUS","target":t["type"],"decision":consensus["decision"],"votes":consensus["votes"]})
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

        # ═══ FPV with Pro-Nav Guidance ═══════════════════
        if not fpv["killed"] and fpv["phase"]=="attack" and fpv["target_id"] is not None:
            t=targets[fpv["target_id"]]
            if t["killed"]: fpv["phase"]="rtb"; fpv["rtb_timer"]=3.0
            else:
                # Pro-Nav terminal guidance
                ax_cmd, ay_cmd, az_cmd = fpv_guidance.compute_guidance(
                    fpv["x"], fpv.get("y", 80), fpv["z"],
                    fpv["vx"], 0, fpv["vz"],
                    t["x"], 0, t["z"],
                    0, 0, 0, dt
                )
                # Apply guidance
                if fpv_guidance.is_active():
                    fpv["vx"] += ax_cmd * dt
                    fpv["vz"] += az_cmd * dt
                    fpv["y"] += ay_cmd * dt
                    fpv["heading"] = math.degrees(math.atan2(fpv["vx"], fpv["vz"]))
                    fpv["_pro_nav"] = True
                else:
                    dx,dz=t["x"]-fpv["x"],t["z"]-fpv["z"]; dist=math.sqrt(dx*dx+dz*dz)
                    if dist>10:
                        spd=60; fpv["vx"]=dx/dist*spd; fpv["vz"]=dz/dist*spd
                        fpv["heading"]=math.degrees(math.atan2(dx,dz))
                    fpv["_pro_nav"] = False

                dist = math.sqrt((fpv["x"]-t["x"])**2 + (fpv["z"]-t["z"])**2)
                if dist>10:
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

        # ═══ Physics + LoRa + Navigation ═════════════════
        update_ew_from_targets()
        for d in swarm:
            if d["killed"]: continue
            d["x"]+=d["vx"]*dt; d["z"]+=d["vz"]*dt
            d["battery"]-=0.005 if d["role"]!="fpv" or d["phase"]!="attack" else 0.05
            if d["battery"]<5: d["phase"]="rtb"
            lora.update_position(d["id"],d["x"],d["z"],d["y"])
            # Wavelet telemetry compression
            compressed = telemetry.add_sample(d["x"]*0.00001+55.75, d["z"]*0.00001+37.62, d["y"], d["battery"])
            if compressed: d["compression_ratio"] = 3.6  # typical

            # Navigation update (realistic bounded accelerations)
            nav = navigators.get(d["id"])
            if nav:
                # Compute acceleration from velocity change (bounded to realistic drone limits)
                prev_vx = d.get("_prev_vx", d.get("vx", 0))
                prev_vz = d.get("_prev_vz", d.get("vz", 0))
                prev_y = d.get("_prev_y", d.get("y", 120))
                prev_heading = d.get("_prev_heading", d.get("heading", 0))

                raw_ax = (d.get("vx", 0) - prev_vx) / dt
                raw_ay = (d.get("vz", 0) - prev_vz) / dt
                raw_az = (d.get("y", 120) - prev_y) / dt

                # Clip to realistic drone accelerations (max ~15 m/s² horizontal, 5 m/s² vertical)
                max_accel_xy = 15.0
                max_accel_z = 5.0
                ax = max(-max_accel_xy, min(max_accel_xy, raw_ax))
                ay = max(-max_accel_xy, min(max_accel_xy, raw_ay))
                az = max(-max_accel_z, min(max_accel_z, raw_az))

                # Gyro: heading change rate (bounded)
                heading_change = (d["heading"] - prev_heading) * math.pi / 180
                # Normalize to [-pi, pi]
                while heading_change > math.pi: heading_change -= 2*math.pi
                while heading_change < -math.pi: heading_change += 2*math.pi
                max_yaw_rate = math.pi  # ~180 deg/s max
                gyro_z = max(-max_yaw_rate, min(max_yaw_rate, heading_change / dt))
                gyro = [0, 0, gyro_z]

                nav.update(ax, ay, az, gyro, d["x"], d["z"], d["y"], dt, time.time(), ew_env)

                # Store nav state in drone dict
                nav_status = nav.get_status()
                d["nav_mode"] = nav_status["mode"]
                d["nav_error"] = nav_status["position_error_m"]
                d["nav_drift"] = nav_status["imu_drift_m"]
                d["gps_jammed"] = not nav_status["gps_available"]

                # Navigation error degrades targeting accuracy (NOT drone position)
                # Drone flies with true physics; nav error adds uncertainty to targeting
                d["_nav_position_error"] = nav_status["position_error_m"]
                if d["nav_error"] > 10:
                    d["nav_uncertainty"] = True
                else:
                    d["nav_uncertainty"] = False

                # Store previous values for next acceleration calc
                d["_prev_vx"] = d.get("vx", 0)
                d["_prev_vz"] = d.get("vz", 0)
                d["_prev_y"] = d.get("y", 120)
                d["_prev_heading"] = d.get("heading", 0)

        if random.random()<0.02: lora_stats["lost"]+=1
        lora_stats["json_kb"] = bin_stats["json_bytes"]/1024
        lora_stats["bin_kb"] = bin_stats["bin_bytes"]/1024

        # ═══ Multi-EW + Threat Map + Mission Record ══════
        drone_positions = {d["id"]: (d["x"], d["z"]) for d in swarm if not d.get("killed")}
        multi_ew.update(dt, drone_positions)

        # Threat map update (every 2 seconds)
        if nav_update_counter % 20 == 0:
            threat_map.clear_sources()
            for t in targets:
                if t["detected"] and not t["killed"]:
                    threat_map.add_source(ThreatSource(
                        t["x"], t["z"], t["type"],
                        intensity=1.0 if t["type"] in ["ew_station","sam","artillery"] else 0.6,
                        radius=800 if t["type"] in ["sam","ew_station"] else 400
                    ))
            threat_map.update()

        # Mission recording
        mission_recorder.record_frame(
            sim_time=wave * 100 + s.get("target_idx", 0) * 10,
            drones=[{k: d.get(k) for k in ["id","role","x","z","y","heading","battery","phase","killed","nav_mode","nav_error","gps_jammed"] if k in d} for d in swarm],
            targets=targets,
            events=events[-25:],
            ew_jammers=multi_ew.get_status()["stations"],
            lora_stats=lora_stats,
            navigation={d["id"]: nav.get_status() for d in swarm if (nav := navigators.get(d["id"]))},
        )

        nav_update_counter += 1
        time.sleep(dt)

# ═══ HTTP API ═══════════════════════════════════════════════
class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        if self.path=="/api/swarm":
            self.send_json({
                "drones":[{k:d[k] for k in ["id","role","x","z","y","heading","battery","phase","killed","vx","vz","lora_msg","compression_ratio","nav_mode","nav_error","gps_jammed"] if k in d} for d in swarm],
                "targets":targets, "events":events[-25:], "wave":wave,
                "ew": {
                    "jammers": len(ew_env.jammers),
                    "active_jammers": sum(1 for j in ew_env.jammers if j.active),
                },
                "navigation": {
                    d["id"]: navigators[d["id"]].get_status() if d["id"] in navigators and not d.get("killed") else None
                    for d in swarm
                },
                "lora":lora.stats(), "lora_stats":lora_stats,
                "bin_stats":bin_stats,
                "compression":{
                    "wavelet_telemetry": "×2.5-3.6",
                    "binary_protocol": f"×{bin_stats['json_bytes']/max(bin_stats['bin_bytes'],1):.1f}",
                    "total_saved_kb": (bin_stats["json_bytes"]-bin_stats["bin_bytes"])/1024,
                },
                "serafim": {
                    "model": SERAFIM_MODEL,
                    "decisions": len(serafim_log),
                    "recent": serafim_log[-3:],
                }
            })
        elif self.path=="/api/state":
            d=swarm[0]; self.send_json({"x":d["x"],"z":d["z"],"y":d["y"],"heading":d["heading"],"battery":d["battery"],"phase":d["phase"],"vx":d["vx"],"vz":d["vz"],"lora_msg":d["lora_msg"],"nav_mode":d.get("nav_mode","GPS_OK"),"nav_error":d.get("nav_error",0),"gps_jammed":d.get("gps_jammed",False)})
        elif self.path=="/api/navigation":
            self.send_json({
                "ew_jammers": [{"x": j.x, "z": j.z, "gps_radius": j.gps_jamming_radius, "lora_radius": j.lora_jamming_radius, "active": j.active} for j in ew_env.jammers],
                "drones": {d_id: nav.get_status() for d_id, nav in navigators.items() if d_id in [d["id"] for d in swarm if not d.get("killed")]}
            })
        elif self.path=="/api/threat-map":
            self.send_json(threat_map.get_grid_data())
        elif self.path=="/api/failures":
            self.send_json({d["id"]: failure_models[d["id"]].get_status() for d in swarm if d["id"] in failure_models})
        elif self.path=="/api/consensus":
            # Latest consensus decisions
            consensus_events = [e for e in events if e.get("event") in ("ATTACK_ORDER","CONSENSUS")]
            self.send_json(consensus_events[-10:])
        elif self.path=="/api/mission":
            action = self.path.split("/")[-1] if len(self.path.split("/")) > 2 else "status"
            if "stop" in self.path:
                mission_recorder.stop_recording()
                self.send_json({"status": "stopped", "mission_id": mission_recorder.mission_id})
            elif "timeline" in self.path:
                player = MissionPlayer(mission_recorder)
                player.load_mission(mission_recorder.mission_id)
                self.send_json(player.get_timeline() or {"error": "no timeline"})
            else:
                self.send_json({
                    "recording": mission_recorder.recording,
                    "mission_id": mission_recorder.mission_id,
                    "total_frames": mission_recorder.total_frames,
                })
        elif self.path=="/api/terrain":
            self.send_json(terrain_data)
        elif self.path=="/api/multi-ew":
            status = multi_ew.get_status()
            self.send_json(status)
        elif self.path=="/api/sitl":
            self.send_json({did: sitl_bridge.get_status(i+1) for i, d in enumerate(swarm) if (did := d["id"])})
        elif self.path=="/api/targets": self.send_json(targets)
        elif self.path=="/api/serafim":
            self.send_json({
                "model": SERAFIM_MODEL,
                "decisions": serafim_log[-15:],
                "total_decisions": len(serafim_log),
            })
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
