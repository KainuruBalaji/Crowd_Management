/* ═══════════════════════════════════════════════════════════════
   AEGIS EYE — Digital Twin Command Center
   3D Visualization & Simulation Engine v3
   ═══════════════════════════════════════════════════════════════ */

// ── Global State ──
const STATE = {
    timelineValue: 10,
    isPlaying: false,
    playSpeed: 1,
    currentMode: 'heatmap',
    currentAttendees: 0,
    maxCapacity: 52000,
    surgeActive: false,
    surgeZone: null,
    alerts: [],
    phase: 'PRE-EVENT',
    gates: {
        east:  { pct: 0, role: 'ENTRY' },
        south: { pct: 0, role: 'EXIT'  },
        west:  { pct: 0, role: 'ENTRY' }
    },
    amenities: {
        restroom: { wait: 0, load: 0 },
        food:     { wait: 0, load: 0 },
        merch:    { wait: 0, load: 0 }
    },
    parking: {
        lotB: { capacity: 100, used: 0, status: 'OPEN' },
        lotC: { capacity: 100, used: 0, status: 'OPEN' },
        lotD: { capacity: 100, used: 0, status: 'OPEN' }
    },
    rl: {
        confidence: 98.2, actions: 0, reward: 0,
        policy: 'OPTIMIZE', preferredGate: 'east'
    }
};

// ── Three.js Globals ──
let scene, camera, renderer, clock;
let venueGroup, crowdParticles, heatmapMesh, flowParticles;
let predictionRings = [], staffMarkers = [], rlArrows = [];
let gateMeshes = {};
let parkingLabelSprites = {};
let carMeshes = { east: [], south: [], west: [] };
let animationId;
let mouseDown = false, mouseX = 0, mouseY = 0;
let cameraLookAt = { x: 0, y: 0, z: 0 };
let cameraAngle = 0.3, cameraElevation = 0.55, cameraDistance = 160;

// ── Crowd ──
const CROWD_COUNT = 8000;
let crowdPositions, crowdColors, crowdGeometry, crowdMaterial;
let crowdState;   // 0=PARKING, 1=WALK_TO_GATE, 3=ENTERING, 4=INSIDE, 5=EXIT_TO_GATE, 6=EXIT_TO_PARKING, 7=DRIVING_AWAY, 8=GONE
let crowdGate;    // index into GATE_NAMES
let crowdTarget;  // x,z per particle
let crowdSpeed;
let crowdRole;    // 0=attendee, 1=stays_at_parking, 2=outside_wanderer

// ── 3 Gates Only (No North — stage is there) ──
const GATE_POS = {
    east:  { x: 75,  z: 0,   parkX: 120, parkZ: 0,    entryDir: { x: -1, z: 0 } },
    south: { x: 0,   z: 62,  parkX: 0,   parkZ: 120,  entryDir: { x: 0, z: -1 } },
    west:  { x: -75, z: 0,   parkX: -120, parkZ: 0,   entryDir: { x: 1, z: 0 } }
};
const GATE_NAMES = ['east', 'south', 'west'];
const ENTRY_GATES = ['east', 'west'];     // Crowd enters through these
const EXIT_GATES  = ['south', 'east'];    // Crowd exits through South (primary) + East

// ── Heatmap ──
const HEAT_RES = 40;
let heatmapData = new Float32Array(HEAT_RES * HEAT_RES);

// ═══════════════════════════════════════════════════════════════
// INITIALIZATION
// ═══════════════════════════════════════════════════════════════

function init() {
    simulateLoading().then(() => {
        initThreeJS();
        buildVenue();
        initCrowdSystem();
        initHeatmap();
        initFlowVisualization();
        initPredictionRings();
        initStaffMarkers();
        initRLArrows();
        setupEventListeners();
        updateClock();
        animate();
    });
}

