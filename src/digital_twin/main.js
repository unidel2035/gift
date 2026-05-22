import * as THREE from 'three';

// ═══════════════════════════════════════════════════════════════
// DIGITAL TWIN: СЕРАФИМ + AI CLASSIFIER + LORA COMMS
// ═══════════════════════════════════════════════════════════════

const API = 'http://localhost:8100';
const GROUND_SIZE = 2000;
const TARGET_TYPES = {
    strongpoint: 0xff4444, bunker: 0x884444, ew_station: 0xff8800,
    vehicle: 0x4444ff, person: 0x44ff44, decoy: 0x888888, unknown: 0xffffff
};
const TARGET_NAMES = {
    strongpoint:'Опорник', bunker:'Блиндаж', ew_station:'РЭБ',
    vehicle:'Техника', person:'Человек', decoy:'Ложная цель'
};

// ── Scene ────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1a1a2e);
scene.fog = new THREE.Fog(0x1a1a2e, 500, 3000);

const camera = new THREE.PerspectiveCamera(55, innerWidth/innerHeight, 5, 4000);
camera.position.set(0, 600, 800);
camera.lookAt(0,0,0);

const renderer = new THREE.WebGLRenderer({antialias:true});
renderer.setSize(innerWidth, innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);

// ── Lights ───────────────────────────────────────────────────────
const sun = new THREE.DirectionalLight(0xffffcc, 2.5);
sun.position.set(500, 800, 300);
sun.castShadow = true;
sun.shadow.mapSize.set(2048,2048);
sun.shadow.camera.near = 10; sun.shadow.camera.far = 4000;
sun.shadow.camera.left = -1000; sun.shadow.camera.right = 1000;
sun.shadow.camera.top = 1000; sun.shadow.camera.bottom = -1000;
scene.add(sun);
scene.add(new THREE.AmbientLight(0x334466, 0.8));

// ── Ground ───────────────────────────────────────────────────────
const groundGeo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE);
const groundMat = new THREE.MeshPhongMaterial({color:0x2d5a1e});
const ground = new THREE.Mesh(groundGeo, groundMat);
ground.rotation.x = -Math.PI/2; ground.position.y = 0;
ground.receiveShadow = true;
scene.add(ground);

// Grid
const grid = new THREE.GridHelper(GROUND_SIZE, 40, 0x446633, 0x335522);
grid.position.y = 0.1; scene.add(grid);

// Roads
const roadGeo = new THREE.PlaneGeometry(80, GROUND_SIZE);
const roadMat = new THREE.MeshPhongMaterial({color:0x555555});
[ [-400,149], [300,149] ].forEach(([x,z]) => {
    const road = new THREE.Mesh(roadGeo, roadMat);
    road.rotation.x = -Math.PI/2; road.position.set(x, 0.2, z); scene.add(road);
});
const roadH = new THREE.Mesh(new THREE.PlaneGeometry(GROUND_SIZE, 60), roadMat);
roadH.rotation.x = -Math.PI/2; roadH.position.set(0,0.2,0); scene.add(roadH);

// Trees
for(let i=0; i<200; i++) {
    const tx = (Math.random()-0.5)*GROUND_SIZE*0.9;
    const tz = (Math.random()-0.5)*GROUND_SIZE*0.9;
    if(Math.abs(tx)<50 || Math.abs(tz)<50) continue;
    const trunk = new THREE.Mesh(
        new THREE.CylinderGeometry(3,4,15+Math.random()*20,6),
        new THREE.MeshPhongMaterial({color:0x5c3a1e}));
    trunk.position.set(tx,7,tz); trunk.castShadow=true; scene.add(trunk);
    const leaves = new THREE.Mesh(
        new THREE.ConeGeometry(8,20,8),
        new THREE.MeshPhongMaterial({color:0x2d6a1e + Math.floor(Math.random()*3)*0x001000}));
    leaves.position.set(tx,22,tz); leaves.castShadow=true; scene.add(leaves);
}

// ── Drone model ──────────────────────────────────────────────────
const droneMesh = new THREE.Group();
const bodyG = new THREE.BoxGeometry(2, 0.6, 1.5);
const bodyM = new THREE.MeshPhongMaterial({color:0x4488cc});
const body = new THREE.Mesh(bodyG, bodyM);
body.castShadow = true; droneMesh.add(body);

// Camera gimbal
const gimbal = new THREE.Mesh(
    new THREE.SphereGeometry(0.2,8,8),
    new THREE.MeshPhongMaterial({color:0x111111}));
gimbal.position.y = -0.4; droneMesh.add(gimbal);

