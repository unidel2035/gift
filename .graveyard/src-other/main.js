import * as THREE from 'three';

const API = 'http://localhost:8100';
const GROUND = 2000;

const TYPES = {
    strongpoint: {color:0xff4444, size:18, name:'ОПОРНИК'},
    bunker: {color:0x996644, size:10, name:'БЛИНДАЖ'},
    ew_station: {color:0xff8800, size:14, name:'РЭБ'},
    vehicle: {color:0x4488ff, size:8, name:'ТЕХНИКА'},
    person: {color:0x44ff44, size:3, name:'ЧЕЛОВЕК'},
    decoy: {color:0x888888, size:12, name:'ЛОЖНАЯ'},
};

// ── Scene ──────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x5588cc);
scene.fog = new THREE.Fog(0x8899bb, 400, 2500);

const camera = new THREE.PerspectiveCamera(50, innerWidth/innerHeight, 5, 4000);
camera.position.set(0, 800, 1000);
camera.lookAt(0,0,0);

const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.2;
document.body.appendChild(renderer.domElement);

// ── Lighting ───────────────────────────────────────────────
const sun = new THREE.DirectionalLight(0xffeedd, 3.0);
sun.position.set(600, 900, 400);
sun.castShadow = true;
sun.shadow.mapSize.set(2048,2048);
sun.shadow.camera.near=5; sun.shadow.camera.far=4000;
sun.shadow.camera.left=-1200; sun.shadow.camera.right=1200;
sun.shadow.camera.top=1200; sun.shadow.camera.bottom=-1200;
scene.add(sun);
scene.add(new THREE.AmbientLight(0x446688, 1.2));
scene.add(new THREE.HemisphereLight(0x8899cc, 0x445533, 0.6));

// ── Sky dome ───────────────────────────────────────────────
const skyGeo = new THREE.SphereGeometry(1800, 32, 16);
const skyMat = new THREE.ShaderMaterial({
    uniforms: {topColor:{value:new THREE.Color(0x3377cc)}, bottomColor:{value:new THREE.Color(0x99bbee)}, offset:{value:20}, exponent:{value:0.4}},
    vertexShader: 'varying vec3 vWorldPosition; void main() { vec4 wp = modelMatrix * vec4(position,1.0); vWorldPosition = wp.xyz; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: 'uniform vec3 topColor; uniform vec3 bottomColor; uniform float offset; uniform float exponent; varying vec3 vWorldPosition; void main() { float h = normalize(vWorldPosition + offset).y; gl_FragColor = vec4(mix(bottomColor, topColor, max(pow(max(h,0.0),exponent),0.0)), 1.0); }',
    side: THREE.BackSide,
});
scene.add(new THREE.Mesh(skyGeo, skyMat));

// ── Terrain with heightmap ─────────────────────────────────
const terrainGeo = new THREE.PlaneGeometry(GROUND, GROUND, 100, 100);
const positions = terrainGeo.attributes.position.array;
for(let i=0; i<positions.length; i+=3) {
    let x=positions[i], y=positions[i+1];
    let h = Math.sin(x*0.003)*Math.cos(y*0.004)*30 + Math.sin(x*0.01+y*0.01)*15;
    positions[i+2] = h;
}
terrainGeo.computeVertexNormals();

const terrainMat = new THREE.MeshPhongMaterial({
    vertexColors: true,
    flatShading: false,
    shininess: 2,
});
// Color by height
const colors = new Float32Array(positions.length);
for(let i=0; i<positions.length; i+=3) {
    let h = positions[i+2];
    let c = h > 10 ? new THREE.Color(0x4a6a3a) : h > 0 ? new THREE.Color(0x5a7a2a) : new THREE.Color(0x3a5a1a);
    colors[i]=c.r; colors[i+1]=c.g; colors[i+2]=c.b;
}
terrainGeo.setAttribute('color', new THREE.BufferAttribute(colors, 3));