async function simulateLoading() {
    const steps = [
        { text: 'Loading sensor mesh...', pct: 15 },
        { text: 'Initializing LiDAR arrays...', pct: 30 },
        { text: 'Connecting edge nodes (12/12)...', pct: 45 },
        { text: 'Loading venue 3D model...', pct: 60 },
        { text: 'Calibrating thermal cameras...', pct: 75 },
        { text: 'Starting RL agent (PPO)...', pct: 88 },
        { text: 'Digital Twin ready.', pct: 100 }
    ];
    for (const step of steps) {
        document.getElementById('load-status').textContent = step.text;
        document.getElementById('load-bar').style.width = step.pct + '%';
        await sleep(300);
    }
    await sleep(250);
    document.getElementById('loading-screen').classList.add('fade-out');
    document.getElementById('app').classList.remove('hidden');
    await sleep(800);
    document.getElementById('loading-screen').style.display = 'none';
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

// ═══════════════════════════════════════════════════════════════
// LABEL HELPER — Big, readable floating labels
// ═══════════════════════════════════════════════════════════════

function makeLabel(text, position, options = {}) {
    const {
        fontSize = 36,
        color = '#00F0FF',
        bgColor = 'rgba(8, 12, 24, 0.92)',
        borderColor = 'rgba(0,240,255,0.5)',
        width = 400,
        height = 64,
        icon = '',
        scale = 10
    } = options;

    const canvas = document.createElement('canvas');
    const dpr = 2; // high-res labels
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // Background pill with rounded corners
    const r = height / 2;
    ctx.beginPath();
    ctx.roundRect(3, 3, width - 6, height - 6, r);
    ctx.fillStyle = bgColor;
    ctx.fill();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Text shadow for glow
    ctx.shadowColor = color;
    ctx.shadowBlur = 8;
    ctx.fillStyle = color;
    ctx.font = `bold ${fontSize}px Inter, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const displayText = (icon ? icon + '  ' : '') + text;
    ctx.fillText(displayText, width / 2, height / 2);

    // Remove shadow for sharpness on second pass
    ctx.shadowBlur = 0;
    ctx.fillText(displayText, width / 2, height / 2);

    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, sizeAttenuation: true });
    const sprite = new THREE.Sprite(mat);
    sprite.position.set(position.x, position.y, position.z);
    sprite.scale.set(scale, scale * (height / width), 1);
    sprite.renderOrder = 999;
    scene.add(sprite);
    return sprite;
}

// Small sub-label helper
function makeSubLabel(text, position, color = '#94A3B8') {
    return makeLabel(text, position, {
        color, borderColor: 'rgba(148,163,184,0.25)',
        fontSize: 24, width: 300, height: 44, scale: 6
    });
}

// ═══════════════════════════════════════════════════════════════
// THREE.JS SETUP
// ═══════════════════════════════════════════════════════════════

function initThreeJS() {
    const canvas = document.getElementById('three-canvas');
    const container = document.getElementById('viewport-3d');

    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x080c18);
    scene.fog = new THREE.FogExp2(0x080c18, 0.002);

    camera = new THREE.PerspectiveCamera(50, container.clientWidth / container.clientHeight, 0.1, 800);
    camera.position.set(0, 90, 150);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.3;

    clock = new THREE.Clock();

    // Lighting
    scene.add(new THREE.AmbientLight(0x1a1a3e, 0.7));
    const sun = new THREE.DirectionalLight(0x4488ff, 0.5);
    sun.position.set(50, 100, 30); sun.castShadow = true;
    scene.add(sun);
    const pl1 = new THREE.PointLight(0x00F0FF, 1.0, 300); pl1.position.set(-50, 50, 0); scene.add(pl1);
    const pl2 = new THREE.PointLight(0x8B5CF6, 0.8, 300); pl2.position.set(50, 50, 0); scene.add(pl2);
    const stageLight = new THREE.PointLight(0xc084fc, 0.6, 150); stageLight.position.set(0, 20, -35); scene.add(stageLight);

    // Ground
    const ground = new THREE.Mesh(
        new THREE.PlaneGeometry(500, 500, 60, 60),
        new THREE.MeshStandardMaterial({ color: 0x0b1120, metalness: 0.3, roughness: 0.9 })
    );
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.5; ground.receiveShadow = true;
    scene.add(ground);

    // Grid
    const grid = new THREE.GridHelper(400, 80, 0x1a2744, 0x0f1729);
    grid.position.y = -0.3; scene.add(grid);

    window.addEventListener('resize', () => {
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
    });
}

// ═══════════════════════════════════════════════════════════════
// VENUE — 3 Gates, No North Gate
// ═══════════════════════════════════════════════════════════════

function buildVenue() {
    venueGroup = new THREE.Group();

    // ══════ STADIUM BOWL ══════
    const bowlShape = new THREE.Shape();
    const outerRx = 70, outerRy = 50, innerRx = 50, innerRy = 32;
    for (let i = 0; i <= 64; i++) {
        const a = (i/64)*Math.PI*2;
        if (i===0) bowlShape.moveTo(Math.cos(a)*outerRx, Math.sin(a)*outerRy);
        else bowlShape.lineTo(Math.cos(a)*outerRx, Math.sin(a)*outerRy);
    }
    const hole = new THREE.Path();
    for (let i = 0; i <= 64; i++) {
        const a = (i/64)*Math.PI*2;
        if (i===0) hole.moveTo(Math.cos(a)*innerRx, Math.sin(a)*innerRy);
        else hole.lineTo(Math.cos(a)*innerRx, Math.sin(a)*innerRy);
    }
    bowlShape.holes.push(hole);
    const bowl = new THREE.Mesh(
        new THREE.ExtrudeGeometry(bowlShape, { depth: 18, bevelEnabled: false }),
        new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.5, roughness: 0.6, transparent: true, opacity: 0.9 })
    );
    bowl.rotation.x = -Math.PI/2; bowl.castShadow = true; bowl.receiveShadow = true;
    venueGroup.add(bowl);

    // Seating tiers
    [{ r: 45.5, y: 3, c: 0x1e3a5f }, { r: 51, y: 7, c: 0x1e2d4a }, { r: 56.5, y: 12, c: 0x1a2540 }].forEach(t => {
        const tier = new THREE.Mesh(
            new THREE.TorusGeometry(t.r, 3, 8, 64),
            new THREE.MeshStandardMaterial({ color: t.c, metalness: 0.4, roughness: 0.7, transparent: true, opacity: 0.7 })
        );
        tier.rotation.x = Math.PI/2; tier.position.y = t.y; tier.scale.set(1, 0.72, 0.5);
        venueGroup.add(tier);
    });

    // ══════ MAIN STAGE (north end, no gate behind it) ══════
    // Stage platform
    const stage = new THREE.Mesh(
        new THREE.BoxGeometry(36, 5, 18),
        new THREE.MeshStandardMaterial({ color: 0x7c3aed, metalness: 0.7, roughness: 0.3, emissive: 0x4c1d95, emissiveIntensity: 0.5 })
    );
    stage.position.set(0, 2.5, -36); stage.castShadow = true;
    venueGroup.add(stage);

    // LED Screen behind stage
    const screen = new THREE.Mesh(
        new THREE.BoxGeometry(34, 14, 0.5),
        new THREE.MeshStandardMaterial({ color: 0x1e1b4b, emissive: 0x7c3aed, emissiveIntensity: 0.4 })
    );
    screen.position.set(0, 12, -44);
    venueGroup.add(screen);

    // Stage lighting rigs + spots
    for (let i = -14; i <= 14; i += 7) {
        const rig = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 16, 8), new THREE.MeshStandardMaterial({ color: 0x334155 }));
        rig.position.set(i, 13, -36); venueGroup.add(rig);
        const spot = new THREE.Mesh(
            new THREE.ConeGeometry(1, 2.5, 8),
            new THREE.MeshStandardMaterial({ color: 0x00F0FF, emissive: 0x00F0FF, emissiveIntensity: 0.7, transparent: true, opacity: 0.8 })
        );
        spot.position.set(i, 20, -36); spot.rotation.x = Math.PI; venueGroup.add(spot);
    }

    // Speaker stacks
    [-18, 18].forEach(x => {
        const spk = new THREE.Mesh(
            new THREE.BoxGeometry(4, 8, 4),
            new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.5, roughness: 0.5 })
        );
        spk.position.set(x, 4, -32); venueGroup.add(spk);
    });

    // 🏷️ STAGE LABEL — BIG & PROMINENT
    makeLabel('MAIN STAGE', { x: 0, y: 26, z: -36 }, {
        color: '#E879F9', borderColor: 'rgba(232,121,249,0.6)', icon: '🎤',
        fontSize: 42, width: 460, height: 72, scale: 14
    });

    // ══════ 3 GATES (East=Entry, West=Entry, South=Exit) ══════
    const gateConfigs = [
        { name: 'east',  x: 75,  z: 0,  rot: Math.PI/2,  color: 0x8B5CF6, hex: '#A78BFA', border: 'rgba(139,92,246,0.6)', role: 'ENTRY' },
        { name: 'south', x: 0,   z: 62, rot: Math.PI,    color: 0x10B981, hex: '#34D399', border: 'rgba(16,185,129,0.6)',  role: 'EXIT' },
        { name: 'west',  x: -75, z: 0,  rot: -Math.PI/2, color: 0xF59E0B, hex: '#FBBF24', border: 'rgba(245,158,11,0.6)', role: 'ENTRY' }
    ];

    gateConfigs.forEach(g => {
        const gateGroup = new THREE.Group();

        // Gate structure
        const gateMesh = new THREE.Mesh(
            new THREE.BoxGeometry(24, 9, 5),
            new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.6, roughness: 0.4, emissive: g.color, emissiveIntensity: 0.2 })
        );
        gateMesh.castShadow = true;
        gateMesh.userData.gateName = g.name;
        gateGroup.add(gateMesh);
        gateMeshes[g.name] = gateMesh;

        // Lane barriers
        for (let l = -10; l <= 10; l += 2.5) {
            const lane = new THREE.Mesh(
                new THREE.BoxGeometry(2, 5.5, 0.3),
                new THREE.MeshStandardMaterial({ color: g.color, emissive: g.color, emissiveIntensity: 0.45, transparent: true, opacity: 0.6 })
            );
            lane.position.set(l, 0, 3); gateGroup.add(lane);
        }

        // Gate canopy
        const canopy = new THREE.Mesh(
            new THREE.BoxGeometry(26, 0.6, 7),
            new THREE.MeshStandardMaterial({ color: g.color, emissive: g.color, emissiveIntensity: 0.3, transparent: true, opacity: 0.5 })
        );
        canopy.position.set(0, 5, 0); gateGroup.add(canopy);

        gateGroup.position.set(g.x, 4.5, g.z);
        gateGroup.rotation.y = g.rot;
        venueGroup.add(gateGroup);

        // 🏷️ GATE LABEL — prominent with role
        const lDir = g.x === 0 ? 0 : (g.x > 0 ? 18 : -18);
        const lDirZ = g.z === 0 ? 0 : 18;
        const lx = g.x + lDir, lz = g.z + lDirZ;
        
        makeLabel(g.name.toUpperCase() + ' GATE', { x: lx, y: 18, z: lz }, {
            color: g.hex, borderColor: g.border, icon: '🚪',
            fontSize: 38, width: 420, height: 68, scale: 12
        });
        // Role sub-label
        const roleColor = g.role === 'ENTRY' ? '#34D399' : '#FB923C';
        const roleIcon = g.role === 'ENTRY' ? '→  ENTRY' : '←  EXIT';
        makeSubLabel(roleIcon, { x: lx, y: 13.5, z: lz }, roleColor);
    });

    // ══════ CONCOURSE PATHS to gates ══════
    const pathMat = new THREE.MeshStandardMaterial({
        color: 0x1e3a5f, emissive: 0x0d2847, emissiveIntensity: 0.3, transparent: true, opacity: 0.45
    });
    gateConfigs.forEach(g => {
        const d = Math.sqrt(g.x*g.x + g.z*g.z);
        const path = new THREE.Mesh(new THREE.BoxGeometry(4.5, 0.2, d - 48), pathMat);
        path.position.set(g.x*0.55, 0.1, g.z*0.55);
        path.rotation.y = Math.atan2(g.x, g.z);
        venueGroup.add(path);
    });

    // ══════ FOOD COURTS — 4 locations, BIG labels ══════
    const foods = [
        { x: 48,  z: -18, label: 'FOOD COURT EAST' },
        { x: -48, z: -18, label: 'FOOD COURT WEST' },
        { x: 32,  z: 42,  label: 'FOOD COURT SE' },
        { x: -32, z: 42,  label: 'FOOD COURT SW' }
    ];
    foods.forEach(f => {
        buildAmenityBlock(f.x, f.z, 11, 6, 8, 0xF59E0B);
        makeLabel(f.label, { x: f.x, y: 11, z: f.z }, {
            color: '#FCD34D', borderColor: 'rgba(252,211,77,0.5)', icon: '🍔',
            fontSize: 30, width: 420, height: 58, scale: 9
        });
    });

    // ══════ RESTROOMS — 4 locations, BIG labels ══════
    const restrooms = [
        { x: 42,  z: 22,  label: 'RESTROOM  A' },
        { x: -42, z: 22,  label: 'RESTROOM  B' },
        { x: 52,  z: -38, label: 'RESTROOM  C' },
        { x: -52, z: -38, label: 'RESTROOM  D' }
    ];
    restrooms.forEach(r => {
        buildAmenityBlock(r.x, r.z, 9, 5, 7, 0x3B82F6);
        makeLabel(r.label, { x: r.x, y: 10, z: r.z }, {
            color: '#93C5FD', borderColor: 'rgba(147,197,253,0.5)', icon: '🚻',
            fontSize: 30, width: 360, height: 58, scale: 9
        });
    });

    // ══════ MERCHANDISE — 3 locations ══════
    const merchs = [
        { x: 60,  z: 8,   label: 'MERCH STORE' },
        { x: -60, z: 8,   label: 'MERCH STORE' },
        { x: 0,   z: 48,  label: 'MERCH STORE' }
    ];
    merchs.forEach(m => {
        buildAmenityBlock(m.x, m.z, 8, 5, 6, 0x8B5CF6);
        makeLabel(m.label, { x: m.x, y: 10, z: m.z }, {
            color: '#C4B5FD', borderColor: 'rgba(196,181,253,0.5)', icon: '👕',
            fontSize: 28, width: 340, height: 54, scale: 8
        });
    });

    // ══════ PARKING LOTS — 3 (one per gate, no parking behind stage) ══════
    const lots = [
        { name: 'PARKING  LOT  B', x: 120,  z: 0,   gate: 'east',  stateKey: 'lotB' },
        { name: 'PARKING  LOT  C', x: 0,    z: 120, gate: 'south', stateKey: 'lotC' },
        { name: 'PARKING  LOT  D', x: -120, z: 0,   gate: 'west',  stateKey: 'lotD' }
    ];
    lots.forEach(p => {
        // Surface
        const lot = new THREE.Mesh(
            new THREE.PlaneGeometry(50, 38),
            new THREE.MeshStandardMaterial({ color: 0x0f172a, metalness: 0.2, roughness: 0.9, transparent: true, opacity: 0.7 })
        );
        lot.rotation.x = -Math.PI/2; lot.position.set(p.x, 0.05, p.z);
        venueGroup.add(lot);

        // Grid lines
        for (let r = -16; r <= 16; r += 4) {
            const ln = new THREE.Mesh(new THREE.BoxGeometry(48, 0.05, 0.2), new THREE.MeshBasicMaterial({ color: 0x1e3a5f, transparent: true, opacity: 0.5 }));
            ln.position.set(p.x, 0.1, p.z + r); venueGroup.add(ln);
        }
        for (let c = -22; c <= 22; c += 4) {
            const ln = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.05, 36), new THREE.MeshBasicMaterial({ color: 0x1e3a5f, transparent: true, opacity: 0.3 }));
            ln.position.set(p.x + c, 0.1, p.z); venueGroup.add(ln);
        }

        // Cars (stored for dynamic visibility during egress)
        for (let ci = 0; ci < 25; ci++) {
            const car = new THREE.Mesh(
                new THREE.BoxGeometry(2.8, 1.3, 1.6),
                new THREE.MeshStandardMaterial({ color: [0x334155,0x475569,0x1e293b,0x4b5563,0x374151][ci%5], metalness: 0.6, roughness: 0.4 })
            );
            car.position.set(p.x+(Math.random()-0.5)*42, 0.65, p.z+(Math.random()-0.5)*30);
            car.rotation.y = Math.random() > 0.5 ? 0 : Math.PI/2;
            car.userData.lotGate = p.gate;
            car.userData.baseX = car.position.x;
            car.userData.baseZ = car.position.z;
            venueGroup.add(car);
            carMeshes[p.gate].push(car);
        }

        // 🏷️ PARKING LABEL (main)
        makeLabel(p.name, { x: p.x, y: 10, z: p.z }, {
            color: '#E2E8F0', borderColor: 'rgba(226,232,240,0.35)', icon: '🅿️',
            fontSize: 30, width: 420, height: 58, scale: 10
        });

        // 🏷️ PARKING CAPACITY SUB-LABEL (updated dynamically via updateParkingLabels)
        parkingLabelSprites[p.gate] = makeSubLabel('OPEN — 0% FULL', { x: p.x, y: 6.5, z: p.z }, '#34D399');

        // Walking path to gate
        const gp = GATE_POS[p.gate];
        const midX = (p.x+gp.x)/2, midZ = (p.z+gp.z)/2;
        const dist = Math.sqrt((p.x-gp.x)**2+(p.z-gp.z)**2);
        const walkPath = new THREE.Mesh(
            new THREE.BoxGeometry(3, 0.15, dist*0.6),
            new THREE.MeshStandardMaterial({ color: 0x10B981, emissive: 0x10B981, emissiveIntensity: 0.2, transparent: true, opacity: 0.3 })
        );
        walkPath.position.set(midX, 0.08, midZ);
        walkPath.rotation.y = Math.atan2(gp.x-p.x, gp.z-p.z);
        venueGroup.add(walkPath);
    });

    // ══════ ARENA NAME (top center) ══════
    makeLabel('STARFIELD ARENA', { x: 0, y: 30, z: 0 }, {
        color: '#F1F5F9', borderColor: 'rgba(241,245,249,0.25)', icon: '🏟️',
        fontSize: 40, width: 500, height: 72, scale: 15
    });

    // ══════ STANDING PIT ══════
    makeLabel('STANDING  PIT  (GA)', { x: 0, y: 7, z: -12 }, {
        color: '#FB923C', borderColor: 'rgba(251,146,60,0.45)', icon: '🎶',
        fontSize: 26, width: 380, height: 50, scale: 8
    });

    // ══════ SEATING SECTIONS ══════
    [
        { t: 'SEC 100-110', x: 0, z: 38 },
        { t: 'SEC 111-120', x: 42, z: 15 },
        { t: 'SEC 121-130', x: -42, z: 15 },
        { t: 'SEC 200+', x: 0, z: -55 }
    ].forEach(s => {
        makeSubLabel(s.t, { x: s.x, y: 15, z: s.z }, '#67E8F9');
    });

    // ══════ SENSOR NODES ══════
    for (let i = 0; i < 20; i++) {
        const a = (i/20)*Math.PI*2, r = 55+Math.random()*20;
        const sx = Math.cos(a)*r, sz = Math.sin(a)*r, sy = 17+Math.random()*5;
        const sensor = new THREE.Mesh(
            new THREE.OctahedronGeometry(0.9, 0),
            new THREE.MeshStandardMaterial({ color: 0x00F0FF, emissive: 0x00F0FF, emissiveIntensity: 0.8, transparent: true, opacity: 0.7 })
        );
        sensor.position.set(sx, sy, sz);
        sensor.userData = { baseY: sy, type: 'sensor' };
        venueGroup.add(sensor);
        // Beam
        const beam = new THREE.Mesh(
            new THREE.CylinderGeometry(0.05, 0.05, sy, 4),
            new THREE.MeshBasicMaterial({ color: 0x00F0FF, transparent: true, opacity: 0.07 })
        );
        beam.position.set(sx, sy/2, sz); venueGroup.add(beam);
    }

    scene.add(venueGroup);
}

// Helper to build amenity building blocks
function buildAmenityBlock(x, z, w, h, d, color) {
    const bld = new THREE.Mesh(
        new THREE.BoxGeometry(w, h, d),
        new THREE.MeshStandardMaterial({ color: 0x1e293b, emissive: color, emissiveIntensity: 0.2, metalness: 0.4, roughness: 0.6 })
    );
    bld.position.set(x, h/2, z); bld.castShadow = true;
    venueGroup.add(bld);
    const roof = new THREE.Mesh(
        new THREE.BoxGeometry(w+1.5, 0.5, d+1.5),
        new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 0.5, transparent: true, opacity: 0.7 })
    );
    roof.position.set(x, h+0.3, z); venueGroup.add(roof);
}

// ═══════════════════════════════════════════════════════════════
// STAFF MARKERS
// ═══════════════════════════════════════════════════════════════

function initStaffMarkers() {
    const positions = [
        // Gate staff
        { x: 77, z: 3, role: 'gate' }, { x: 77, z: -3, role: 'gate' },
        { x: 3, z: 64, role: 'gate' }, { x: -3, z: 64, role: 'gate' },
        { x: -77, z: 3, role: 'gate' }, { x: -77, z: -3, role: 'gate' },
        // Roaming
        { x: 20, z: 12, role: 'roam' }, { x: -22, z: 8, role: 'roam' },
        { x: 12, z: -18, role: 'roam' }, { x: -15, z: -22, role: 'roam' },
        { x: 38, z: 30, role: 'roam' }, { x: -38, z: 30, role: 'roam' },
        // Medical
        { x: 28, z: 0, role: 'medical' }, { x: -28, z: 0, role: 'medical' }
    ];
    positions.forEach(sp => {
        const c = sp.role==='medical' ? 0xF43F5E : sp.role==='gate' ? 0x10B981 : 0xF59E0B;
        const m = new THREE.Mesh(
            new THREE.SphereGeometry(0.9, 8, 8),
            new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.6, transparent: true, opacity: 0.9 })
        );
        m.position.set(sp.x, 2, sp.z);
        m.userData = { role: sp.role, baseX: sp.x, baseZ: sp.z };
        scene.add(m);
        staffMarkers.push(m);
    });
}

// ═══════════════════════════════════════════════════════════════
// RL ARROWS
// ═══════════════════════════════════════════════════════════════

function initRLArrows() {
    GATE_NAMES.forEach(name => {
        const gp = GATE_POS[name];
        const arrow = new THREE.Mesh(
            new THREE.ConeGeometry(1.8, 5, 6),
            new THREE.MeshStandardMaterial({ color: 0x10B981, emissive: 0x10B981, emissiveIntensity: 0.4, transparent: true, opacity: 0 })
        );
        arrow.position.set((gp.parkX+gp.x)/2, 7, (gp.parkZ+gp.z)/2);
        arrow.rotation.x = Math.PI/2;
        arrow.rotation.z = Math.atan2(gp.x-gp.parkX, gp.parkZ-gp.z);
        arrow.userData.gateName = name;
        scene.add(arrow);
        rlArrows.push(arrow);
    });
}

// ═══════════════════════════════════════════════════════════════
// CROWD SYSTEM — Entry via East+West, Exit via South+East
// ═══════════════════════════════════════════════════════════════

function initCrowdSystem() {
    crowdGeometry = new THREE.BufferGeometry();
    crowdPositions = new Float32Array(CROWD_COUNT * 3);
    crowdColors = new Float32Array(CROWD_COUNT * 3);
    crowdState = new Uint8Array(CROWD_COUNT);
    crowdGate = new Uint8Array(CROWD_COUNT);
    crowdTarget = new Float32Array(CROWD_COUNT * 2);
    crowdSpeed = new Float32Array(CROWD_COUNT);
    crowdRole = new Uint8Array(CROWD_COUNT);

    for (let i = 0; i < CROWD_COUNT; i++) {
        // 85% = attendee entering, 8% = stays at parking/tailgating, 7% = outside wanderer
        const rand = Math.random();
        if (rand < 0.85) crowdRole[i] = 0;      // attendee
        else if (rand < 0.93) crowdRole[i] = 1;  // parking idler
        else crowdRole[i] = 2;                    // outside wanderer

        // Assign entry gate: East or West only (50/50 split)
        const entryGateIdx = (i % 2 === 0) ? 0 : 2; // east=0, west=2 in GATE_NAMES
        crowdGate[i] = entryGateIdx;
        const gateName = GATE_NAMES[entryGateIdx];
        const gp = GATE_POS[gateName];

        // Start at assigned parking lot
        crowdPositions[i*3]   = gp.parkX + (Math.random()-0.5)*44;
        crowdPositions[i*3+1] = -5; // hidden initially
        crowdPositions[i*3+2] = gp.parkZ + (Math.random()-0.5)*32;

        crowdColors[i*3]=0.6; crowdColors[i*3+1]=0.65; crowdColors[i*3+2]=0.7;
        crowdState[i] = 0;
        crowdSpeed[i] = 0.10 + Math.random() * 0.12;
        crowdTarget[i*2]   = gp.x + (Math.random()-0.5)*12;
        crowdTarget[i*2+1] = gp.z + (Math.random()-0.5)*4;
    }

    crowdGeometry.setAttribute('position', new THREE.BufferAttribute(crowdPositions, 3));
    crowdGeometry.setAttribute('color', new THREE.BufferAttribute(crowdColors, 3));

    crowdMaterial = new THREE.PointsMaterial({
        size: 1.4, vertexColors: true, transparent: true, opacity: 0.85,
        sizeAttenuation: true, blending: THREE.AdditiveBlending, depthWrite: false
    });
    crowdParticles = new THREE.Points(crowdGeometry, crowdMaterial);
    scene.add(crowdParticles);
}

function updateCrowdPositions(t, tVal) {
    const activeCount = Math.floor((STATE.currentAttendees / STATE.maxCapacity) * CROWD_COUNT);
    const isEgress = tVal >= 85;
    const egressProgress = isEgress ? Math.min(1, (tVal - 85) / 12) : 0; // 0→1 over egress

    // Track parking lot occupancy
    let parkCount = { east: 0, south: 0, west: 0 };

    for (let i = 0; i < CROWD_COUNT; i++) {
        const idx = i * 3;
        const px = crowdPositions[idx], pz = crowdPositions[idx+2];
        const speed = crowdSpeed[i];
        const gateIdx = crowdGate[i];
        const gateName = GATE_NAMES[gateIdx];
        const gp = GATE_POS[gateName];
        const role = crowdRole[i];

        // Already gone — stay hidden
        if (crowdState[i] === 8) {
            crowdPositions[idx+1] = -10;
            continue;
        }

        // Not yet active (pre-arrival)
        if (i >= activeCount && crowdState[i] < 4 && !isEgress) {
            crowdPositions[idx+1] = -5;
            continue;
        }

        // Make visible
        crowdPositions[idx+1] = 1 + Math.sin(t*2+i*0.3)*0.2;

        // ── PARKING IDLERS ──
        if (role === 1) {
            if (isEgress) {
                // During egress: walk to far edge then disappear
                if (crowdState[i] < 7) {
                    crowdState[i] = 7;
                    // Drive away direction: outward from venue center
                    const angle = Math.atan2(gp.parkZ, gp.parkX);
                    crowdTarget[i*2]   = Math.cos(angle) * 220;
                    crowdTarget[i*2+1] = Math.sin(angle) * 220;
                }
                const tx=crowdTarget[i*2], tz=crowdTarget[i*2+1];
                const dx=tx-px, dz=tz-pz, d=Math.sqrt(dx*dx+dz*dz);
                if (d < 5) {
                    crowdState[i] = 8; crowdPositions[idx+1] = -10;
                } else {
                    crowdPositions[idx] += dx/d*speed*1.5;
                    crowdPositions[idx+2] += dz/d*speed*1.5;
                }
                crowdColors[idx]=0.6; crowdColors[idx+1]=0.55; crowdColors[idx+2]=0.4;
            } else {
                // Normal: wander in lot
                crowdPositions[idx]   += (Math.random()-0.5)*0.2;
                crowdPositions[idx+2] += (Math.random()-0.5)*0.2;
                const dxP = gp.parkX-px, dzP = gp.parkZ-pz;
                if (Math.sqrt(dxP*dxP+dzP*dzP) > 22) {
                    crowdPositions[idx]+=dxP*0.01; crowdPositions[idx+2]+=dzP*0.01;
                }
                crowdColors[idx]=0.5; crowdColors[idx+1]=0.55; crowdColors[idx+2]=0.6;
                // Count in parking
                parkCount[gateName]++;
            }
            continue;
        }

        // ── OUTSIDE WANDERERS ──
        if (role === 2) {
            if (isEgress) {
                // During egress: walk off screen
                if (crowdState[i] < 7) {
                    crowdState[i] = 7;
                    const angle = Math.atan2(pz, px);
                    crowdTarget[i*2]   = Math.cos(angle) * 250;
                    crowdTarget[i*2+1] = Math.sin(angle) * 250;
                }
                const tx=crowdTarget[i*2], tz=crowdTarget[i*2+1];
                const dx=tx-px, dz=tz-pz, d=Math.sqrt(dx*dx+dz*dz);
                if (d < 5) {
                    crowdState[i] = 8; crowdPositions[idx+1] = -10;
                } else {
                    crowdPositions[idx] += dx/d*speed*0.8;
                    crowdPositions[idx+2] += dz/d*speed*0.8;
                }
                crowdColors[idx]=0.4; crowdColors[idx+1]=0.45; crowdColors[idx+2]=0.4;
            } else {
                // Normal: wander perimeter
                const wa = t*0.1+i*0.5, wr = 80+Math.sin(i*0.3)*10;
                const tx=Math.cos(wa)*wr, tz=Math.sin(wa)*wr;
                const dx=tx-px, dz=tz-pz, d=Math.sqrt(dx*dx+dz*dz);
                if (d>1) { crowdPositions[idx]+=dx/d*speed*0.5; crowdPositions[idx+2]+=dz/d*speed*0.5; }
                crowdColors[idx]=0.4; crowdColors[idx+1]=0.5; crowdColors[idx+2]=0.55;
            }
            continue;
        }

        // ── ATTENDEES — State machine ──
        if (!isEgress) {
            switch(crowdState[i]) {
                case 0: // Start walking to gate
                    crowdState[i] = 1;
                    crowdTarget[i*2]   = gp.x + (Math.random()-0.5)*14;
                    crowdTarget[i*2+1] = gp.z + (Math.random()-0.5)*5;
                    break;
                case 1: { // WALKING TO GATE
                    const tx=crowdTarget[i*2], tz=crowdTarget[i*2+1];
                    const dx=tx-px, dz=tz-pz, d=Math.sqrt(dx*dx+dz*dz);
                    if (d < 3) {
                        crowdState[i] = 3;
                        const insA=Math.random()*Math.PI*2, insR=5+Math.random()*40;
                        crowdTarget[i*2]=Math.cos(insA)*insR;
                        crowdTarget[i*2+1]=Math.sin(insA)*insR*0.7-5;
                    } else {
                        crowdPositions[idx]+=dx/d*speed; crowdPositions[idx+2]+=dz/d*speed;
                    }
                    crowdPositions[idx]+=(Math.random()-0.5)*0.12;
                    crowdPositions[idx+2]+=(Math.random()-0.5)*0.12;
                    break;
                }
                case 3: { // ENTERING
                    const tx=crowdTarget[i*2], tz=crowdTarget[i*2+1];
                    const dx=tx-px, dz=tz-pz, d=Math.sqrt(dx*dx+dz*dz);
                    if (d<2) crowdState[i]=4;
                    else { crowdPositions[idx]+=dx/d*speed*0.7; crowdPositions[idx+2]+=dz/d*speed*0.7; }
                    break;
                }
                case 4: { // INSIDE
                    crowdPositions[idx]+=Math.sin(t*0.5+i*0.1)*0.05;
                    crowdPositions[idx+2]+=Math.cos(t*0.3+i*0.2)*0.05;
                    if (tVal>=50&&pz>-28) crowdPositions[idx+2]-=0.01;
                    const d=Math.sqrt(px*px+pz*pz);
                    if (d>46) { crowdPositions[idx]-=px*0.005; crowdPositions[idx+2]-=pz*0.005; }
                    break;
                }
            }
        } else {
            // ── EGRESS ──
            // Trigger exit for attendees still inside
            if (crowdState[i] <= 4 && crowdState[i] !== 8 && i >= activeCount) {
                crowdState[i] = 5;
                const exitGateName = Math.random() < 0.7 ? 'south' : 'east';
                const exitGP = GATE_POS[exitGateName];
                crowdGate[i] = GATE_NAMES.indexOf(exitGateName);
                crowdTarget[i*2]   = exitGP.x + (Math.random()-0.5)*12;
                crowdTarget[i*2+1] = exitGP.z + (Math.random()-0.5)*5;
            }
            // Still inside, waiting to exit
            if (crowdState[i] === 4) {
                crowdPositions[idx]+=Math.sin(t*0.5+i*0.1)*0.03;
                crowdPositions[idx+2]+=Math.cos(t*0.3+i*0.2)*0.03;
            }
            // Walking to exit gate
            if (crowdState[i] === 5) {
                const tx=crowdTarget[i*2], tz=crowdTarget[i*2+1];
                const dx=tx-px, dz=tz-pz, d=Math.sqrt(dx*dx+dz*dz);
                if (d < 4) {
                    crowdState[i] = 6;
                    const exitGP = GATE_POS[GATE_NAMES[crowdGate[i]]];
                    crowdTarget[i*2]   = exitGP.parkX + (Math.random()-0.5)*30;
                    crowdTarget[i*2+1] = exitGP.parkZ + (Math.random()-0.5)*20;
                } else {
                    crowdPositions[idx]+=dx/d*speed*1.2;
                    crowdPositions[idx+2]+=dz/d*speed*1.2;
                }
                crowdPositions[idx]+=(Math.random()-0.5)*0.15;
                crowdPositions[idx+2]+=(Math.random()-0.5)*0.15;
            }
            // Walking to parking
            if (crowdState[i] === 6) {
                const tx=crowdTarget[i*2], tz=crowdTarget[i*2+1];
                const dx=tx-px, dz=tz-pz, d=Math.sqrt(dx*dx+dz*dz);
                if (d < 5) {
                    // Reached parking — now drive away off-screen
                    crowdState[i] = 7;
                    const exitGP = GATE_POS[GATE_NAMES[crowdGate[i]]];
                    const awayAngle = Math.atan2(exitGP.parkZ, exitGP.parkX);
                    // 60% drive away, 40% walk off in random direction
                    if (Math.random() < 0.6) {
                        crowdTarget[i*2]   = Math.cos(awayAngle) * 250;
                        crowdTarget[i*2+1] = Math.sin(awayAngle) * 250;
                    } else {
                        const rndAngle = Math.random() * Math.PI * 2;
                        crowdTarget[i*2]   = Math.cos(rndAngle) * 240;
                        crowdTarget[i*2+1] = Math.sin(rndAngle) * 240;
                    }
                } else {
                    crowdPositions[idx]+=dx/d*speed*1.0;
                    crowdPositions[idx+2]+=dz/d*speed*1.0;
                }
                parkCount[GATE_NAMES[crowdGate[i]]]++;
            }
            // Driving away off-screen
            if (crowdState[i] === 7) {
                const tx=crowdTarget[i*2], tz=crowdTarget[i*2+1];
                const dx=tx-px, dz=tz-pz, d=Math.sqrt(dx*dx+dz*dz);
                if (d < 8 || Math.sqrt(px*px+pz*pz) > 230) {
                    // Off screen — gone!
                    crowdState[i] = 8;
                    crowdPositions[idx+1] = -10;
                } else {
                    crowdPositions[idx]+=dx/d*speed*2.0; // faster — driving
                    crowdPositions[idx+2]+=dz/d*speed*2.0;
                }
            }
        }

        // Surge pull
        if (STATE.surgeActive && STATE.surgeZone && crowdState[i]===4) {
            const sdx=STATE.surgeZone.x-px, sdz=STATE.surgeZone.z-pz;
            if (Math.sqrt(sdx*sdx+sdz*sdz)<25) {
                crowdPositions[idx]+=sdx*0.004; crowdPositions[idx+2]+=sdz*0.004;
            }
        }

        // ── COLORS by state ──
        if (STATE.surgeActive && STATE.surgeZone) {
            const sdx=STATE.surgeZone.x-px, sdz=STATE.surgeZone.z-pz;
            if (Math.sqrt(sdx*sdx+sdz*sdz)<14) {
                crowdColors[idx]=1; crowdColors[idx+1]=0.12; crowdColors[idx+2]=0.12;
                continue;
            }
        }
        switch(crowdState[i]) {
            case 0: case 1: crowdColors[idx]=0.65; crowdColors[idx+1]=0.7; crowdColors[idx+2]=0.78; break;
            case 3: crowdColors[idx]=0.06; crowdColors[idx+1]=0.73; crowdColors[idx+2]=0.51; break;
            case 4: crowdColors[idx]=0; crowdColors[idx+1]=0.94; crowdColors[idx+2]=1; break;
            case 5: crowdColors[idx]=0.96; crowdColors[idx+1]=0.62; crowdColors[idx+2]=0.04; break;
            case 6: crowdColors[idx]=0.85; crowdColors[idx+1]=0.55; crowdColors[idx+2]=0.1; break;
            case 7: crowdColors[idx]=0.6; crowdColors[idx+1]=0.5; crowdColors[idx+2]=0.3; break;
        }
    }
    crowdGeometry.attributes.position.needsUpdate = true;
    crowdGeometry.attributes.color.needsUpdate = true;

    // ── Update parking lot stats ──
    updateParkingStats(tVal, parkCount);
}

// ═══════════════════════════════════════════════════════════════
// PARKING LOT MANAGEMENT
// ═══════════════════════════════════════════════════════════════

function updateParkingStats(tVal, parkCount) {
    const af = STATE.currentAttendees / STATE.maxCapacity;
    const isEgress = tVal >= 85;
    const egressProgress = isEgress ? Math.min(1, (tVal - 85) / 12) : 0;

    // Map gate names to lot keys
    const lotMap = { east: 'lotB', south: 'lotC', west: 'lotD' };
    const lotNameMap = { east: 'LOT B', south: 'LOT C', west: 'LOT D' };

    GATE_NAMES.forEach(gate => {
        const lot = STATE.parking[lotMap[gate]];
        if (!isEgress) {
            // ARRIVAL: lots fill up as attendees arrive
            const baseFill = gate === 'south' ? af * 40 : af * 80; // South is exit-only, fewer cars
            lot.used = Math.min(100, Math.floor(baseFill + Math.sin(performance.now()*0.001 + gate.length)*3));
            if (lot.used > 90) lot.status = 'FULL';
            else if (lot.used > 50) lot.status = 'FILLING';
            else lot.status = 'OPEN';
        } else {
            // EGRESS: lots empty out as people drive away
            lot.used = Math.max(0, Math.floor((1 - egressProgress) * 85));
            if (lot.used < 5) lot.status = 'EMPTY';
            else if (lot.used < 30) lot.status = 'CLEARING';
            else lot.status = 'CLEARING';
        }

        // Update parking label sprite dynamically
        const sprite = parkingLabelSprites[gate];
        if (sprite) {
            updateParkingLabel(sprite, lot.status, lot.used, lotNameMap[gate]);
        }
    });

    // Update car visibility during egress
    if (isEgress) {
        GATE_NAMES.forEach(gate => {
            const cars = carMeshes[gate];
            const visibleCount = Math.floor(cars.length * (1 - egressProgress));
            cars.forEach((car, idx) => {
                if (idx >= visibleCount) {
                    // Car "drives away" — slide off and shrink
                    if (car.position.y > -2) {
                        const awayDir = Math.atan2(car.userData.baseZ, car.userData.baseX);
                        car.position.x += Math.cos(awayDir) * 0.3;
                        car.position.z += Math.sin(awayDir) * 0.3;
                        car.scale.setScalar(Math.max(0, car.scale.x - 0.02));
                        if (car.scale.x <= 0.05) car.position.y = -5; // hide
                    }
                }
            });
        });
    }
}

function updateParkingLabel(sprite, status, usedPct, lotName) {
    // Rebuild the canvas texture with updated text
    const canvas = document.createElement('canvas');
    const dpr = 2;
    const width = 300, height = 44;
    canvas.width = width * dpr; canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);

    // Colors based on status
    let color, borderColor;
    switch(status) {
        case 'OPEN': color = '#34D399'; borderColor = 'rgba(52,211,153,0.4)'; break;
        case 'FILLING': color = '#FBBF24'; borderColor = 'rgba(251,191,36,0.4)'; break;
        case 'FULL': color = '#F43F5E'; borderColor = 'rgba(244,63,94,0.5)'; break;
        case 'CLEARING': color = '#FB923C'; borderColor = 'rgba(251,146,60,0.4)'; break;
        case 'EMPTY': color = '#94A3B8'; borderColor = 'rgba(148,163,184,0.3)'; break;
        default: color = '#94A3B8'; borderColor = 'rgba(148,163,184,0.25)'; break;
    }

    // Background
    ctx.beginPath();
    ctx.roundRect(3, 3, width-6, height-6, height/2);
    ctx.fillStyle = 'rgba(8,12,24,0.92)';
    ctx.fill();
    ctx.strokeStyle = borderColor;
    ctx.lineWidth = 2;
    ctx.stroke();

    // Text
    ctx.shadowColor = color; ctx.shadowBlur = 6;
    ctx.fillStyle = color;
    ctx.font = `bold 24px Inter, Arial, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`${status} — ${usedPct}% FULL`, width/2, height/2);

    // Update sprite texture
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter;
    tex.magFilter = THREE.LinearFilter;
    sprite.material.map.dispose();
    sprite.material.map = tex;
    sprite.material.needsUpdate = true;
}