// Arms + motors
const armG = new THREE.CylinderGeometry(0.15, 0.15, 4, 6);
for(let a=0; a<4; a++) {
    const angle = a*Math.PI/2 + Math.PI/4;
    const arm = new THREE.Mesh(armG, new THREE.MeshPhongMaterial({color:0x333333}));
    arm.rotation.z = Math.PI/2;
    arm.rotation.y = angle;
    arm.position.set(Math.cos(angle)*1.5, 0, Math.sin(angle)*1.5);
    arm.castShadow = true;
    droneMesh.add(arm);

    const motor = new THREE.Mesh(
        new THREE.CylinderGeometry(0.4,0.4,0.3,12),
        new THREE.MeshPhongMaterial({color:0x666666}));
    motor.position.copy(arm.position).add(new THREE.Vector3(Math.cos(angle)*2,0,Math.sin(angle)*2));
    motor.castShadow = true;
    droneMesh.add(motor);

    const prop = new THREE.Group();
    const propBlade = new THREE.BoxGeometry(2, 0.05, 0.4);
    const propMesh = new THREE.Mesh(propBlade, new THREE.MeshPhongMaterial({color:0xcccccc, transparent:true, opacity:0.6}));
    prop.add(propMesh);
    prop.position.copy(motor.position);
    prop.userData = {speed: 0};
    droneMesh.add(prop);
}
scene.add(droneMesh);

// ── Ground targets ───────────────────────────────────────────────
const targetMeshes = [];
function createTarget(type, x, z) {
    const g = new THREE.Group();
    const color = TARGET_TYPES[type] || 0xffffff;
    const size = type==='strongpoint'?15:type==='bunker'?8:type==='vehicle'?6:type==='person'?2:10;

    if(type==='ew_station') {
        // Antenna tower
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(1,1,20,8), new THREE.MeshPhongMaterial({color:0x888888}));
        pole.position.y=10; pole.castShadow=true; g.add(pole);
        const dish = new THREE.Mesh(new THREE.SphereGeometry(4,8,4,0,Math.PI*2,0,Math.PI/2), new THREE.MeshPhongMaterial({color:0xcccccc}));
        dish.position.y=17; g.add(dish);
    } else {
        const box = new THREE.Mesh(new THREE.BoxGeometry(size, type==='bunker'?4:3, size), new THREE.MeshPhongMaterial({color}));
        box.position.y = 1.5; box.castShadow = true; g.add(box);
    }

    // Label cylinder
    const labelBase = new THREE.Mesh(new THREE.CylinderGeometry(2,2,0.3,8), new THREE.MeshPhongMaterial({color:color}));
    labelBase.position.y=0.2; g.add(labelBase);

    g.position.set(x, 0, z);
    g.userData = {type, detected:false, classified:'', attack:false};
    scene.add(g);
    return g;
}

// ── HUD overlay ──────────────────────────────────────────────────
const hudDiv = document.createElement('div');
hudDiv.style.cssText = 'position:fixed;top:10px;left:10px;background:rgba(0,0,0,0.7);color:#0f0;font:12px monospace;padding:10px;border-radius:4px;z-index:100;min-width:280px';
document.body.appendChild(hudDiv);

const aiDiv = document.createElement('div');
aiDiv.style.cssText = 'position:fixed;top:10px;right:10px;background:rgba(0,0,0,0.7);color:#ff0;font:12px monospace;padding:10px;border-radius:4px;z-index:100;min-width:280px';
document.body.appendChild(aiDiv);

const phaseDiv = document.createElement('div');
phaseDiv.style.cssText = 'position:fixed;bottom:10px;left:50%;transform:translateX(-50%);background:rgba(0,0,0,0.8);color:#fff;font:16px monospace;padding:8px 16px;border-radius:4px;z-index:100';
document.body.appendChild(phaseDiv);

// ── Comms link ───────────────────────────────────────────────────
const commLine = new THREE.Line(
    new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(0,0,0), new THREE.Vector3(0,0,0)]),
    new THREE.LineDashedMaterial({color:0x00ff88, dashSize:5, gapSize:3})
);
commLine.computeLineDistances();
scene.add(commLine);

// ── Controls ─────────────────────────────────────────────────────
let keys = {};
window.addEventListener('keydown', e => keys[e.key] = true);
window.addEventListener('keyup', e => keys[e.key] = false);
let mouseX=0, mouseY=0;
window.addEventListener('mousemove', e => { mouseX = (e.clientX/innerWidth-0.5)*2; mouseY = (e.clientY/innerHeight-0.5)*2; });

// ── Fetch state from Python backend ──────────────────────────────
let aiData = null;
let targets = [];

async function updateAI() {
    try {
        const [sRes, tRes] = await Promise.all([
            fetch(API+'/api/state').then(r=>r.json()),
            fetch(API+'/api/targets').then(r=>r.json()),
        ]);
        aiData = sRes; targets = tRes;

        // Update or create target meshes
        for(const t of tRes) {
            let mesh = targetMeshes.find(m => m.userData.id === t.id);
            if(!mesh) {
                mesh = createTarget(t.type, t.x, t.z);
                mesh.userData.id = t.id;
                targetMeshes.push(mesh);
            }
            mesh.userData.detected = t.detected;
            mesh.userData.classified = t.classified;
            mesh.userData.attack = t.attack;

            // Color change on detection
            if(t.detected) {
                mesh.children.forEach(c => {
                    if(c.material && c.material.color && !c.material.color.getHex().toString(16).match(/888|ccc/)) {
                        c.material.emissive = new THREE.Color(t.attack ? 0xff0000 : 0x444400);
                        c.material.emissiveIntensity = 0.5;
                    }
                });
            }
        }
    } catch(e) {}
}