const terrain = new THREE.Mesh(terrainGeo, terrainMat);
terrain.rotation.x = -Math.PI/2;
terrain.receiveShadow = true;
scene.add(terrain);

// Roads
const roadMat = new THREE.MeshPhongMaterial({color:0x666655});
[[-350,0],[350,0],[0,-350],[0,350]].forEach(([x,z])=>{
    const r = new THREE.Mesh(new THREE.PlaneGeometry(40, GROUND), roadMat);
    r.rotation.x=-Math.PI/2; r.position.set(x,0.5,z); r.receiveShadow=true; scene.add(r);
});

// Trees
for(let i=0;i<300;i++){
    const tx=(Math.random()-0.5)*GROUND*0.85, tz=(Math.random()-0.5)*GROUND*0.85;
    if(Math.abs(tx)<30&&Math.abs(tz)<30) continue;
    const h=5+Math.random()*25;
    const trunk=new THREE.Mesh(new THREE.CylinderGeometry(1.5,2.5,h,6), new THREE.MeshPhongMaterial({color:0x6b4a2e}));
    trunk.position.set(tx,h/2,tz); trunk.castShadow=true; trunk.receiveShadow=true; scene.add(trunk);
    const leaves=new THREE.Mesh(new THREE.ConeGeometry(4+h*0.2,8+h*0.3,8), new THREE.MeshPhongMaterial({color:0x2a5a1a+Math.floor(Math.random()*4)*0x050500}));
    leaves.position.set(tx,h+3,tz); leaves.castShadow=true; scene.add(leaves);
}

// ── Drone model ────────────────────────────────────────────
const drone = new THREE.Group();
// Body
drone.add(new THREE.Mesh(new THREE.BoxGeometry(2.5,0.6,1.8), new THREE.MeshPhongMaterial({color:0x336699, specular:0x4488cc, shininess:30})));
// Camera gimbal
drone.add(new THREE.Mesh(new THREE.SphereGeometry(0.3,8,8), new THREE.MeshPhongMaterial({color:0x111111})));
drone.children[1].position.y=-0.5;
// Arms + props
const armG = new THREE.CylinderGeometry(0.15, 0.15, 4.5, 6);
for(let a=0;a<4;a++){
    const ang=a*Math.PI/2+Math.PI/4;
    const arm=new THREE.Mesh(armG, new THREE.MeshPhongMaterial({color:0x444444}));
    arm.rotation.z=Math.PI/2; arm.rotation.y=ang;
    arm.position.set(Math.cos(ang)*1.8, 0, Math.sin(ang)*1.8);
    drone.add(arm);
    const motor=new THREE.Mesh(new THREE.CylinderGeometry(0.5,0.5,0.4,12), new THREE.MeshPhongMaterial({color:0x777777}));
    motor.position.copy(arm.position).add(new THREE.Vector3(Math.cos(ang)*2.3,0,Math.sin(ang)*2.3));
    drone.add(motor);
    const prop=new THREE.Group();
    prop.add(new THREE.Mesh(new THREE.BoxGeometry(2.5,0.05,0.5), new THREE.MeshPhongMaterial({color:0xcccccc,transparent:true,opacity:0.5})));
    prop.position.copy(motor.position);
    prop.userData={speed:0};
    drone.add(prop);
}
drone.position.set(0, 120, 0);
drone.castShadow=true;
scene.add(drone);

// ── Detection ring ──────────────────────────────────────────
const ringGeo = new THREE.TorusGeometry(60, 2, 16, 32);
const ringMat = new THREE.MeshBasicMaterial({color:0xff4444, transparent:true, opacity:0, depthWrite:false});
const detectRing = new THREE.Mesh(ringGeo, ringMat);
detectRing.rotation.x = -Math.PI/2;
detectRing.position.y = 1;
scene.add(detectRing);