// ═══════════════════════════════════════════════════════════════
// HEATMAP
// ═══════════════════════════════════════════════════════════════

function initHeatmap() {
    const hg = new THREE.PlaneGeometry(160, 120, HEAT_RES-1, HEAT_RES-1);
    hg.setAttribute('color', new THREE.BufferAttribute(new Float32Array(hg.attributes.position.count*3), 3));
    heatmapMesh = new THREE.Mesh(hg, new THREE.MeshBasicMaterial({
        vertexColors: true, transparent: true, opacity: 0.3,
        side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false
    }));
    heatmapMesh.rotation.x = -Math.PI/2; heatmapMesh.position.y = 0.5;
    scene.add(heatmapMesh);
}

function updateHeatmap() {
    const colors = heatmapMesh.geometry.attributes.color.array;
    heatmapData.fill(0);
    for (let i = 0; i < CROWD_COUNT; i++) {
        if (crowdPositions[i*3+1] < 0) continue;
        const gx = Math.floor(((crowdPositions[i*3]+80)/160)*HEAT_RES);
        const gz = Math.floor(((crowdPositions[i*3+2]+60)/120)*HEAT_RES);
        if (gx>=0&&gx<HEAT_RES&&gz>=0&&gz<HEAT_RES) heatmapData[gz*HEAT_RES+gx]++;
    }
    const blur = new Float32Array(HEAT_RES*HEAT_RES);
    for (let y=1;y<HEAT_RES-1;y++) for (let x=1;x<HEAT_RES-1;x++) {
        blur[y*HEAT_RES+x] =
            heatmapData[(y-1)*HEAT_RES+(x-1)]*0.0625+heatmapData[(y-1)*HEAT_RES+x]*0.125+heatmapData[(y-1)*HEAT_RES+(x+1)]*0.0625+
            heatmapData[y*HEAT_RES+(x-1)]*0.125+heatmapData[y*HEAT_RES+x]*0.25+heatmapData[y*HEAT_RES+(x+1)]*0.125+
            heatmapData[(y+1)*HEAT_RES+(x-1)]*0.0625+heatmapData[(y+1)*HEAT_RES+x]*0.125+heatmapData[(y+1)*HEAT_RES+(x+1)]*0.0625;
    }
    const vc = heatmapMesh.geometry.attributes.position.count;
    for (let i=0;i<vc;i++) {
        const v = Math.min(blur[Math.min(Math.floor(i/HEAT_RES),HEAT_RES-1)*HEAT_RES+Math.min(i%HEAT_RES,HEAT_RES-1)]/12,1);
        let r,g,b;
        if(v<0.25){r=0;g=v*2;b=0.5+v*2;}else if(v<0.5){r=0;g=0.5+(v-0.25)*2;b=1-(v-0.25)*4;}
        else if(v<0.75){r=(v-0.5)*4;g=1;b=0;}else{r=1;g=1-(v-0.75)*4;b=0;}
        colors[i*3]=r; colors[i*3+1]=g; colors[i*3+2]=b;
    }
    heatmapMesh.geometry.attributes.color.needsUpdate = true;
}