// ── Animation loop ───────────────────────────────────────────────
let time = 0;
let updateTimer = 0;

function animate() {
    requestAnimationFrame(animate);
    const dt = Math.min(0.1, 0.016);
    time += dt;
    updateTimer += dt;

    // Fetch AI data every second
    if(updateTimer > 1.0) { updateTimer = 0; updateAI(); }

    // Drone position from AI
    if(aiData) {
        droneMesh.position.lerp(new THREE.Vector3(aiData.x, aiData.z, aiData.y || 0), 0.05);
        if(aiData.heading !== undefined) droneMesh.rotation.y = THREE.MathUtils.lerp(droneMesh.rotation.y, -aiData.heading*Math.PI/180, 0.05);
        if(aiData.pitch !== undefined) droneMesh.rotation.x = THREE.MathUtils.lerp(droneMesh.rotation.x, aiData.pitch*Math.PI/180, 0.05);
        if(aiData.roll !== undefined) droneMesh.rotation.z = THREE.MathUtils.lerp(droneMesh.rotation.z, -aiData.roll*Math.PI/180, 0.05);
    }

    // Keyboard overrides
    const speed = 3;
    if(keys['w']) droneMesh.position.z -= speed;
    if(keys['s']) droneMesh.position.z += speed;
    if(keys['a']) droneMesh.position.x -= speed;
    if(keys['d']) droneMesh.position.x += speed;
    if(keys['q']) droneMesh.position.y -= speed;
    if(keys['e']) droneMesh.position.y += speed;

    // Camera follows drone
    const dp = droneMesh.position;
    camera.position.lerp(new THREE.Vector3(dp.x+150, dp.y+200, dp.z+150), 0.02);
    camera.lookAt(dp.x, dp.y, dp.z);

    // Propeller spin
    droneMesh.children.forEach(c => {
        if(c.userData && c.userData.speed !== undefined) {
            c.rotateY(0.5);
        }
    });

    // Comms line
    if(aiData) {
        const pts = [new THREE.Vector3(aiData.x, aiData.z, aiData.y||0), new THREE.Vector3(0, 0, 0)];
        commLine.geometry.setFromPoints(pts);
        commLine.computeLineDistances();
    }

    // HUD
    if(aiData) {
        hudDiv.innerHTML = `
<b>🛸 СЕРАФИМ ${aiData.mode||'GUIDED'}</b><br>
Поз: ${aiData.x?.toFixed(0)} ${aiData.z?.toFixed(0)} H=${aiData.y?.toFixed(0)}<br>
Скор: ${Math.sqrt((aiData.vx||0)**2+(aiData.vy||0)**2+(aiData.vz||0)**2).toFixed(1)} м/с<br>
Курс: ${aiData.heading?.toFixed(0)}° | Батарея: ${aiData.battery?.toFixed(0)}%<br>
Канал: ${aiData.channel?.packets_sent||0} пакетов (${aiData.channel?.packets_lost||0} потерь)
`;
        let detectedCount = targets.filter(t=>t.detected).length;
        let attackCount = targets.filter(t=>t.attack).length;
        aiDiv.innerHTML = `
<b>🎯 AI КЛАССИФИКАТОР</b><br>
Целей: ${targets.length} | Обнаружено: ${detectedCount}<br>
Рекомендовано атаковать: ${attackCount}<br>
Фаза: <b>${aiData.phase||'patrol'}</b><br>
${aiData.phase==='rtb'?'⚠ ВОЗВРАТ — батарея < 20%':''}
`;
        let ph = aiData.phase||'patrol';
        let phText = ph==='takeoff'?'🟢 ВЗЛЁТ':ph==='patrol'?'🔵 ПАТРУЛЬ':ph==='target_found'?'🟡 ЦЕЛЬ!':ph==='classify'?'🟠 КЛАССИФИКАЦИЯ':ph==='attack'?'🔴 АТАКА':'⚫ ВОЗВРАТ';
        phaseDiv.textContent = phText;
    } else {
        hudDiv.innerHTML = '<b>Запуск Python-сервера...</b><br>python3 drone_twin.py';
    }

    renderer.render(scene, camera);
}

// ── Start ────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
    camera.aspect = innerWidth/innerHeight; camera.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
});

// Create initial targets
for(let i=0; i<6; i++) {
    const tx = (Math.random()-0.5)*GROUND_SIZE*0.7;
    const tz = (Math.random()-0.5)*GROUND_SIZE*0.7;
    const types = ['strongpoint','bunker','ew_station','vehicle','person','decoy'];
    const mesh = createTarget(types[i], tx, tz);
    mesh.userData.id = i;
    targetMeshes.push(mesh);
}

animate();
