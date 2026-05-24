#!/usr/bin/env python3
"""serafim_game.py — Единый сервер: 3D игра + Serafim + QGroundControl"""
import json, time, math, threading, socket, struct, sys, os
from http.server import HTTPServer, BaseHTTPRequestHandler

sys.path.insert(0, os.path.dirname(__file__))
from serafim_agent import SerafimAgent, TacticalSituation

# ═══ ФИЗИКА ═══
class Drone:
    def __init__(self):
        self.x=0;self.y=100;self.z=0;self.vx=0;self.vy=0;self.vz=0
        self.roll=0;self.pitch=0;self.yaw=0;self.armed=False;self.battery=100
    def update(self, dt, ctrl=None):
        if not self.armed: return
        c=ctrl or {};t=min(1,max(0,c.get('throttle',0.6)))
        thrust=30*t;self.vy+= (thrust-14.7)*dt/1.5;self.vy*=0.98
        self.y+=self.vy*dt;self.y=max(0.5,min(500,self.y))
        fwd=c.get('pitch',0.2)*20;yaw_c=c.get('yaw',0)
        self.yaw+=yaw_c*2*dt;self.vx=math.sin(self.yaw)*fwd;self.vz=math.cos(self.yaw)*fwd
        self.x+=self.vx*dt;self.z+=self.vz*dt
        self.battery-=(abs(t)*0.03+0.01)*dt;self.battery=max(0,self.battery)
        if self.battery<=0: self.armed=False
    def arm(self): self.armed=True;self.y=100;self.battery=100

# ═══ ВРАГИ ═══
targets=[
    {"id":"T1","role":"танк","x":400,"z":200,"dead":False},
    {"id":"T2","role":"РЭБ","x":-300,"z":500,"dead":False},
    {"id":"T3","role":"опорник","x":600,"z":-300,"dead":False},
    {"id":"T4","role":"ПВО","x":-500,"z":-400,"dead":False},
    {"id":"T5","role":"техника","x":200,"z":-600,"dead":False},
]

# ═══ MAVLINK ═══
def start_mavlink(drone):
    from pymavlink import mavutil
    class UDPSender:
        def __init__(self,h,p):self.sock=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);self.addr=(h,p)
        def write(self,d):self.sock.sendto(d,self.addr)
    s=UDPSender('127.0.0.1',14550)
    m=mavutil.mavlink.MAVLink(s,srcSystem=1,srcComponent=1)
    def _b():
        while True:
            d=drone;bm=81 if d.armed else 0
            m.heartbeat_send(2,3,bm,0,4)
            m.sys_status_send(0,0,0,0,11000,-1,int(d.battery),0,0,0,0,0,0)
            lat=int((55.75+d.x*1e-5)*1e7);lon=int((37.62+d.z*1e-5)*1e7);alt=int(d.y*1000)
            m.global_position_int_send(0,lat,lon,alt,alt,int(d.vx*100),int(d.vy*100),int(d.vz*100),int(d.yaw*100))
            d.update(1.0);time.sleep(1)
    threading.Thread(target=_b,daemon=True).start()