// ═══════════════════════════════════════════════════════════════
// FLOW, PREDICTION, SURGE
// ═══════════════════════════════════════════════════════════════

function initFlowVisualization() {
    const N=3000, geo=new THREE.BufferGeometry();
    const pos=new Float32Array(N*3), col=new Float32Array(N*3);
    for(let i=0;i<N;i++){const a=Math.random()*Math.PI*2,r=Math.random()*90;
    pos[i*3]=Math.cos(a)*r;pos[i*3+1]=0.5+Math.random()*3;pos[i*3+2]=Math.sin(a)*r;
    col[i*3]=0.55;col[i*3+1]=0.36;col[i*3+2]=0.96;}
    geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
    geo.setAttribute('color',new THREE.BufferAttribute(col,3));
    flowParticles=new THREE.Points(geo,new THREE.PointsMaterial({
        size:0.6,vertexColors:true,transparent:true,opacity:0.6,
        blending:THREE.AdditiveBlending,depthWrite:false,sizeAttenuation:true}));
    flowParticles.visible=false; scene.add(flowParticles);
}

function initPredictionRings() {
    [{x:-15,z:8},{x:18,z:-12},{x:0,z:22},{x:-28,z:-8},{x:32,z:4}].forEach(p => {
        const ring=new THREE.Mesh(new THREE.RingGeometry(4,5.5,32),
            new THREE.MeshBasicMaterial({color:0xF59E0B,transparent:true,opacity:0,side:THREE.DoubleSide,blending:THREE.AdditiveBlending,depthWrite:false}));
        ring.rotation.x=-Math.PI/2; ring.position.set(p.x,0.5,p.z);
        ring.userData.pulsePhase=Math.random()*Math.PI*2;
        scene.add(ring); predictionRings.push(ring);
    });
}