// ── Targets ─────────────────────────────────────────────────
const targetMeshes = [];
function makeTarget(type, x, z) {
    const g = new THREE.Group();
    const cfg = TYPES[type]||{color:0xffffff,size:8,name:'?'};
    const s = cfg.size;

    if(type==='ew_station'){
        const pole=new THREE.Mesh(new THREE.CylinderGeometry(1,1,20,8), new THREE.MeshPhongMaterial({color:0x888888}));
        pole.position.y=10; pole.castShadow=true; g.add(pole);
        const dish=new THREE.Mesh(new THREE.ConeGeometry(5,3,8,4), new THREE.MeshPhongMaterial({color:0xcccccc,emissive:0x222222}));
        dish.position.y=21; g.add(dish);
        // Blinking light
        const blink=new THREE.Mesh(new THREE.SphereGeometry(1.5,8,8), new THREE.MeshBasicMaterial({color:0xff0000}));
        blink.position.y=22; g.add(blink); g.userData={blink};
    } else {
        const box=new THREE.Mesh(new THREE.BoxGeometry(s, type==='bunker'?5:3, s), new THREE.MeshPhongMaterial({color:cfg.color,emissive:new THREE.Color(cfg.color).multiplyScalar(0.1)}));
        box.position.y=2; box.castShadow=true; g.add(box);
    }
    // Ground marker
    g.add(new THREE.Mesh(new THREE.CylinderGeometry(s*0.7,s*0.7,0.2,6), new THREE.MeshPhongMaterial({color:cfg.color})));
    g.position.set(x, 0, z);
    g.userData = {...cfg, id:-1, detected:false, classified:'', attack:false};
    scene.add(g);
    return g;
}

['strongpoint','bunker','ew_station','vehicle','person','decoy'].forEach((t,i)=>{
    const tx = [-300,200,-500,400,-100,500][i];
    const tz = [200,-350,300,-200,500,-100][i];
    targetMeshes.push(makeTarget(t, tx, tz));
});

// ── Comms beam ──────────────────────────────────────────────
const beamLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,0)]),
    new THREE.LineDashedMaterial({color:0x00ff88, dashSize:8, gapSize:5})
);
beamLine.computeLineDistances();
scene.add(beamLine);

// ── HUD ─────────────────────────────────────────────────────
const hud = document.createElement('div');
hud.style.cssText='position:fixed;top:10px;left:10px;background:rgba(0,0,0,0.75);color:#0f0;font:11px monospace;padding:10px;border-radius:4px;z-index:100;min-width:260px';
document.body.appendChild(hud);

const phaseBar = document.createElement('div');
phaseBar.style.cssText='position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.85);color:#fff;font:bold 16px monospace;padding:10px 20px;border-radius:6px;z-index:100';
document.body.appendChild(phaseBar);

// ── State ───────────────────────────────────────────────────
let state = null, targets = [], time = 0;

async function fetchState(){
    try{
        const [sr, tr] = await Promise.all([fetch(API+'/api/state'), fetch(API+'/api/targets')]);
        state = await sr.json();
        targets = await tr.json();
    } catch(e) {}
}