# ═══ ВЕБ ═══
HTML=r"""<!DOCTYPE html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Serafim Swarm</title>
<style>
*{margin:0;box-sizing:border-box}body{background:#0a0a12;color:#c8ccd4;font:13px 'Segoe UI',sans-serif;display:flex;height:100vh}
#left{width:240px;background:#111118;padding:10px;overflow-y:auto;border-right:1px solid #222}
#center{flex:1;position:relative}#right{width:240px;background:#111118;padding:10px;overflow-y:auto;border-left:1px solid #222}
canvas{display:block}h3{color:#f80;font-size:10px;margin:8px 0 4px;text-transform:uppercase}
.stat{display:flex;justify-content:space-between;padding:2px 0;border-bottom:1px solid #1a1a22;font-size:11px}
.stat .v{color:#fff;font-weight:bold}
.btn{display:block;width:100%;padding:7px;margin:2px 0;border:none;border-radius:4px;font-size:11px;cursor:pointer;font-weight:bold}
.btn:active{transform:scale(0.95)}.btn-a{background:#800;color:#fff}.btn-o{background:#048;color:#fff}
.btn-r{background:#080;color:#fff}.btn-p{background:#444;color:#ccc}.btn-arm{background:#f80;color:#000;padding:10px;font-size:13px}
#sbox{background:#1a1a1e;border:2px solid #f80;border-radius:6px;padding:8px;margin:6px 0;text-align:center}
#sact{font-size:22px;font-weight:900;color:#f80}#srsn{font-size:10px;color:#aaa;margin-top:3px;max-height:35px;overflow:hidden}
#log{max-height:120px;overflow-y:auto;font-size:10px}.le{color:#aaa;padding:1px 0;border-bottom:1px solid #1a1a22}
.le .a{color:#f80}.le .k{color:#f55}.le .i{color:#4af}
</style></head><body>
<div id="left">
<h3>🚀 УПРАВЛЕНИЕ</h3>
<button class="btn btn-arm" onclick="arm()">⬆ ARM / TAKEOFF</button>
<button class="btn btn-a" onclick="ask('танк','400')">🎯 Танк 400м</button>
<button class="btn btn-a" onclick="ask('РЭБ','800')">📡 РЭБ 800м</button>
<button class="btn btn-a" onclick="ask('опорник','300')">🏚 Опорник</button>
<button class="btn btn-o" onclick="ask('человек','300')">👤 Наблюдать</button>
<button class="btn btn-r" onclick="ask('','8')">🪫 RTB (8%)</button>
<button class="btn btn-p" onclick="ask('','')">🔍 Патруль</button>
<h3>🤖 SERAFIM</h3>
<div id="sbox"><div id="sact">—</div><div id="srsn">Жду...</div></div>
<div style="display:flex;gap:4px"><button class="btn" style="background:#0a0;color:#fff;flex:1" onclick="fb(true)">✅</button>
<button class="btn" style="background:#800;color:#fff;flex:1" onclick="fb(false)">❌</button></div>
<h3>📡 ТЕЛЕМЕТРИЯ</h3>
<div class="stat"><span>Alt</span><span class="v" id="alt">0</span></div>
<div class="stat"><span>Speed</span><span class="v" id="spd">0</span></div>
<div class="stat"><span>Bat</span><span class="v" id="bat">100</span></div>
<div class="stat"><span>Mode</span><span class="v" id="mode">—</span></div>
<div class="stat"><span>Targets</span><span class="v" id="tgt">5</span></div>
<div class="stat"><span>Kills</span><span class="v" id="kills">0</span></div>
<div class="stat"><span>Serafim</span><span class="v" id="sact2">—</span></div>
</div>
<div id="center"><canvas id="c"></canvas></div>
<div id="right">
<h3>🎯 ЦЕЛИ</h3><div id="tlist"></div>
<h3>📝 ЛОГ</h3><div id="log"></div>
</div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script>
const sc=new THREE.Scene();sc.background=new THREE.Color(0x87CEEB);sc.fog=new THREE.FogExp2(0x87CEEB,0.00015);
const cam=new THREE.PerspectiveCamera(75,innerWidth/innerHeight,1,5000);cam.position.set(200,200,400);
const rdr=new THREE.WebGLRenderer({canvas:document.getElementById('c'),antialias:true});
rdr.setSize(1,1);rdr.shadowMap.enabled=true;
sc.add(new THREE.DirectionalLight(0xffffcc,1.2)).position.set(500,800,300);
sc.add(new THREE.AmbientLight(0x446688,0.5));
sc.add(new THREE.GridHelper(4000,40,0x445544,0x334433));
let gnd=new THREE.Mesh(new THREE.PlaneGeometry(4000,4000),new THREE.MeshPhongMaterial({color:0x4a7a3a}));
gnd.rotation.x=-Math.PI/2;sc.add(gnd);
for(let i=0;i<80;i++){let t=new THREE.Mesh(new THREE.ConeGeometry(1.5,3+Math.random()*4,5),new THREE.MeshPhongMaterial({color:0x335522}));t.position.set((Math.random()-0.5)*3500,2,(Math.random()-0.5)*3500);sc.add(t)}
let dron=[];for(let i=0;i<4;i++){let g=new THREE.Group();g.add(new THREE.Mesh(new THREE.BoxGeometry(2,0.6,3.5),new THREE.MeshPhongMaterial({color:0x4488ff})));for(let s=-1;s<=1;s+=2){let a=new THREE.Mesh(new THREE.CylinderGeometry(0.2,0.2,6),new THREE.MeshPhongMaterial({color:0x444}));a.rotation.z=Math.PI/2;a.position.x=s*3.5;g.add(a)}for(let j=0;j<4;j++){let p=new THREE.Mesh(new THREE.BoxGeometry(5,0.1,0.5),new THREE.MeshPhongMaterial({color:0xccc,transparent:!0,opacity:0.4}));p.position.set((j<2?-1:1)*3.5,0.8,(j%2?-1:1)*2.5);p.name='prop';g.add(p)}g.position.set((i%2?-1:1)*200,80,(i<2?-1:1)*200);sc.add(g);dron.push(g)}
let pilot=new THREE.Group();pilot.add(new THREE.Mesh(new THREE.BoxGeometry(2,0.6,3.5),new THREE.MeshPhongMaterial({color:0x00ff00})));for(let s=-1;s<=1;s+=2){let a=new THREE.Mesh(new THREE.CylinderGeometry(0.2,0.2,6),new THREE.MeshPhongMaterial({color:0x444}));a.rotation.z=Math.PI/2;a.position.x=s*3.5;pilot.add(a)}for(let j=0;j<4;j++){let p=new THREE.Mesh(new THREE.BoxGeometry(5,0.1,0.5),new THREE.MeshPhongMaterial({color:0xccc,transparent:!0,opacity:0.4}));p.position.set((j<2?-1:1)*3.5,0.8,(j%2?-1:1)*2.5);p.name='prop';p.add(p)}sc.add(pilot);
let tgtObjs={},colors={танк:0x886633,РЭБ:0x334488,опорник:0x666655,ПВО:0x883333,техника:0x777755};
let kills=0,dx=0,dy=100,dz=0,dyaw=0;
function arm(){fetch('/api/arm').then(r=>r.json()).then(d=>{if(d.armed)log('🚀 ARM!','i')})}
function ask(role,dist){let sa=document.getElementById('sact');let sr=document.getElementById('srsn');sa.textContent='...';sr.textContent='Думаю...';
fetch('/api/ask',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({role:role,dist:dist})}).then(r=>r.json()).then(d=>{sa.textContent=d.advice.toUpperCase();sa.style.color={attack:'#f44',observe:'#48f',rtb:'#0f0',patrol:'#888'}[d.advice]||'#f80';sr.textContent=d.reason.substring(0,200);window._last=d.advice;log('🤖 '+d.advice.toUpperCase(),'a')})}
function fb(acc){let sa=document.getElementById('sact');sa.style.color=acc?'#0f0':'#f44';setTimeout(()=>sa.style.color='#f80',1500);log(acc?'✅ '+window._last:'❌ '+window._last,acc?'i':'k')}
function log(m,c){let l=document.getElementById('log');l.innerHTML='<div class="le"><span class="'+c+'">'+m+'</span></div>'+l.innerHTML}
async function upd(){
 try{let r=await fetch('/api/state');let s=await r.json();let d=s.drone||{},dec=s.decision;if(!d)return setTimeout(upd,300);
 document.getElementById('alt').textContent=(d.y||0).toFixed(0)+'m';document.getElementById('spd').textContent=Math.sqrt((d.vx||0)**2+(d.vz||0)**2).toFixed(1);
 document.getElementById('bat').textContent=(d.battery||0).toFixed(0)+'%';document.getElementById('mode').textContent=d.armed?'ARMED':'NO';
 document.getElementById('tgt').textContent=s.targets_alive||0;document.getElementById('kills').textContent=kills;
 let act=dec?dec.action:'—';document.getElementById('sact2').textContent=act.toUpperCase();
 if(dec&&!document.getElementById('sact').textContent.match(/[A-Z]/)){document.getElementById('sact').textContent=act.toUpperCase();document.getElementById('srsn').textContent=(dec.reason||'').substring(0,200)}
 dx=d.x||0;dy=d.y||0;dz=d.z||0;dyaw=d.yaw||0;pilot.position.set(dx,dy,dz);pilot.rotation.y=dyaw;
 dron.concat([pilot]).forEach(g=>g.children.forEach(c=>{if(c.name==='prop')c.rotation.y+=0.5}));
 if(s.targets) s.targets.forEach(t=>{let o=tgtObjs[t.id];if(!o){let cl=colors[t.role]||0xf44;o=new THREE.Mesh(new THREE.BoxGeometry(5,3,7),new THREE.MeshPhongMaterial({color:cl}));o.position.set(t.x,1.5,t.z);sc.add(o);tgtObjs[t.id]=o}if(t.dead)o.material.color.setHex(0x333)});
 if(s.events) s.events.forEach(e=>{if(e.event==='KILL'){kills++;log('💥 '+e.target,'k')}});
 cam.position.lerp(new THREE.Vector3(dx-Math.sin(dyaw)*70,dy+35,dz-Math.cos(dyaw)*70),0.1);cam.lookAt(dx+Math.sin(dyaw)*100,dy-10,dz+Math.cos(dyaw)*100);
 let tl='';if(s.targets)s.targets.forEach(t=>{tl+=`<div class="stat"><span>${t.role}</span><span class="v">${t.dead?'💀':'🟢'}</span></div>`});document.getElementById('tlist').innerHTML=tl;
 }catch(e){}
 rdr.render(sc,cam);setTimeout(upd,200)}
window.addEventListener('resize',()=>{cam.aspect=innerWidth/innerHeight;cam.updateProjectionMatrix();rdr.setSize(innerWidth,innerHeight)});
upd();log('🟢 Жми ARM для взлёта','i');
</script></body></html>"""