function triggerSurge() {
    if(STATE.surgeActive) return;
    STATE.surgeActive=true;
    STATE.surgeZone={x:-6+Math.random()*12, z:-8+Math.random()*6};
    document.getElementById('tl-surge').classList.add('active-surge');
    let ov=document.querySelector('.emergency-overlay');
    if(!ov){ov=document.createElement('div');ov.className='emergency-overlay';document.body.appendChild(ov);}
    ov.classList.add('active');
    const b=document.getElementById('phase-badge');b.textContent='⚠ SURGE DETECTED';b.className='phase-badge emergency';
    addAlert('critical','CROWD SURGE in Standing Pit — Density: 7.8 ppl/m²');
    addAlert('warning','RL Agent → EMERGENCY policy activated');
    setTimeout(()=>{addAlert('warning','LED floor strips: RED outward-pulse activated');addRLAction('LED strips → RED outward');},600);
    setTimeout(()=>{addAlert('warning','PA System: crowd-easing message');addRLAction('PA zone B-7: calm-back');},1200);
    setTimeout(()=>{addAlert('info','Deploying 4 staff to Pit Zone B-7');addRLAction('Staff deploy: 4 → Zone B-7');},2000);
    setTimeout(()=>{addAlert('info','Pressure-relief gate opened');addRLAction('Relief exit OPEN');},3000);
    setTimeout(()=>addAlert('success','Medical team en route via Path C-12'),4000);
    setTimeout(()=>resolveSurge(),12000);
}