function animate(){
    requestAnimationFrame(animate);
    time += 0.016;

    // Fetch every 500ms
    if(Math.floor(time*2) > Math.floor((time-0.016)*2)) fetchState();

    if(!state) return;

    // Smooth drone movement
    const tx = state.x, ty = state.y, tz = state.z;
    drone.position.lerp(new THREE.Vector3(tx, ty, tz), 0.08);
    if(state.heading !== undefined) drone.rotation.y = THREE.MathUtils.lerp(drone.rotation.y, -(state.heading-90)*Math.PI/180, 0.08);
    if(state.pitch !== undefined) drone.rotation.x = THREE.MathUtils.lerp(drone.rotation.x, state.pitch*Math.PI/180*0.5, 0.08);

    // Detection ring follows drone
    detectRing.position.copy(drone.position); detectRing.position.y = 1;
    detectRing.material.opacity = state.classifying ? (Math.sin(time*8)*0.4+0.4) : 0;

    // Comms beam
    beamLine.geometry.setFromPoints([drone.position, new THREE.Vector3(0,0,0)]);
    beamLine.computeLineDistances();

    // Spin props
    drone.children.forEach(c=>{if(c.userData&&c.userData.speed!==undefined)c.rotateY(0.4);});

    // Update target states
    for(const tm of targetMeshes){
        const td = targets.find(t => Math.abs(t.x-tm.position.x)<10 && Math.abs(t.z-tm.position.z)<10);
        if(!td) continue;
        const det = td.detected, cls = td.classified, att = td.attack;
        if(det && !tm.userData.detected){
            tm.userData.detected = true;
            // Flash yellow on detection
            tm.children.forEach(c=>{if(c.material&&c.material.emissive){c.material.emissive=new THREE.Color(0x664400);c.material.emissiveIntensity=1.5;}});
        }
        if(cls && tm.userData.classified !== cls){
            tm.userData.classified = cls;
            tm.userData.attack = att;
            // Flash red/green
            const col = att ? 0xff0000 : 0x00ff00;
            tm.children.forEach(c=>{if(c.material&&c.material.emissive){c.material.emissive=new THREE.Color(col);c.material.emissiveIntensity=2.0;}});
            // Screen alert
            const alert = document.createElement('div');
            alert.style.cssText = `position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);background:${att?'rgba(255,0,0,0.9)':'rgba(0,200,0,0.9)'};color:#fff;padding:16px 32px;border-radius:8px;font:bold 20px monospace;z-index:999;text-align:center;animation:alertPop 2s ease-out forwards`;
            alert.innerHTML = att ? `🎯 ЦЕЛЬ: ${td.name||cls}<br><small>РЕКОМЕНДАЦИЯ: АТАКОВАТЬ</small>` : `👁 ${td.name||cls}<br><small>НЕ АТАКОВАТЬ</small>`;
            document.body.appendChild(alert);
            setTimeout(()=>alert.remove(), 2500);
        }
    }

    // HUD
    hud.innerHTML = `<b>🛸 СЕРАФИМ ${state.mode||'AUTO'}</b><br>
Поз: (${state.x?.toFixed(0)} ${state.z?.toFixed(0)}) H=${state.y?.toFixed(0)}м<br>
Скор: ${Math.sqrt((state.vx||0)**2+(state.vz||0)**2).toFixed(1)} м/с<br>
Курс: ${state.heading?.toFixed(0)}° | 🔋 ${state.battery?.toFixed(0)}%<br>
Фаза: <b>${state.phase||'??'}</b>`;

    const phaseNames = {takeoff:'🟢 ВЗЛЁТ', patrol:'🔵 ПАТРУЛЬ — сканирую', target_found:'🟡 ЦЕЛЬ ОБНАРУЖЕНА', classify:'🟠 КЛАССИФИКАЦИЯ...', attack:'🔴 АТАКА РЕКОМЕНДОВАНА', rtb:'⚫ ВОЗВРАТ'};
    phaseBar.textContent = phaseNames[state.phase] || state.phase;

    // Camera
    camera.position.lerp(new THREE.Vector3(tx+200, ty+300, tz+200), 0.02);
    camera.lookAt(tx, ty, tz);

    renderer.render(scene, camera);
}

// ── Start ────────────────────────────────────────────────────
const alertStyle = document.createElement('style');
alertStyle.textContent = '@keyframes alertPop{0%{opacity:1;transform:translate(-50%,-50%) scale(0.5)}50%{opacity:1;transform:translate(-50%,-50%) scale(1.1)}100%{opacity:0;transform:translate(-50%,-50%) scale(1)}}';
document.head.appendChild(alertStyle);

window.addEventListener('resize',()=>{camera.aspect=innerWidth/innerHeight;camera.updateProjectionMatrix();renderer.setSize(innerWidth,innerHeight);});

animate();