# ═══ СЕРВЕР ═══
drone = Drone()
serafim = SerafimAgent("game-1", "РАЗВ", "blue")
serafim_decision = None
decisions = []
tick = 0

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        global tick, serafim_decision
        if self.path == "/" or self.path == "/index.html":
            self.send_response(200);self.send_header("Content-type","text/html; charset=utf-8");self.end_headers()
            self.wfile.write(HTML.encode())
        elif self.path == "/api/state":
            tick += 1
            if drone.armed and tick % 20 == 0:
                sit = TacticalSituation(agent_id="g1",agent_role="РАЗВ",agent_team="blue",
                    x=drone.x,y=drone.y,z=drone.z,battery_pct=drone.battery,heading_deg=math.degrees(drone.yaw),
                    enemies=[{"id":t["id"],"role":t["role"],"dist_m":math.sqrt((drone.x-t["x"])**2+(drone.z-t["z"])**2)}
                             for t in targets if not t["dead"]],
                    nearest_enemy_dist=min([math.sqrt((drone.x-t["x"])**2+(drone.z-t["z"])**2) for t in targets if not t["dead"]]+[9999]),
                    enemies_alive=sum(1 for t in targets if not t["dead"]))
                try: serafim_decision = serafim.decide_sync(sit, timeout_s=5)
                except: pass
            # Check kills
            events = []
            for t in targets:
                if t["dead"]: continue
                d = math.sqrt((drone.x-t["x"])**2+(drone.z-t["z"])**2)
                if d < 15 and drone.y < 30: t["dead"]=True;events.append({"event":"KILL","target":t["role"]})
            state = {
                "tick":tick,"drone":{"x":drone.x,"y":drone.y,"z":drone.z,"vx":drone.vx,"vy":drone.vy,"vz":drone.vz,
                    "roll":drone.roll,"pitch":drone.pitch,"yaw":drone.yaw,"battery":drone.battery,"armed":drone.armed},
                "decision":{"action":serafim_decision.action.value,"reason":serafim_decision.reason[:200]} if serafim_decision else None,
                "targets":[{"id":t["id"],"role":t["role"],"x":t["x"],"z":t["z"],"dead":t["dead"]} for t in targets],
                "targets_alive":sum(1 for t in targets if not t["dead"]),"events":events}
            self.send_response(200);self.send_header("Content-type","application/json");self.send_header("Access-Control-Allow-Origin","*");self.end_headers()
            self.wfile.write(json.dumps(state,ensure_ascii=False).encode())
        elif self.path == "/api/arm":
            drone.arm()
            self.send_response(200);self.send_header("Content-type","application/json");self.end_headers()
            self.wfile.write(b'{"armed":true}')
        else: self.send_response(404);self.end_headers()
    def do_POST(self):
        if self.path == "/api/ask":
            cl=int(self.headers.get('Content-Length',0));body=json.loads(self.rfile.read(cl))
            role=body.get('role','');dist=body.get('dist','')
            bat=8 if '8' in str(dist) else 80
            d=float(dist) if dist and dist.replace('.','').isdigit() else 500
            sit=serafim.build_situation(enemies=[{"id":"R1","role":role,"dist_m":d}],nearest_enemy_dist=d,battery=bat)
            dec=serafim.decide_sync(sit, timeout_s=8)
            self.send_response(200);self.send_header("Content-type","application/json");self.end_headers()
            self.wfile.write(json.dumps({"advice":dec.action.value,"reason":dec.reason[:200],"latency_ms":dec.latency_ms}).encode())

print("\n"+"="*60)
print("  SERAFIM GAME — http://localhost:8150")
print("  MAVLink UDP :14550 — QGroundControl")
print("="*60+"\n")
start_mavlink(drone)
HTTPServer(("0.0.0.0", 8150), Handler).serve_forever()