function handleSurge(t) {
    predictionRings.forEach((r,idx) => {
        const dx=r.position.x-STATE.surgeZone.x, dz=r.position.z-STATE.surgeZone.z;
        if(Math.sqrt(dx*dx+dz*dz)<30){
            r.material.color.setHex(0xF43F5E);
            r.material.opacity=0.5+Math.sin(t*4+idx)*0.3;
            r.scale.set(1+Math.sin(t*3)*0.2,1+Math.sin(t*3)*0.2,1);
        }
    });
}

function resolveSurge() {
    STATE.surgeActive=false; STATE.surgeZone=null;
    document.getElementById('tl-surge').classList.remove('active-surge');
    const ov=document.querySelector('.emergency-overlay'); if(ov) ov.classList.remove('active');
    addAlert('success','Surge RESOLVED — Density: 4.2 ppl/m²');
    addRLAction('Policy → OPTIMIZE');
    predictionRings.forEach(r=>{r.material.color.setHex(0xF59E0B);r.material.opacity=0;r.scale.set(1,1,1);});
    staffMarkers.forEach(m=>{if(m.userData.role==='roam'){m.position.x=m.userData.baseX;m.position.z=m.userData.baseZ;}});
    updatePhaseBadge();
}

// ═══════════════════════════════════════════════════════════════
// SIMULATION
// ═══════════════════════════════════════════════════════════════

function updateSimulation(t) {
    const tVal = STATE.timelineValue;
    if(tVal<10) STATE.phase='PRE-EVENT'; else if(tVal<40) STATE.phase='ARRIVAL';
    else if(tVal<50) STATE.phase='PEAK'; else if(tVal<85) STATE.phase='LIVE';
    else if(tVal<97) STATE.phase='EGRESS'; else STATE.phase='CLEARED';

    // Gradual attendee buildup
    if(tVal<10) STATE.currentAttendees=Math.floor((tVal/10)*2000);
    else if(tVal<30) STATE.currentAttendees=Math.floor(2000+((tVal-10)/20)*20000);
    else if(tVal<50) STATE.currentAttendees=Math.floor(22000+((tVal-30)/20)*30000);
    else if(tVal<85) STATE.currentAttendees=STATE.maxCapacity;
    else STATE.currentAttendees=Math.max(0,Math.floor(STATE.maxCapacity*(1-(tVal-85)/13)));
    STATE.currentAttendees=Math.max(0,Math.min(STATE.maxCapacity,STATE.currentAttendees));

    // Gates (3 gates now)
    const ga = tVal<50 ? Math.min(1,tVal/40*1.3) : tVal>=85 ? Math.min(1,(tVal-85)/10) : 0.05;
    STATE.gates.east.pct  = Math.min(100,Math.max(0,Math.floor(ga*(55+Math.sin(t*0.5)*15))));
    STATE.gates.south.pct = Math.min(100,Math.max(0,Math.floor(ga*(48+Math.cos(t*0.7)*18))));
    STATE.gates.west.pct  = Math.min(100,Math.max(0,Math.floor(ga*(62+Math.sin(t*0.3)*12))));

    // RL picks least congested entry gate
    const ep = [STATE.gates.east.pct, STATE.gates.west.pct];
    STATE.rl.preferredGate = ep[0] <= ep[1] ? 'east' : 'west';

    const af = STATE.currentAttendees/STATE.maxCapacity;
    STATE.amenities.restroom.wait=+Math.max(0,af*3.5+Math.sin(t*0.8)*0.5).toFixed(1);
    STATE.amenities.restroom.load=Math.max(0,Math.min(100,af*60+Math.sin(t)*10));
    STATE.amenities.food.wait=+Math.max(0,af*5.2+Math.cos(t*0.6)*1).toFixed(1);
    STATE.amenities.food.load=Math.max(0,Math.min(100,af*70+Math.cos(t*0.5)*15));
    STATE.amenities.merch.wait=+Math.max(0,af*2.8+Math.sin(t*0.4)*0.3).toFixed(1);
    STATE.amenities.merch.load=Math.max(0,Math.min(100,af*40+Math.sin(t*0.7)*8));

    STATE.rl.confidence=+(95+Math.sin(t*0.3)*3).toFixed(1);
    STATE.rl.actions=Math.floor(ga*14+Math.random()*3);
    STATE.rl.reward=+(0.82+Math.sin(t*0.2)*0.15).toFixed(2);
    STATE.rl.policy=STATE.surgeActive?'EMERGENCY':(tVal>=85?'EGRESS':'OPTIMIZE');

    updateCrowdPositions(t,tVal);
    updateRLVisuals(t);
    updateStaff(t);
    if(STATE.surgeActive) handleSurge(t);
}

function updateRLVisuals(t) {
    GATE_NAMES.forEach(n=>{
        const m=gateMeshes[n]; if(!m) return;
        const pref=(n===STATE.rl.preferredGate);
        m.material.emissiveIntensity = pref&&STATE.phase!=='LIVE' ? 0.4+Math.sin(t*3)*0.15 : 0.15;
    });
    rlArrows.forEach(a=>{
        const active=STATE.phase==='ARRIVAL'||STATE.phase==='PEAK'||STATE.phase==='EGRESS';
        const pref=a.userData.gateName===STATE.rl.preferredGate;
        if(active&&pref){a.material.opacity=0.5+Math.sin(t*4)*0.3;a.material.color.setHex(0x10B981);a.position.y=7+Math.sin(t*2);}
        else if(active){a.material.opacity=0.12;a.material.color.setHex(0x475569);}
        else{a.material.opacity=0;}
    });
}

function updateStaff(t) {
    staffMarkers.forEach((m,i)=>{
        if(m.userData.role==='roam'){
            m.position.x=m.userData.baseX+Math.sin(t*0.3+i)*5;
            m.position.z=m.userData.baseZ+Math.cos(t*0.2+i*0.5)*5;
        }
        m.position.y=2+Math.sin(t*2+i*0.7)*0.3;
        if(STATE.surgeActive&&STATE.surgeZone&&m.userData.role==='roam'){
            m.position.x+=(STATE.surgeZone.x-m.position.x)*0.02;
            m.position.z+=(STATE.surgeZone.z-m.position.z)*0.02;
        }
    });
}

// ═══════════════════════════════════════════════════════════════
// UI
// ═══════════════════════════════════════════════════════════════

function updateUI() {
    document.getElementById('event-capacity').textContent=
        STATE.currentAttendees.toLocaleString()+' / '+STATE.maxCapacity.toLocaleString();

    // 3 gates only — update the first 3 gate items, hide the 4th
    const gateEls = {
        'gate-north': { data: STATE.gates.east,  name: 'east' },
        'gate-east':  { data: STATE.gates.south, name: 'south' },
        'gate-south': { data: STATE.gates.west,  name: 'west' }
    };
    
    // Hide 4th gate element
    const westGateEl = document.getElementById('gate-west');
    if(westGateEl) westGateEl.style.display = 'none';

    Object.entries(gateEls).forEach(([elId, info]) => {
        const el = document.getElementById(elId);
        if(!el) return;
        el.style.display = '';
        const label = el.querySelector('.gate-label');
        const dot = el.querySelector('.gate-dot');
        const bar = el.querySelector('.gate-bar');
        const pct = el.querySelector('.gate-pct');
        
        // Update label text
        const gateDisplayName = info.name.charAt(0).toUpperCase() + info.name.slice(1);
        const roleTag = info.name === 'south' ? ' (Exit)' : ' (Entry)';
        label.innerHTML = `<span class="gate-dot" style="background:${dot.style.background}"></span>${gateDisplayName} Gate${roleTag}`;
        
        bar.style.width = info.data.pct + '%';
        pct.textContent = info.data.pct + '%';
        const isRL = info.name === STATE.rl.preferredGate;
        bar.style.background = info.data.pct>80 ? 'linear-gradient(90deg,#F59E0B,#F43F5E)' :
            isRL ? 'linear-gradient(90deg,#10B981,#34D399)' : 'linear-gradient(90deg,#00F0FF,#8B5CF6)';
    });

    document.getElementById('restroom-wait').textContent=STATE.amenities.restroom.wait+' min avg';
    document.getElementById('food-wait').textContent=STATE.amenities.food.wait+' min avg';
    document.getElementById('merch-wait').textContent=STATE.amenities.merch.wait+' min avg';
    updateMiniBar('restroom-bar',STATE.amenities.restroom.load);
    updateMiniBar('food-bar',STATE.amenities.food.load);
    updateMiniBar('merch-bar',STATE.amenities.merch.load);

    const af=STATE.currentAttendees/STATE.maxCapacity;
    const isEntry=STATE.phase==='ARRIVAL'||STATE.phase==='PEAK';
    document.getElementById('tp-entry').textContent=isEntry?Math.floor(af*850+Math.random()*50):0;
    document.getElementById('tp-exit').textContent=STATE.phase==='EGRESS'?Math.floor(af*920+Math.random()*60):Math.floor(Math.random()*15);
    document.getElementById('tp-density').textContent=(af*5.2).toFixed(1);
    document.getElementById('tp-flow').textContent=(af*1.4+0.2).toFixed(1);
    document.getElementById('rl-confidence').textContent=STATE.rl.confidence+'%';
    document.getElementById('rl-actions').textContent=STATE.rl.actions;
    document.getElementById('rl-reward').textContent=STATE.rl.reward;
    document.getElementById('rl-policy').textContent=STATE.rl.policy;
    if(!STATE.surgeActive) updatePhaseBadge();

    const tv=STATE.timelineValue;
    document.getElementById('timeline-label').textContent = tv<50 ? 'T-'+Math.floor(90-(tv/50)*90)+' min' : 'T+'+Math.floor((tv-50)/50*45)+' min';
}

function updateMiniBar(id,load){
    const el=document.getElementById(id);
    el.style.width=Math.min(100,load)+'%';
    el.classList.remove('warning','critical');
    if(load>70) el.classList.add('critical'); else if(load>40) el.classList.add('warning');
}

function updatePhaseBadge(){
    const b=document.getElementById('phase-badge');b.textContent=STATE.phase;b.className='phase-badge';
    switch(STATE.phase){case'ARRIVAL':b.classList.add('active');break;case'PEAK':b.classList.add('peak');break;
    case'LIVE':b.classList.add('active');break;case'EGRESS':b.classList.add('egress');break;}
}

function addAlert(type,text){
    const f=document.getElementById('alert-feed');const e=f.querySelector('.alert-empty');if(e)e.remove();
    const ts=[new Date().getHours(),new Date().getMinutes(),new Date().getSeconds()].map(v=>String(v).padStart(2,'0')).join(':');
    const el=document.createElement('div');el.className='alert-item '+type;
    el.innerHTML=`<span class="alert-time">${ts}</span><span class="alert-text">${text}</span>`;
    f.insertBefore(el,f.firstChild);while(f.children.length>15)f.removeChild(f.lastChild);
    document.getElementById('alert-count').textContent=f.children.length;
}

function addRLAction(text){
    const l=document.getElementById('rl-actions-log');const el=document.createElement('div');
    el.className='rl-action-entry';el.innerHTML=`<span class="action-type">▸</span> ${text}`;
    l.insertBefore(el,l.firstChild);while(l.children.length>8)l.removeChild(l.lastChild);
}

function updateClock(){
    const n=new Date();document.getElementById('clock').textContent=
    [n.getHours(),n.getMinutes(),n.getSeconds()].map(v=>String(v).padStart(2,'0')).join(':');
    setTimeout(updateClock,1000);
}

// ═══════════════════════════════════════════════════════════════
// CAMERA & VIEW MODES
// ═══════════════════════════════════════════════════════════════

function updateCamera(){
    const tx=Math.sin(cameraAngle)*cameraDistance, tz=Math.cos(cameraAngle)*cameraDistance;
    const ty=20+cameraElevation*130;
    camera.position.x+=(tx-camera.position.x)*0.05;
    camera.position.y+=(ty-camera.position.y)*0.05;
    camera.position.z+=(tz-camera.position.z)*0.05;
    camera.lookAt(cameraLookAt.x,cameraLookAt.y,cameraLookAt.z);
}

function setCameraPreset(p){
    switch(p){
        case'overview':cameraAngle=0.3;cameraElevation=0.55;cameraDistance=160;cameraLookAt={x:0,y:0,z:0};break;
        case'entry':cameraAngle=Math.PI/2;cameraElevation=0.25;cameraDistance=110;cameraLookAt={x:40,y:0,z:0};break;
        case'pit':cameraAngle=Math.PI;cameraElevation=0.15;cameraDistance=55;cameraLookAt={x:0,y:2,z:-20};break;
        case'aerial':cameraAngle=0.1;cameraElevation=1.0;cameraDistance=200;cameraLookAt={x:0,y:0,z:0};break;
    }
}

function setViewMode(mode){
    STATE.currentMode=mode;
    document.querySelectorAll('.view-btn').forEach(b=>b.classList.remove('active'));
    document.getElementById('btn-'+mode).classList.add('active');
    heatmapMesh.visible=(mode==='heatmap'||mode==='emergency');
    flowParticles.visible=(mode==='flow');
    crowdParticles.visible=true;
    predictionRings.forEach(r=>r.visible=(mode==='prediction'||mode==='emergency'));
    crowdMaterial.size=mode==='emergency'?1.5:1.4;
    heatmapMesh.material.opacity=mode==='emergency'?0.45:0.3;
}

// ═══════════════════════════════════════════════════════════════
// MAIN LOOP
// ═══════════════════════════════════════════════════════════════

let lastUI=0,lastHeat=0,fc=0,lastAutoAlert=0;

function animate(){
    animationId=requestAnimationFrame(animate);
    const t=clock.getElapsedTime(); fc++;

    if(STATE.isPlaying){
        STATE.timelineValue+=0.02*STATE.playSpeed;
        if(STATE.timelineValue>=100){STATE.timelineValue=100;STATE.isPlaying=false;document.getElementById('tl-play').textContent='▶';}
        document.getElementById('timeline-slider').value=STATE.timelineValue;
    }

    updateSimulation(t); updateCamera();

    // Sensor float
    venueGroup.children.forEach(c=>{
        if(c.userData&&c.userData.type==='sensor'){c.position.y=c.userData.baseY+Math.sin(t*2+c.position.x)*0.5;c.rotation.y=t*0.5;}
    });

    // Flow particles
    if(flowParticles.visible){
        const fp=flowParticles.geometry.attributes.position.array;
        for(let i=0;i<fp.length/3;i++){
            const ii=i*3,d=Math.sqrt(fp[ii]*fp[ii]+fp[ii+2]*fp[ii+2]),a=Math.atan2(fp[ii+2],fp[ii]);
            if(STATE.timelineValue<50){fp[ii]-=Math.cos(a)*0.15;fp[ii+2]-=Math.sin(a)*0.15;if(d<5){const na=Math.random()*Math.PI*2;fp[ii]=Math.cos(na)*80;fp[ii+2]=Math.sin(na)*80;}}
            else if(STATE.timelineValue>85){fp[ii]+=Math.cos(a)*0.15;fp[ii+2]+=Math.sin(a)*0.15;if(d>100){fp[ii]=(Math.random()-0.5)*20;fp[ii+2]=(Math.random()-0.5)*20;}}
            else{fp[ii]+=Math.cos(a+Math.PI/2)*0.08;fp[ii+2]+=Math.sin(a+Math.PI/2)*0.08;if(d>60||d<5){fp[ii]=(Math.random()-0.5)*50;fp[ii+2]=(Math.random()-0.5)*40;}}
            fp[ii+1]=0.5+Math.sin(t*2+i*0.5)*1.5;
        }
        flowParticles.geometry.attributes.position.needsUpdate=true;
    }

    // Prediction
    if(STATE.currentMode==='prediction'&&!STATE.surgeActive){
        predictionRings.forEach(r=>{
            const gx=Math.floor(((r.position.x+80)/160)*HEAT_RES),gz=Math.floor(((r.position.z+60)/120)*HEAT_RES);
            let d=0; if(gx>=0&&gx<HEAT_RES&&gz>=0&&gz<HEAT_RES) d=Math.min(heatmapData[gz*HEAT_RES+gx]/12,1);
            r.material.opacity=d*0.6*(0.5+Math.sin(t*3+r.userData.pulsePhase)*0.5);
            r.scale.set(1+d*0.3,1+d*0.3,1);
            r.material.color.setHex(d>0.6?0xF43F5E:d>0.3?0xF59E0B:0x10B981);
        });
    }

    if(fc-lastHeat>5&&heatmapMesh.visible){updateHeatmap();lastHeat=fc;}
    if(fc-lastUI>12){updateUI();lastUI=fc;}

    if(STATE.isPlaying&&t-lastAutoAlert>7&&STATE.phase!=='PRE-EVENT'&&STATE.phase!=='CLEARED'){
        lastAutoAlert=t; generateAutoAlert();
    }

    renderer.render(scene,camera);
}

function generateAutoAlert(){
    const rg=STATE.rl.preferredGate.toUpperCase();
    const als=[
        {type:'info',text:`RL: Routing to ${rg} GATE (lowest congestion)`},
        {type:'info',text:'Signage update: 12 e-Ink panels redirecting Sec 200+'},
        {type:'warning',text:'Food Court East queue > 8min — VMS: "Mezzanine 3min →"'},
        {type:'success',text:`${rg} Gate throughput: 847 ppl/min`},
        {type:'info',text:'Parking Lot B: 92% full — redirecting to Lot D'},
        {type:'success',text:'Restroom C cleaning complete — capacity restored'},
        {type:'warning',text:'Predicted bottleneck at Concourse NW in 8 min'},
        {type:'info',text:'Staff redeployed: 3 units to East concourse per RL'},
    ];
    const a=als[Math.floor(Math.random()*als.length)]; addAlert(a.type,a.text);
    const rls=[`Routing bias → ${rg} GATE`,'Updated e-Ink panels','Lane rebalance','Food routing: East→Mezzanine','Parking: Lot B→D redirect'];
    addRLAction(rls[Math.floor(Math.random()*rls.length)]);
}

// ═══════════════════════════════════════════════════════════════
// EVENTS
// ═══════════════════════════════════════════════════════════════

function setupEventListeners(){
    document.querySelectorAll('.view-btn').forEach(b=>b.addEventListener('click',()=>setViewMode(b.dataset.mode)));
    document.getElementById('cam-overview').addEventListener('click',()=>setCameraPreset('overview'));
    document.getElementById('cam-entry').addEventListener('click',()=>setCameraPreset('entry'));
    document.getElementById('cam-pit').addEventListener('click',()=>setCameraPreset('pit'));
    document.getElementById('cam-aerial').addEventListener('click',()=>setCameraPreset('aerial'));
    const sl=document.getElementById('timeline-slider');
    sl.addEventListener('input',e=>{STATE.timelineValue=parseFloat(e.target.value);});
    document.getElementById('tl-play').addEventListener('click',()=>{
        STATE.isPlaying=!STATE.isPlaying;
        document.getElementById('tl-play').textContent=STATE.isPlaying?'⏸':'▶';
        if(STATE.isPlaying&&STATE.timelineValue>=100){STATE.timelineValue=0;sl.value=0;resetCrowd();}
    });
    const speeds=[1,2,4,8];let si=0;
    document.getElementById('tl-speed').addEventListener('click',()=>{si=(si+1)%4;STATE.playSpeed=speeds[si];document.getElementById('tl-speed').textContent=speeds[si]+'×';});
    document.getElementById('tl-surge').addEventListener('click',triggerSurge);
    const cv=document.getElementById('three-canvas');
    cv.addEventListener('mousedown',e=>{mouseDown=true;mouseX=e.clientX;mouseY=e.clientY;});
    window.addEventListener('mouseup',()=>mouseDown=false);
    window.addEventListener('mousemove',e=>{if(!mouseDown)return;cameraAngle+=(e.clientX-mouseX)*0.005;cameraElevation=Math.max(0.05,Math.min(1,cameraElevation+(e.clientY-mouseY)*0.003));mouseX=e.clientX;mouseY=e.clientY;});
    cv.addEventListener('wheel',e=>{e.preventDefault();cameraDistance=Math.max(40,Math.min(280,cameraDistance+e.deltaY*0.1));},{passive:false});
    window.addEventListener('keydown',e=>{
        switch(e.key){case' ':e.preventDefault();STATE.isPlaying=!STATE.isPlaying;document.getElementById('tl-play').textContent=STATE.isPlaying?'⏸':'▶';break;
        case'1':setViewMode('heatmap');break;case'2':setViewMode('flow');break;case'3':setViewMode('queues');break;
        case'4':setViewMode('prediction');break;case'5':setViewMode('emergency');break;case's':case'S':triggerSurge();break;}
    });
}

function resetCrowd(){
    for(let i=0;i<CROWD_COUNT;i++){
        const gi=i%2===0?0:2; crowdGate[i]=gi;
        const gp=GATE_POS[GATE_NAMES[gi]];
        crowdPositions[i*3]=gp.parkX+(Math.random()-0.5)*44;
        crowdPositions[i*3+1]=-5;
        crowdPositions[i*3+2]=gp.parkZ+(Math.random()-0.5)*32;
        crowdState[i]=0;
    }
}

window.addEventListener('DOMContentLoaded',init);
