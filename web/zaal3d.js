// De 3D-zaal in Tweede Kamer-stijl.
// - 10 traders als 3D-figuren in de voorste rij, de voorzitter op de verhoogde bank.
// - Wie het voorstel indient staat tijdens het debat achter het spreekgestoelte;
//   wie reageert staat op bij zijn eigen bankje.
// - Bij de stemming loopt iedereen naar zijn eigen stemhokje en daarna terug.
// - Camerastandpunten (mijn stoel, overzicht, voorzitter, volg spreker, stemhokjes) en vrij rondvliegen.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ---------- maatvoering (meters) ----------
const RIJEN = [5.6, 7.0, 8.4];                          // straal van elke rij bankjes (compacte, volle zaal)
const TREDE = 0.36;                                    // hoogteverschil per rij
const BOOG = [Math.PI * 0.12, Math.PI * 0.88];         // hoek van de halve cirkel (z positief = de zaal)
const SPAN = BOOG[1] - BOOG[0];
const GANGEN = [BOOG[0] + SPAN / 3, BOOG[0] + SPAN * 2 / 3]; // looppaden tussen de blokken
const WAND_R = 11.2, PLAFOND = 7.8, ACHTERWAND_Z = -8.6, BALKON_R = 9.95;
const R0 = RIJEN[0];
const R_STOEL = 0.3, R_PAD = -0.07, R_PUT = -1.5;      // t.o.v. de rijstraal: stoel, looproute, vloer
const SNELHEID = 2.1;                                  // loopsnelheid m/s
const LESSENAAR = new THREE.Vector3(0, 0, -3.2);
const SPREKER_PLEK = new THREE.Vector3(0, 0, -3.78);
const VZ_PLEK = new THREE.Vector3(0, 0.7, -7.0);
const HOKJE_Z = -5.45;

const KLEUR = { rust: 0xd9dee8, voor: 0x10b981, tegen: 0xf97316, spreekt: 0x4f46e5 };
const P = (r, a, y = 0) => new THREE.Vector3(r * Math.cos(a), y, r * Math.sin(a));
const naarMidden = a => Math.atan2(-Math.cos(a), -Math.sin(a));   // yaw waarmee je naar het midden kijkt

export function maakZaal(container, traders, { bubble, bronChips, voorzitter, onCamera } = {}) {
  // ---------- renderer ----------
  const mobiel = Math.min(innerWidth, innerHeight) < 700;
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, mobiel ? 1.75 : 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf2efe9);
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environmentIntensity = 0.65;

  const camera = new THREE.PerspectiveCamera(56, 1, 0.12, 80);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.09;
  controls.enablePan = true; controls.screenSpacePanning = true; controls.panSpeed = 0.6;
  controls.minDistance = 1.2; controls.maxDistance = 14;
  controls.minPolarAngle = 0.12; controls.maxPolarAngle = 1.6;
  controls.rotateSpeed = 0.55;

  // ---------- licht ----------
  scene.add(new THREE.HemisphereLight(0xfff6ea, 0xcbbca6, 0.8));
  const zon = new THREE.DirectionalLight(0xfff3e2, 1.7);
  zon.position.set(5, 15, 7); zon.target.position.set(0, 0, -1);
  zon.castShadow = true;
  zon.shadow.mapSize.set(mobiel ? 1024 : 2048, mobiel ? 1024 : 2048);
  Object.assign(zon.shadow.camera, { left: -14, right: 14, top: 14, bottom: -14, near: 2, far: 40 });
  zon.shadow.bias = -0.0004; zon.shadow.normalBias = 0.03;
  scene.add(zon, zon.target);
  const vul = new THREE.DirectionalLight(0xe8eeff, 0.45); vul.position.set(-8, 6, -6); scene.add(vul);
  const spot = new THREE.SpotLight(0xffffff, 0, 14, 0.32, 0.55, 1.4);
  spot.position.set(0, 7.0, 0); scene.add(spot, spot.target);

  // ---------- materialen ----------
  const std = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.62, metalness: 0.02, ...o });
  const houtTex = maakHoutTextuur('#C99358', '#B47E45');
  const hout = std(0xffffff, { map: houtTex, roughness: 0.48 });
  const houtDonker = std(0x9c6a3a, { roughness: 0.5 });
  const stoelStof = std(0x2c4c9c, { roughness: 0.85 });
  const zwart = std(0x22252b, { roughness: 0.4, metalness: 0.3 });
  const chroom = std(0xcfd4dc, { roughness: 0.25, metalness: 0.85 });
  const steen = std(0xe8e3da, { roughness: 0.8 });
  const wit = std(0xf8f7f4, { roughness: 0.9 });
  const goud = std(0xc9a227, { roughness: 0.3, metalness: 0.75 });
  const tapijtTex = maakTapijt('#C3C9D6');
  const tapijt = std(0xffffff, { map: tapijtTex, roughness: 0.97 });
  const randMat = std(0xb7bdc9, { roughness: 0.8 });

  const werpers = []; // objecten die schaduw werpen
  const voeg = (m, werpt = true) => { m.receiveShadow = true; if (werpt) { m.castShadow = true; werpers.push(m); } scene.add(m); return m; };

  // ---------- vloer, treden en gangen ----------
  const vloer = new THREE.Mesh(new THREE.CircleGeometry(WAND_R, 96), tapijt);
  vloer.rotation.x = -Math.PI / 2; voeg(vloer, false);
  // houten inlegrand voor de eerste rij en een ring rond het spreekgestoelte
  const inleg = new THREE.Mesh(sector(R0 - 1.02, R0 - 0.9, BOOG[0] - 0.08, BOOG[1] + 0.08, 0.01), houtDonker);
  inleg.position.y = 0.001; voeg(inleg, false);
  const holo = new THREE.Mesh(new THREE.RingGeometry(1.05, 1.11, 64), new THREE.MeshBasicMaterial({ color: 0x6366f1, transparent: true, opacity: 0.45, polygonOffset: true, polygonOffsetFactor: -2 }));
  holo.rotation.x = -Math.PI / 2; holo.position.set(0, 0.012, LESSENAAR.z - 0.2); scene.add(holo);

  RIJEN.forEach((R, i) => {
    if (!i) return;
    const h = i * TREDE;
    voeg(new THREE.Mesh(sector(R - 0.9, WAND_R - 0.02, BOOG[0] - 0.07, BOOG[1] + 0.07, h), tapijt), false);
    // houten stootrand aan de voorkant van elke trede
    voeg(new THREE.Mesh(sector(R - 0.92, R - 0.9, BOOG[0] - 0.07, BOOG[1] + 0.07, h), houtDonker), false);
    // tussentrede in de looppaden
    for (const g of GANGEN) {
      const hw = 0.55 / R;
      voeg(new THREE.Mesh(sector(R - 1.35, R - 0.9, g - hw, g + hw, h - TREDE / 2), tapijt), false);
    }
  });

  // ---------- bankjes: doorlopende houten banken per blok, blauwe stoelen ----------
  const plaatsen = [];
  const stoelen = [];
  RIJEN.forEach((R, i) => {
    const h = i * TREDE, gw = 0.62 / R;
    const blokken = [[BOOG[0], GANGEN[0] - gw], [GANGEN[0] + gw, GANGEN[1] - gw], [GANGEN[1] + gw, BOOG[1]]];
    for (const [b0, b1] of blokken) {
      voeg(new THREE.Mesh(sector(R - 0.68, R - 0.12, b0, b1, 0.045), hout)).position.y = h + 0.72;          // blad
      voeg(new THREE.Mesh(sector(R - 0.7, R - 0.62, b0, b1, 0.72), houtDonker)).position.y = h;            // voorpaneel
      voeg(new THREE.Mesh(sector(R - 0.71, R - 0.69, b0, b1, 0.05), goud), false).position.y = h + 0.6;   // gouden bies
      const stap = 0.86 / R, n = Math.floor((b1 - b0) / stap);
      const start = b0 + ((b1 - b0) - (n - 1) * stap) / 2;
      for (let k = 0; k < n; k++) {
        const a = start + k * stap;
        plaatsen.push({ rij: i, a, R, h });
        stoelen.push({ pos: P(R + R_STOEL, a, h), yaw: naarMidden(a) });
      }
    }
  });
  maakStoelen(stoelen);

  function maakStoelen(lijst) {
    const delen = [
      [new THREE.BoxGeometry(0.5, 0.1, 0.48), stoelStof, 0, 0.44, 0],
      [new THREE.BoxGeometry(0.5, 0.58, 0.08), stoelStof, 0, 0.8, -0.24],
      [new THREE.CylinderGeometry(0.035, 0.035, 0.36, 8), chroom, 0, 0.21, 0],
      [new THREE.CylinderGeometry(0.24, 0.26, 0.03, 16), zwart, 0, 0.02, 0],
    ];
    const d = new THREE.Object3D();
    for (const [geo, m, x, y, z] of delen) {
      const inst = new THREE.InstancedMesh(geo, m, lijst.length);
      lijst.forEach((s, i) => {
        d.position.copy(s.pos); d.rotation.set(0, s.yaw, 0); d.updateMatrix();
        const off = new THREE.Matrix4().makeTranslation(x, y, z);
        inst.setMatrixAt(i, d.matrix.clone().multiply(off));
      });
      inst.castShadow = true; inst.receiveShadow = true; scene.add(inst);
    }
  }

  // ---------- verhoogde voorzittersbank ----------
  voeg(new THREE.Mesh(new THREE.BoxGeometry(9, 0.7, 2.7), steen)).position.set(0, 0.35, -6.95);
  voeg(new THREE.Mesh(new THREE.BoxGeometry(9.02, 0.7, 0.04), hout)).position.set(0, 0.35, -5.6);
  for (const x of [-4.1, 4.1]) { // trapjes
    voeg(new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.35, 0.4), steen)).position.set(x, 0.175, -5.35);
  }
  voeg(new THREE.Mesh(new THREE.BoxGeometry(7.2, 0.76, 0.07), houtDonker)).position.set(0, 1.08, -5.98);  // front bank
  voeg(new THREE.Mesh(new THREE.BoxGeometry(7.4, 0.05, 0.72), hout)).position.set(0, 1.48, -6.3);         // blad
  voeg(new THREE.Mesh(new THREE.BoxGeometry(7.22, 0.05, 0.02), goud), false).position.set(0, 1.3, -5.94);
  const wapen = new THREE.Mesh(new THREE.CircleGeometry(0.26, 40), goud); wapen.position.set(0, 1.08, -5.94); scene.add(wapen);
  // stoelen op de bank: voorzitter in het midden (hoge rug), griffiers ernaast
  const bankStoelen = [-2.4, -1.2, 1.2, 2.4].map(x => ({ pos: new THREE.Vector3(x, 0.7, -7.0), yaw: 0 }));
  maakStoelen(bankStoelen);
  voeg(new THREE.Mesh(new THREE.BoxGeometry(0.62, 1.1, 0.12), stoelStof)).position.set(0, 0.7 + 1.0, -7.32);
  voeg(new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.1, 0.52), stoelStof)).position.set(0, 0.7 + 0.44, -7.0);
  // de hamer
  const hamer = new THREE.Group();
  const steel = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.26, 8), houtDonker); steel.rotation.z = Math.PI / 2; hamer.add(steel);
  const kop = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.11, 12), houtDonker); kop.position.x = 0.13; hamer.add(kop);
  hamer.position.set(0.55, 1.53, -6.25); hamer.rotation.y = 0.5; scene.add(hamer);
  const blok = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.025, 20), houtDonker); blok.position.set(0.72, 1.515, -6.12); scene.add(blok);
  // laptop en microfoon van de voorzitter
  voeg(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.012, 0.24), zwart)).position.set(-0.35, 1.51, -6.35);
  const lapScherm = voeg(new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.22, 0.012), zwart)); lapScherm.position.set(-0.35, 1.62, -6.47); lapScherm.rotation.x = -0.25;
  const vzMic = maakMicrofoon(new THREE.Vector3(0.12, 1.5, -6.12), Math.PI);

  // stenografentafel en spreekgestoelte
  voeg(new THREE.Mesh(new THREE.BoxGeometry(3.4, 0.74, 0.55), houtDonker)).position.set(0, 0.37, -4.75);
  voeg(new THREE.Mesh(new THREE.BoxGeometry(3.5, 0.04, 0.65), hout)).position.set(0, 0.76, -4.75);
  voeg(new THREE.Mesh(new THREE.BoxGeometry(1.15, 1.08, 0.58), hout)).position.set(LESSENAAR.x, 0.54, LESSENAAR.z);
  const kathBlad = voeg(new THREE.Mesh(new THREE.BoxGeometry(1.25, 0.05, 0.7), houtDonker)); kathBlad.position.set(0, 1.12, LESSENAAR.z - 0.02); kathBlad.rotation.x = 0.14;
  const embleem = new THREE.Mesh(new THREE.CircleGeometry(0.17, 40), goud); embleem.position.set(0, 0.68, LESSENAAR.z + 0.295); scene.add(embleem);
  const katheMics = [maakMicrofoon(new THREE.Vector3(-0.3, 1.14, LESSENAAR.z - 0.05), Math.PI - 0.4), maakMicrofoon(new THREE.Vector3(0.3, 1.14, LESSENAAR.z - 0.05), Math.PI + 0.4)];
  // interruptiemicrofoons in de zaal
  for (const x of [-2.6, 2.6]) {
    voeg(new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.24, 0.03, 20), zwart)).position.set(x, 0.015, -1.4);
    voeg(new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.018, 1.35, 8), chroom)).position.set(x, 0.69, -1.4);
    maakMicrofoon(new THREE.Vector3(x, 1.36, -1.4), x < 0 ? -0.6 : 0.6);
  }

  function maakMicrofoon(pos, yaw) {
    const g = new THREE.Group();
    const voet = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.035, 0.02, 12), zwart); g.add(voet);
    const hals = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.34, 6), zwart); hals.position.set(0, 0.15, 0.07); hals.rotation.x = 0.45; g.add(hals);
    const kopje = new THREE.Mesh(new THREE.SphereGeometry(0.022, 10, 8), zwart); kopje.position.set(0, 0.3, 0.145); g.add(kopje);
    const lampje = new THREE.Mesh(new THREE.SphereGeometry(0.012, 8, 6), new THREE.MeshBasicMaterial({ color: 0xef4444 })); lampje.position.set(0, 0.27, 0.12); lampje.visible = false; g.add(lampje);
    g.position.copy(pos); g.rotation.y = yaw; scene.add(g);
    return lampje;
  }

  // ---------- stemhokjes: 5 links en 5 rechts naast de voorzittersbank ----------
  const hokjes = [];
  const gordijnTex = maakGordijn();
  [-1, 1].forEach(kant => {
    for (let k = 0; k < 5; k++) {
      const x = kant * (4.95 + k * 0.95);
      const g = new THREE.Group(); g.position.set(x, 0, HOKJE_Z); scene.add(g);
      const muur = (w, h, d, px, py, pz, m = wit) => { const mm = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); mm.position.set(px, py, pz); mm.castShadow = mm.receiveShadow = true; g.add(mm); return mm; };
      muur(0.92, 2.05, 0.04, 0, 1.025, -0.45);           // achter
      muur(0.04, 2.05, 0.92, -0.46, 1.025, 0);           // zijkanten
      muur(0.04, 2.05, 0.92, 0.46, 1.025, 0);
      muur(0.96, 0.06, 0.96, 0, 2.08, 0, hout);          // dak
      muur(0.96, 0.18, 0.04, 0, 1.96, 0.47, hout);       // lijst boven
      muur(0.5, 0.03, 0.26, 0, 1.05, -0.3, hout);        // plankje met stemscherm
      const scherm = muur(0.3, 0.2, 0.015, 0, 1.18, -0.38, std(0x1e1b4b, { emissive: 0x312e81, emissiveIntensity: 0.6 }));
      scherm.rotation.x = -0.35;
      const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.05, 0.03), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xdfe3ec, emissiveIntensity: 0.4 }));
      lamp.position.set(0, 1.96, 0.495); g.add(lamp);
      const nr = plaatje(String(hokjes.length + 1), { w: 0.18, h: 0.12, bg: '#ffffff', fg: '#C2410C', px: 72 });
      nr.position.set(0.3, 1.96, 0.494); g.add(nr);
      const scharnier = new THREE.Group(); scharnier.position.set(-0.44, 0, 0.47); g.add(scharnier);
      const gordijn = new THREE.Mesh(new THREE.PlaneGeometry(0.88, 1.72), new THREE.MeshStandardMaterial({ map: gordijnTex, color: 0x4f46e5, roughness: 0.9, side: THREE.DoubleSide }));
      gordijn.position.set(0.44, 1.0, 0); gordijn.castShadow = true; scharnier.add(gordijn);
      scharnier.scale.x = 0.16;
      const rail = new THREE.Mesh(new THREE.CylinderGeometry(0.01, 0.01, 0.9, 6), chroom); rail.rotation.z = Math.PI / 2; rail.position.set(0, 1.87, 0.47); g.add(rail);
      hokjes.push({ x, kant, g, lamp, scharnier, binnen: new THREE.Vector3(x, 0, HOKJE_Z - 0.06), voor: new THREE.Vector3(x, 0, HOKJE_Z + 1.25), bezet: null });
    }
  });

  // ---------- wanden, tribune en plafond ----------
  const rondTex = maakWandTextuur();
  const rondWand = new THREE.Mesh(new THREE.CylinderGeometry(WAND_R, WAND_R, PLAFOND, 128, 1, true), std(0xffffff, { map: rondTex, side: THREE.BackSide, roughness: 0.85 }));
  rondWand.position.y = PLAFOND / 2; voeg(rondWand, false);
  const breed = 2 * Math.sqrt(WAND_R ** 2 - ACHTERWAND_Z ** 2) + 0.2;
  const achter = new THREE.Mesh(new THREE.PlaneGeometry(breed, PLAFOND), std(0xffffff, { map: maakSteenTextuur(), roughness: 0.75 }));
  achter.position.set(0, PLAFOND / 2, ACHTERWAND_Z); voeg(achter, false);
  // houten lambrisering en twee lichtbanen op de achterwand
  voeg(new THREE.Mesh(new THREE.BoxGeometry(breed, 2.6, 0.06), hout), false).position.set(0, 1.3, ACHTERWAND_Z + 0.04);
  for (const x of [-6.3, 6.3]) {
    const baan = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 4.4), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff6e6, emissiveIntensity: 0.9 }));
    baan.position.set(x, 4.9, ACHTERWAND_Z + 0.05); scene.add(baan);
  }
  // gouden letters
  const lc = document.createElement('canvas'); lc.width = 2048; lc.height = 150; const lg = lc.getContext('2d');
  lg.fillStyle = '#ffffff'; lg.fillRect(0, 0, 2048, 150); lg.clearRect(0, 0, 2048, 150);
  lg.fillStyle = '#A8823F'; lg.textAlign = 'center';
  const opschrift = 'A I - P A R L E M E N T   ·   K A M E R   D E R   T R A D E R S';
  let fs = 84; do { lg.font = `600 ${fs}px Georgia, "Times New Roman", serif`; fs -= 2; } while (lg.measureText(opschrift).width > 1960 && fs > 30);
  lg.fillText(opschrift, 1024, 100);
  const ltex = new THREE.CanvasTexture(lc); ltex.colorSpace = THREE.SRGBColorSpace; ltex.anisotropy = 4;
  const letters = new THREE.Mesh(new THREE.PlaneGeometry(11, 0.8), new THREE.MeshBasicMaterial({ map: ltex, transparent: true }));
  letters.position.set(0, 3.2, ACHTERWAND_Z + 0.08); scene.add(letters);
  // klok met de echte tijd
  const klokCanvas = document.createElement('canvas'); klokCanvas.width = klokCanvas.height = 256;
  const klokTex = new THREE.CanvasTexture(klokCanvas); klokTex.colorSpace = THREE.SRGBColorSpace;
  const klokMesh = new THREE.Mesh(new THREE.CircleGeometry(0.5, 48), new THREE.MeshBasicMaterial({ map: klokTex }));
  klokMesh.position.set(-4.75, 4.6, ACHTERWAND_Z + 0.08); scene.add(klokMesh);
  const klokRand = new THREE.Mesh(new THREE.TorusGeometry(0.5, 0.03, 8, 48), goud); klokRand.position.copy(klokMesh.position); scene.add(klokRand);
  let klokMin = -1;
  function tekenKlok() {
    const d = new Date(); if (d.getMinutes() === klokMin) return; klokMin = d.getMinutes();
    const g = klokCanvas.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 256, 256);
    g.translate(128, 128);
    for (let i = 0; i < 12; i++) { g.save(); g.rotate(i * Math.PI / 6); g.fillStyle = '#1f2937'; g.fillRect(-3, -112, 6, i % 3 ? 14 : 24); g.restore(); }
    const hand = (hoek, len, w, c) => { g.save(); g.rotate(hoek); g.strokeStyle = c; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(0, 14); g.lineTo(0, -len); g.stroke(); g.restore(); };
    hand(((d.getHours() % 12) + d.getMinutes() / 60) * Math.PI / 6, 60, 9, '#111827');
    hand(d.getMinutes() * Math.PI / 30, 92, 6, '#111827');
    g.fillStyle = '#B8862B'; g.beginPath(); g.arc(0, 0, 8, 0, Math.PI * 2); g.fill();
    g.setTransform(1, 0, 0, 1, 0, 0); klokTex.needsUpdate = true;
  }
  // publieke tribune (balkon) boven de achterste rij
  const balkonY = 3.7;
  voeg(new THREE.Mesh(sector(BALKON_R, WAND_R - 0.02, BOOG[0] - 0.12, BOOG[1] + 0.12, 0.24), wit)).position.y = balkonY;
  voeg(new THREE.Mesh(sector(BALKON_R - 0.02, BALKON_R + 0.01, BOOG[0] - 0.12, BOOG[1] + 0.12, 0.3), hout)).position.y = balkonY - 0.06;
  const glas = new THREE.Mesh(sector(BALKON_R - 0.01, BALKON_R + 0.01, BOOG[0] - 0.12, BOOG[1] + 0.12, 0.85), new THREE.MeshStandardMaterial({ color: 0xdbeafe, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0.1, depthWrite: false }));
  glas.position.y = balkonY + 0.24; scene.add(glas);
  voeg(new THREE.Mesh(sector(BALKON_R - 0.03, BALKON_R + 0.04, BOOG[0] - 0.12, BOOG[1] + 0.12, 0.05), hout), false).position.y = balkonY + 1.09;
  const tribune = [];
  for (let a = BOOG[0] - 0.08; a <= BOOG[1] + 0.08; a += 0.62 / 10.6) tribune.push({ pos: P(10.55, a, balkonY + 0.24), yaw: naarMidden(a), a });
  maakStoelen(tribune);
  // plafond met lichtkoepel en spotjes
  const plafond = new THREE.Mesh(new THREE.CircleGeometry(WAND_R, 96), wit); plafond.rotation.x = Math.PI / 2; plafond.position.y = PLAFOND; voeg(plafond, false);
  const koepel = new THREE.Mesh(new THREE.CircleGeometry(4.2, 64), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xf7f4ee, emissiveIntensity: 1.0 }));
  koepel.rotation.x = Math.PI / 2; koepel.position.set(0, PLAFOND - 0.02, 0.8); scene.add(koepel);
  for (const r of [4.25, 4.5]) { const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.06, 8, 96), r < 4.3 ? goud : wit); ring.rotation.x = Math.PI / 2; ring.position.set(0, PLAFOND - 0.06, 0.8); scene.add(ring); }
  const spotjesMat = new THREE.MeshBasicMaterial({ color: 0xfffbf0 });
  for (const [r, n] of [[6.2, 20], [8.9, 28]]) for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2; const p = P(r, a, PLAFOND - 0.01); if (p.z < ACHTERWAND_Z + 0.3) continue;
    const l = new THREE.Mesh(new THREE.CircleGeometry(0.09, 16), spotjesMat); l.rotation.x = Math.PI / 2; l.position.copy(p).add(new THREE.Vector3(0, 0, 1.2)); scene.add(l);
  }

  // ---------- groot scherm boven de voorzittersbank ----------
  const schermCanvas = document.createElement('canvas'); schermCanvas.width = 1024; schermCanvas.height = 380;
  const schermTex = new THREE.CanvasTexture(schermCanvas); schermTex.colorSpace = THREE.SRGBColorSpace; schermTex.anisotropy = 4;
  voeg(new THREE.Mesh(new THREE.BoxGeometry(7.5, 2.95, 0.1), zwart), false).position.set(0, 5.45, ACHTERWAND_Z + 0.06);
  const scherm = new THREE.Mesh(new THREE.PlaneGeometry(7.2, 2.67), new THREE.MeshBasicMaterial({ map: schermTex, toneMapped: false }));
  scherm.position.set(0, 5.45, ACHTERWAND_Z + 0.12); scene.add(scherm);

  // ---------- mijn plek: vooraan op de publieke tribune, met vrij zicht over de hele zaal ----------
  const MIJN_A = Math.PI / 2 - 0.3;
  const MIJN_OOG = P(BALKON_R + 0.4, MIJN_A, balkonY + 0.24 + 1.12);

  // ---------- de traders ----------
  const voorste = plaatsen.filter(p => p.rij === 0).sort((x, y) => x.a - y.a);
  const N = traders.length;
  const uitgangen = [BOOG[0] - 0.075, ...GANGEN, BOOG[1] + 0.075];
  const gekozen = traders.map((_, i) => voorste[Math.round(i * (voorste.length - 1) / Math.max(1, N - 1))]);
  const leden = traders.map((t, i) => {
    const pl = gekozen[i], a = pl.a;
    const fig = maakFiguur(t.look || {});
    fig.root.position.copy(P(R0 + R_STOEL, a)); fig.root.rotation.y = naarMidden(a);
    scene.add(fig.root);
    // lichtstrip op het bankje (kleurt bij spreken en stemmen), microfoon en naambordje
    const strip = new THREE.Mesh(sector(R0 - 0.705, R0 - 0.69, a - 0.38 / R0, a + 0.38 / R0, 0.05), new THREE.MeshStandardMaterial({ color: KLEUR.rust, emissive: KLEUR.rust, emissiveIntensity: 0.25 }));
    strip.position.y = 0.67; scene.add(strip);
    const micLamp = maakMicrofoon(P(R0 - 0.5, a + 0.18 / R0, 0.767), naarMidden(a) + Math.PI);
    const naam = plaatje(t.name, { w: 0.5, h: 0.12, bg: '#ffffff', fg: '#0E1220', px: 44 });
    naam.position.copy(P(R0 - 0.715, a, 0.42)); naam.rotation.y = naarMidden(a); scene.add(naam);
    const uitgang = uitgangen.reduce((b, u) => Math.abs(u - a) < Math.abs(b - a) ? u : b, uitgangen[0]);
    return { t, a, fig, strip, micLamp, uitgang, zetel: P(R0 + R_STOEL, a), staan: P(R0 - 0.02, a), plek: 'zetel', doelPlek: 'zetel', pad: [], zit: 1, stap: 0, zwaai: 0, yaw: naarMidden(a), binnenT: 0, gestemd: false, hokje: null };
  });
  // stemhokje per trader: wie links zit gaat naar links
  const links = leden.filter(l => Math.cos(l.a) < 0).sort((x, y) => Math.cos(y.a) - Math.cos(x.a));
  const rechts = leden.filter(l => Math.cos(l.a) >= 0).sort((x, y) => Math.cos(x.a) - Math.cos(y.a));
  const hL = hokjes.filter(h => h.kant < 0), hR = hokjes.filter(h => h.kant > 0);
  links.forEach((l, i) => l.hokje = hL[i] || hR[hR.length - 1 - (i - hL.length)]);
  rechts.forEach((l, i) => l.hokje = hR[i] || hL[hL.length - 1 - (i - hR.length)]);

  // ---------- publiek en staf: vult de achterste rijen en de tribune (zonder animatie, licht voor je telefoon) ----------
  const willekeur = (i => () => (i = (i * 16807) % 2147483647) / 2147483647)(7);
  const publiekPlekken = [];
  for (const p of plaatsen) if (p.rij > 0 && willekeur() < 0.68) publiekPlekken.push({ pos: P(p.R + R_STOEL, p.a, p.h), yaw: naarMidden(p.a) });
  for (const p of tribune) if (Math.abs(p.a - MIJN_A) > 0.16 && willekeur() < 0.72) publiekPlekken.push({ pos: p.pos, yaw: p.yaw });
  maakPubliek(scene, publiekPlekken, willekeur);

  // ---------- naamlabels boven de hoofden ----------
  for (const l of leden) { l.label = naamLabel(l.t.name, l.t.look?.kleur || '#6366F1'); scene.add(l.label); }

  // ---------- sfeer: kunst aan de wand, planten, vloerkleed, warm licht ----------
  for (const [a, w, h, z] of [[-0.18, 1.6, 1.15, 1], [-0.5, 1.2, 1.5, 2], [Math.PI + 0.18, 1.6, 1.15, 3], [Math.PI + 0.5, 1.2, 1.5, 4]]) {
    const p = P(WAND_R - 0.08, a, 3.4);
    const lijst2 = new THREE.Mesh(new THREE.BoxGeometry(w + 0.12, h + 0.12, 0.05), goud); lijst2.position.copy(p); lijst2.lookAt(0, 3.4, 0); scene.add(lijst2);
    const doek = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ map: maakKunst(z), roughness: 0.8 }));
    doek.position.copy(P(WAND_R - 0.11, a, 3.4)); doek.lookAt(0, 3.4, 0); scene.add(doek);
  }
  for (const [x, z, sc] of [[-7.6, -7.5, 1.1], [7.6, -7.5, 1.1], [-5.0, -8.0, 0.8], [5.0, -8.0, 0.8], ...[BOOG[0] - 0.2, BOOG[1] + 0.2].map(a => [P(9.2, a).x, P(9.2, a).z, 1.2])]) maakPlant(scene, x, z, sc);
  const kleed = new THREE.Mesh(new THREE.CircleGeometry(4.3, 96), new THREE.MeshStandardMaterial({ map: maakKleed(), roughness: 0.95, polygonOffset: true, polygonOffsetFactor: -1 }));
  kleed.rotation.x = -Math.PI / 2; kleed.position.set(0, 0.004, 0.4); kleed.receiveShadow = true; scene.add(kleed);
  const cove = new THREE.Mesh(sector(BALKON_R + 0.02, BALKON_R + 0.06, BOOG[0] - 0.12, BOOG[1] + 0.12, 0.03), new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffd9a0, emissiveIntensity: 1.6 }));
  cove.position.y = balkonY - 0.04; scene.add(cove);

  // ---------- de voorzitter ----------
  const vz = voorzitter ? maakFiguur(voorzitter.look || {}) : null;
  if (vz) { vz.root.position.copy(VZ_PLEK); vz.root.rotation.y = 0; zetZit(vz, 1); scene.add(vz.root); }
  const vzLid = vz ? { t: voorzitter, fig: vz, isVz: true, label: naamLabel('Voorzitter', '#B8862B') } : null;
  if (vzLid) scene.add(vzLid.label);
  let hamerT = -1;

  for (const m of werpers) m.castShadow = true;

  // ---------- toestand vanuit de speler ----------
  let s = null, spreker = null, laatsteTekst = '', vorigeFase = '', laatsteStemmer = null;
  const vorigeStemmen = new Set();
  function update(nieuw) {
    s = nieuw;
    if (s.fase !== vorigeFase) {
      if ((s.fase === 'stemming' || s.fase === 'uitslag') && vorigeFase && vorigeFase !== 'wachten') hamerT = 0;
      if (s.fase !== 'stemming') { for (const l of leden) { l.gestemd = false; } vorigeStemmen.clear(); }
      vorigeFase = s.fase;
    }
    for (const id of Object.keys(s.stemmen || {})) if (!vorigeStemmen.has(id)) { vorigeStemmen.add(id); laatsteStemmer = leden.find(l => l.t.id === id) || laatsteStemmer; }
    spreker = s.spreker === 'voorzitter' ? vzLid : leden.find(l => l.t.id === s.spreker) || null;
    for (const l of leden) {
      const st = s.stemmen?.[l.t.id]?.stem;
      // stemmen zijn geheim tot de uitslag: tijdens de stemming alleen "gestemd" tonen
      const kleur = l === spreker ? KLEUR.spreekt : s.fase === 'uitslag' && st === 'VOOR' ? KLEUR.voor : s.fase === 'uitslag' && st === 'TEGEN' ? KLEUR.tegen : KLEUR.rust;
      l.strip.material.color.setHex(kleur); l.strip.material.emissive.setHex(kleur); l.strip.material.emissiveIntensity = kleur === KLEUR.rust ? 0.2 : 0.7;
      l.micLamp.visible = l === spreker && l.plek === 'zetel';
    }
    if (spreker && s.tekst !== laatsteTekst) {
      laatsteTekst = s.tekst;
      const nu = klok.elapsedTime, emo = s.emotie || raadEmotie(s.tekst);
      spreker.emo = emo; spreker.emoTot = nu + 9;
      // wie bij naam genoemd wordt, reageert
      for (const l of leden) if (l !== spreker && new RegExp(`\\b${l.t.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(s.tekst)) { l.emo = emo === 'blij' ? 'blij' : emo === 'boos' ? 'boos' : 'verbaasd'; l.emoTot = nu + 5; }
      const isVz = spreker === vzLid;
      bubble.innerHTML = `<div class="who" style="color:${isVz ? '#8A6418' : '#C2410C'}">${isVz ? '🔨 ' : ''}${esc(spreker.t.name)} <span style="font-weight:500;color:#5b6180">· ${esc(spreker.t.role)}</span></div>${esc(s.tekst)}<div>${bronChips(s.bronnen || [])}</div>`;
      bubble.style.animation = 'none'; void bubble.offsetWidth; bubble.style.animation = '';
    }
    bubble.hidden = !spreker || !s.tekst;
    tekenScherm();
  }

  function gewenstePlek(l) {
    if (!s) return 'zetel';
    if (s.fase === 'stemming') return l.gestemd ? 'zetel' : 'hokje';
    if (s.fase === 'debat' && s.voorstel?.door === l.t.id) return 'podium';
    return 'zetel';
  }
  const doelVan = (l, plek) => plek === 'podium' ? SPREKER_PLEK : plek === 'hokje' ? l.hokje.binnen : l.zetel;
  const naderingVan = (l, plek) => plek === 'podium' ? new THREE.Vector3(Math.cos(l.a) < 0 ? -1.15 : 1.15, 0, SPREKER_PLEK.z) : plek === 'hokje' ? l.hokje.voor : null;
  function boog(a0, a1, r) {
    const n = Math.max(1, Math.ceil(Math.abs(a1 - a0) / 0.1)), uit = [];
    for (let k = 1; k <= n; k++) uit.push(P(r, a0 + (a1 - a0) * k / n));
    return uit;
  }
  function route(l, naar) {
    const p = l.fig.root.position, r = Math.hypot(p.x, p.z), a = Math.atan2(p.z, p.x);
    const inRij = r > R0 - 0.45 && p.z > 0.2;
    const rPad = R0 + R_PAD, rPut = R0 + R_PUT, pts = [];
    if (naar === 'zetel') {
      if (inRij) pts.push(...boog(a, l.a, rPad));
      else {
        const n = naderingVan(l, l.plek); if (n && p.distanceTo(doelVan(l, l.plek)) < 0.3) pts.push(n.clone());
        pts.push(P(rPut, l.uitgang), P(rPad, l.uitgang), ...boog(l.uitgang, l.a, rPad));
      }
      pts.push(l.zetel.clone());
    } else {
      if (inRij) pts.push(P(rPad, a), ...boog(a, l.uitgang, rPad), P(rPut, l.uitgang));
      else { const n = naderingVan(l, l.plek); if (n && p.distanceTo(doelVan(l, l.plek)) < 0.3) pts.push(n.clone()); }
      pts.push(naderingVan(l, naar).clone(), doelVan(l, naar).clone());
    }
    return pts;
  }

  function stapLid(l, dt, t) {
    const wil = gewenstePlek(l);
    if (wil !== l.doelPlek) { l.doelPlek = wil; l.pad = route(l, wil); if (wil !== 'hokje') l.binnenT = 0; }
    const root = l.fig.root;
    const spreekt = spreker === l;
    let beweegt = false;
    if (l.pad.length) {
      // eerst opstaan, dan lopen
      if (l.zit > 0.12) l.zit += (0 - l.zit) * (1 - Math.exp(-dt * 7));
      else {
        const doel = l.pad[0], d = new THREE.Vector3().subVectors(doel, root.position); d.y = 0;
        const afst = d.length(), stap = SNELHEID * dt;
        if (afst <= stap) { root.position.copy(doel); l.pad.shift(); if (!l.pad.length) l.plek = l.doelPlek; }
        else { root.position.addScaledVector(d.normalize(), stap); l.yaw = draai(l.yaw, Math.atan2(d.x, d.z), dt * 9); }
        beweegt = true;
      }
    } else {
      // aangekomen
      const kijk = l.plek === 'zetel' ? naarMidden(l.a) : l.plek === 'podium' ? 0 : Math.PI;
      l.yaw = draai(l.yaw, kijk, dt * 6);
      const zitten = l.plek === 'zetel' && !spreekt;
      l.zit += ((zitten ? 1 : 0) - l.zit) * (1 - Math.exp(-dt * 5));
      if (l.plek === 'zetel') root.position.lerp(spreekt ? l.staan : l.zetel, 1 - Math.exp(-dt * 5));
      if (l.plek === 'hokje') {
        l.binnenT += dt;
        if (s?.stemmen?.[l.t.id] && l.binnenT > 1.5) l.gestemd = true;
      }
    }
    root.rotation.y = l.yaw;
    // looppas
    if (beweegt) { l.stap += dt * SNELHEID * 4.6; l.zwaai += (1 - l.zwaai) * (1 - Math.exp(-dt * 8)); }
    else l.zwaai += (0 - l.zwaai) * (1 - Math.exp(-dt * 8));
    const kijkNaar = spreker && spreker !== l ? spreker.fig.hoofdWereld() : null;
    zetUitdrukking(l, t, spreekt && !beweegt);
    pose(l.fig, { zit: l.zit, stap: l.stap, zwaai: l.zwaai, praat: spreekt && !beweegt, t, kijkNaar, yaw: l.yaw });
  }

  // ---------- gezichtsuitdrukking: emotie, knipperen en praten ----------
  function emotieVan(l, t) {
    if (s?.fase === 'uitslag' && s.uitslag && !l.isVz) {
      const st = s.stemmen?.[l.t.id]?.stem; if (!st) return 'neutraal';
      const aan = s.uitslag.uitkomst === 'UITGEVOERD';
      return (st === 'VOOR') === aan ? 'blij' : (l.t.id.length % 2 ? 'boos' : 'verdrietig');
    }
    if (l.isVz && s?.fase === 'uitslag') return 'zeker';
    if (l.emo && t < l.emoTot) return l.emo;
    return 'neutraal';
  }
  function zetUitdrukking(l, t, praat) {
    if (!l.knipT) l.knipT = t + 1 + Math.random() * 4;
    const dicht = t > l.knipT && t < l.knipT + 0.13;
    if (t > l.knipT + 0.13) l.knipT = t + 2.2 + Math.random() * 3.5;
    const open = praat && Math.sin(t * 13 + (l.a || 0) * 7) > -0.1;
    l.fig.zetGezicht(emotieVan(l, t), open, dicht);
  }

  // ---------- scherm ----------
  function tekenScherm() {
    const g = schermCanvas.getContext('2d'), W = 1024, H = 380;
    const grad = g.createLinearGradient(0, 0, 0, H); grad.addColorStop(0, '#ffffff'); grad.addColorStop(1, '#F3F4FB');
    g.fillStyle = grad; g.fillRect(0, 0, W, H);
    const gestemd = (s?.voor || 0) + (s?.tegen || 0);
    const fase = { wachten: 'WACHT OP RONDE', analyse: 'ANALYSE', voorstel: 'VOORSTELLEN', debat: 'DEBAT LIVE', stemming: gestemd ? `STEMMING ${gestemd}/${leden.length}` : 'NAAR DE STEMHOKJES', uitslag: 'UITSLAG' }[s?.fase] || '';
    if (s?.spoed) { g.fillStyle = '#E11D48'; rond(g, 40, 30, 300, 50, 12); g.fill(); g.fillStyle = '#fff'; g.font = '800 30px Inter, sans-serif'; g.fillText('SPOEDZITTING', 58, 66); g.fillStyle = '#E11D48'; g.font = '700 28px Inter, sans-serif'; g.fillText(fase, 360, 66); }
    else { g.fillStyle = '#F25600'; g.font = '700 30px Inter, sans-serif'; g.fillText(`RONDE ${s?.round?.no ?? ''}  ·  ${fase}`, 48, 66); }
    const p = s?.uitslag?.bedrag && s?.voorstel ? { ...s.voorstel, bedrag: s.uitslag.bedrag } : s?.voorstel;
    g.fillStyle = '#0E1220'; g.font = '700 92px "Space Grotesk", Inter, sans-serif';
    g.fillText(p ? `${p.actie === 'KOOP' ? 'KOOP' : 'VERKOOP'} €${Math.round(p.bedrag)} ${p.asset}` : 'Analyse van de bronnen…', 48, 180);
    const n = leden.length || 10, bw = W - 96;
    // tijdens de stemming geheim: alleen de voortgang, bij de uitslag pas voor/tegen
    const open = s?.fase === 'uitslag';
    const voor = open ? s.voor : 0, tegen = open ? s.tegen : 0;
    g.fillStyle = '#E7EAF2'; rond(g, 48, 230, bw, 34, 17); g.fill();
    if (open) { g.fillStyle = '#10B981'; rond(g, 48, 230, Math.max(0.01, bw * voor / n), 34, 17); g.fill(); g.fillStyle = '#F97316'; g.fillRect(48 + bw * voor / n, 230, bw * tegen / n, 34); }
    else if (s?.fase === 'stemming') { g.fillStyle = '#FDBA74'; rond(g, 48, 230, Math.max(0.01, bw * gestemd / n), 34, 17); g.fill(); }
    g.fillStyle = '#0E1220'; g.fillRect(48 + bw * 0.6 - 2, 220, 4, 54);
    g.font = '600 30px Inter, sans-serif';
    if (open) {
      g.fillStyle = '#047857'; g.fillText(`${voor} voor`, 48, 320);
      g.fillStyle = '#C2410C'; const tt = `${tegen} tegen`; g.fillText(tt, W - 48 - g.measureText(tt).width, 320);
      g.fillStyle = s.uitslag?.uitkomst === 'UITGEVOERD' ? '#047857' : '#C2410C'; g.font = '800 34px Inter, sans-serif';
      const u = s.uitslag?.uitkomst === 'UITGEVOERD' ? 'AANGENOMEN' : (s.uitslag?.uitkomst || 'AFGEWEZEN'); g.fillText(u, W / 2 - g.measureText(u).width / 2, 320);
    } else { g.fillStyle = '#5B6180'; g.fillText(s?.fase === 'stemming' ? 'Geheime stemming · 6 stemmen voor nodig' : '6 van de 10 stemmen nodig', 48, 320); }
    schermTex.needsUpdate = true;
  }

  // ---------- camera ----------
  const STANDPUNTEN = {
    stoel: () => ({ pos: MIJN_OOG.clone(), doel: new THREE.Vector3(-0.4, 0.8, -3.4) }),
    overzicht: () => ({ pos: new THREE.Vector3(0, 5.6, 9.6), doel: new THREE.Vector3(0, 0.6, -2.2) }),
    voorzitter: () => ({ pos: new THREE.Vector3(1.15, 3.2, -7.95), doel: new THREE.Vector3(-0.3, 1.0, 3.2) }),
  };
  let modus = 'stoel', vlucht = null;
  function zetModus(m, stil = false) {
    modus = m;
    const sp = STANDPUNTEN[m];
    vlucht = sp ? { van: camera.position.clone(), vanDoel: controls.target.clone(), ...sp(), k: 0 } : null;
    if (!stil) onCamera?.(m);
  }
  controls.addEventListener('start', () => {
    const h = document.getElementById('dragHint'); if (h) h.style.opacity = '0';
    vlucht = null;
    if (modus !== 'vrij') { modus = 'vrij'; onCamera?.('vrij'); }
  });
  const volgDoel = new THREE.Vector3(), volgPos = new THREE.Vector3();
  function volgCamera(dt) {
    let pos = null, doel = null;
    if (modus === 'spreker') {
      const w = spreker || (s?.fase === 'stemming' || s?.fase === 'uitslag' ? vzLid : null);
      if (w) {
        const h = w.fig.hoofdWereld(), yaw = w.fig.root.rotation.y;
        const voor = new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), zij = new THREE.Vector3(voor.z, 0, -voor.x);
        pos = h.clone().addScaledVector(voor, w.isVz ? 3.4 : 2.5).addScaledVector(zij, 0.6).add(new THREE.Vector3(0, 0.25, 0));
        doel = h.clone().add(new THREE.Vector3(0, -0.12, 0));
      } else { const o = STANDPUNTEN.overzicht(); pos = o.pos; doel = o.doel; }
    } else if (modus === 'hokjes') {
      const kant = laatsteStemmer?.hokje?.kant ?? -1;
      pos = new THREE.Vector3(kant * 6.85, 2.7, 2.2); doel = new THREE.Vector3(kant * 6.85, 1.0, HOKJE_Z);
    }
    if (!pos) return;
    const k = 1 - Math.exp(-dt * 2.2);
    volgPos.copy(pos); volgDoel.copy(doel);
    camera.position.lerp(volgPos, k); controls.target.lerp(volgDoel, k);
  }
  // Houd de camera binnen de zaal en boven vloer, treden en meubels: zo vlieg je nergens doorheen.
  function begrens(v, marge = 0.6) {
    const r = Math.hypot(v.x, v.z), max = WAND_R - marge;
    if (r > max) { v.x *= max / r; v.z *= max / r; }
    if (v.z < ACHTERWAND_Z + marge) v.z = ACHTERWAND_Z + marge;
    let minY = 0.7;
    const a = Math.atan2(v.z, v.x), rr = Math.hypot(v.x, v.z);
    if (v.z > 0 && a > BOOG[0] - 0.1 && a < BOOG[1] + 0.1) {
      RIJEN.forEach((R, i) => { if (rr > R - 0.95) minY = Math.max(minY, i * TREDE + 1.0); });
      if (rr > BALKON_R - 0.15 && v.y < balkonY + 0.3 && v.y > balkonY - 0.6) v.y = v.y > balkonY - 0.15 ? balkonY + 0.3 : balkonY - 0.6;
    }
    if (Math.abs(v.x) < 4.7 && v.z < -5.4) minY = Math.max(minY, 2.0);         // voorzittersbank
    if (Math.abs(v.x) > 4.3 && Math.abs(v.x) < 9.6 && v.z < HOKJE_Z + 0.65 && v.z > HOKJE_Z - 0.65) minY = Math.max(minY, 2.5); // stemhokjes
    v.y = Math.min(PLAFOND - 0.5, Math.max(minY, v.y));
    return v;
  }

  // ---------- animatie ----------
  const klok = new THREE.Clock(); let loopt = false, raf = 0;
  const v = new THREE.Vector3();
  function frame() {
    if (!loopt) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.05, klok.getDelta()), t = klok.elapsedTime;
    for (const l of leden) stapLid(l, dt, t);
    // voorzitter: zit altijd, gebaart als ze praat, slaat met de hamer bij stemming en uitslag
    if (vz) {
      let hamerArm = 0;
      if (hamerT >= 0) { hamerT += dt; const k = hamerT / 1.1; hamerArm = k < 1 ? Math.abs(Math.sin(k * Math.PI * 2)) : 0; if (k >= 1) hamerT = -1; }
      zetUitdrukking(vzLid, t, spreker === vzLid);
      pose(vz, { zit: 1, stap: 0, zwaai: 0, praat: spreker === vzLid, t, kijkNaar: spreker && spreker !== vzLid ? spreker.fig.hoofdWereld() : null, yaw: 0, hamer: hamerArm });
      hamer.rotation.z = hamerArm * 0.6; hamer.position.y = 1.53 + hamerArm * 0.12;
    }
    // stemhokjes: gordijn dicht zolang er iemand in staat, lampje groen als die gestemd heeft
    for (const h of hokjes) {
      const l = leden.find(x => x.hokje === h);
      const binnen = l && l.plek === 'hokje' && !l.pad.length && l.fig.root.position.distanceTo(h.binnen) < 0.15;
      h.scharnier.scale.x += ((binnen ? 1 : 0.16) - h.scharnier.scale.x) * (1 - Math.exp(-dt * 5));
      const kleur = l && s?.fase === 'stemming' && l.gestemd ? 0x10b981 : binnen ? 0x6366f1 : 0xdfe3ec;
      h.lamp.material.emissive.setHex(kleur); h.lamp.material.emissiveIntensity = kleur === 0xdfe3ec ? 0.4 : 1.4;
    }
    for (const m of katheMics) m.visible = !!spreker && spreker.plek === 'podium';
    vzMic.visible = spreker === vzLid;
    for (const l of [...leden, vzLid]) if (l?.label) { l.label.position.copy(l.fig.hoofdWereld()).add(new THREE.Vector3(0, 0.45, 0)); l.label.visible = l !== spreker; }
    holo.rotation.z += dt * 0.35;
    holo.material.opacity = spreker && spreker.plek === 'podium' ? 0.75 : 0.35;
    if (spreker) { const h = spreker.fig.hoofdWereld(); spot.target.position.lerp(h, 0.12); spot.position.lerp(new THREE.Vector3(h.x * 0.6, PLAFOND - 0.6, h.z * 0.6 + 1.5), 0.08); spot.intensity += (38 - spot.intensity) * 0.08; }
    else spot.intensity *= 0.92;
    tekenKlok();

    if (vlucht) {
      vlucht.k = Math.min(1, vlucht.k + dt / 1.15);
      const e = vlucht.k < 0.5 ? 2 * vlucht.k ** 2 : 1 - (-2 * vlucht.k + 2) ** 2 / 2;
      camera.position.lerpVectors(vlucht.van, vlucht.pos, e); controls.target.lerpVectors(vlucht.vanDoel, vlucht.doel, e);
      if (vlucht.k >= 1) vlucht = null;
    } else volgCamera(dt);
    controls.update();
    begrens(camera.position); begrens(controls.target, 0.9);
    renderer.render(scene, camera);

    if (spreker && !bubble.hidden) {
      v.copy(spreker.fig.hoofdWereld()).add(new THREE.Vector3(0, 0.55, 0)).project(camera);
      const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight, half = bubble.offsetWidth / 2 + 12;
      if (v.z < 1 && Math.abs(v.x) < 1.15) { bubble.style.left = Math.min(w - half, Math.max(half, (v.x * 0.5 + 0.5) * w)) + 'px'; bubble.style.top = Math.max(170, (-v.y * 0.5 + 0.5) * h) + 'px'; bubble.style.visibility = 'visible'; }
      else bubble.style.visibility = 'hidden';
    }
  }
  function resize() {
    const w = renderer.domElement.clientWidth || container.clientWidth, h = renderer.domElement.clientHeight || container.clientHeight;
    renderer.setSize(w, h, false); camera.aspect = w / h;
    camera.fov = w < h ? 66 : 52; camera.updateProjectionMatrix();
  }
  addEventListener('resize', () => loopt && resize());
  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => loopt && resize()).observe(renderer.domElement);

  camera.position.copy(STANDPUNTEN.stoel().pos); controls.target.copy(STANDPUNTEN.stoel().doel); controls.update();
  return {
    update,
    start() { if (loopt) return; loopt = true; resize(); klok.getDelta(); frame(); },
    stop() { loopt = false; cancelAnimationFrame(raf); },
    camera(m) { zetModus(m, true); },
    naarStoel() { zetModus('stoel', true); },
  };
}

// ======================================================================
// Mii-stijl figuur: groot rond hoofd met een expressief gezicht, klein lijfje
// ======================================================================
const HEUP_STAAN = 0.8, HEUP_ZIT = 0.53, HR = 0.2;
const ROMP_GEO = new THREE.LatheGeometry([[0, 0], [0.15, 0], [0.172, 0.07], [0.17, 0.2], [0.152, 0.32], [0.125, 0.41], [0.07, 0.465], [0, 0.475]].map(([x, y]) => new THREE.Vector2(x, y)), 28);
const GEZICHT_GEO = () => new THREE.SphereGeometry(HR * 1.006, 40, 24, Math.PI / 2 - 1.05, 2.1, 0.6, 1.7);

function maakFiguur(look) {
  const std = (c, o = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.7, ...o });
  const huid = std(look.skin || '#F1C7A5', { roughness: 0.5 });
  const jas = std(look.shirt || '#1E40AF', { roughness: 0.6 });
  const broek = std(0x2a3040, { roughness: 0.8 });
  const schoen = std(0x1a1c22, { roughness: 0.35 });
  const haar = std(look.hair || '#6B7280', { roughness: 0.75 });
  const mesh = (geo, mat, parent, x = 0, y = 0, z = 0) => { const m = new THREE.Mesh(geo, mat); m.position.set(x, y, z); m.castShadow = true; m.receiveShadow = true; parent.add(m); return m; };

  const root = new THREE.Group();
  const heup = new THREE.Group(); heup.position.y = HEUP_STAAN; root.add(heup);
  mesh(new THREE.CapsuleGeometry(0.115, 0.08, 4, 14), broek, heup, 0, 0.02, 0).scale.set(1.25, 0.8, 0.9);
  const been = x => {
    const dij = new THREE.Group(); dij.position.x = x; heup.add(dij);
    mesh(new THREE.CapsuleGeometry(0.07, 0.24, 4, 12), broek, dij, 0, -0.19, 0);
    const knie = new THREE.Group(); knie.position.y = -0.38; dij.add(knie);
    mesh(new THREE.CapsuleGeometry(0.062, 0.22, 4, 12), broek, knie, 0, -0.17, 0);
    mesh(new THREE.CapsuleGeometry(0.055, 0.1, 4, 10), schoen, knie, 0, -0.355, 0.045).rotation.x = Math.PI / 2;
    return { dij, knie };
  };
  const bL = been(-0.085), bR = been(0.085);
  const romp = new THREE.Group(); heup.add(romp);
  mesh(ROMP_GEO, jas, romp).scale.z = 0.74;
  if (look.tie) {
    mesh(new THREE.BoxGeometry(0.09, 0.15, 0.01), std(0xf8fafc), romp, 0, 0.37, 0.104).rotation.x = -0.28;
    mesh(new THREE.BoxGeometry(0.036, 0.17, 0.012), std(look.tie), romp, 0, 0.33, 0.115).rotation.x = -0.2;
  } else {
    mesh(new THREE.TorusGeometry(0.06, 0.018, 8, 20), std(0xf4f4f2), romp, 0, 0.455, 0.004).rotation.x = Math.PI / 2;
  }
  const arm = k => {
    const schouder = new THREE.Group(); schouder.position.set(k * 0.155, 0.38, 0); romp.add(schouder);
    mesh(new THREE.CapsuleGeometry(0.05, 0.12, 4, 10), jas, schouder, 0, -0.11, 0);
    const elleboog = new THREE.Group(); elleboog.position.y = -0.2; schouder.add(elleboog);
    mesh(new THREE.CapsuleGeometry(0.046, 0.1, 4, 10), jas, elleboog, 0, -0.085, 0);
    mesh(new THREE.SphereGeometry(0.056, 14, 12), huid, elleboog, 0, -0.19, 0);
    return { schouder, elleboog };
  };
  const aL = arm(-1), aR = arm(1);
  const hoofd = new THREE.Group(); hoofd.position.y = 0.66; romp.add(hoofd);
  const kop = new THREE.Group(); kop.scale.set(1, 1.06, 0.96); hoofd.add(kop);
  mesh(new THREE.SphereGeometry(HR, 40, 28), huid, kop);
  for (const k of [-1, 1]) mesh(new THREE.SphereGeometry(0.048, 12, 10), huid, kop, k * HR * 0.96, -0.012, -0.01).scale.set(0.55, 1, 0.8);
  const gezicht = maakGezicht(look);
  const gMat = new THREE.MeshStandardMaterial({ map: gezicht.tex('neutraal', false, false), transparent: true, roughness: 0.5, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 });
  kop.add(new THREE.Mesh(GEZICHT_GEO(), gMat));
  maakKapsel(look, kop, haar, HR, mesh);

  const fig = { root, heup, romp, hoofd, bL, bR, aL, aR, uitdr: 'neutraal|0|0' };
  const tmp = new THREE.Vector3();
  fig.hoofdWereld = () => { hoofd.getWorldPosition(tmp); return tmp.clone(); };
  fig.zetGezicht = (emo, open, dicht) => {
    const key = `${emo}|${+open}|${+dicht}`; if (key === fig.uitdr) return;
    fig.uitdr = key; gMat.map = gezicht.tex(emo, open, dicht);
  };
  zetZit(fig, 1);
  return fig;
}

function maakKapsel(look, kop, mat, R, mesh) {
  const stijl = look.look || 'short';
  const kap = (rf, theta, phiStart = 0, phiLen = Math.PI * 2, t0 = 0) => mesh(new THREE.SphereGeometry(R * rf, 32, 16, phiStart, phiLen, t0, theta), mat, kop);
  const achter = (rf, tot) => kap(rf, tot, Math.PI / 2 + 0.95, Math.PI * 2 - 1.9);
  if (stijl === 'bald') { mesh(new THREE.SphereGeometry(R * 1.03, 24, 10, Math.PI / 2 + 1.1, Math.PI * 2 - 2.2, 1.3, 0.55), mat, kop); return; }
  if (stijl === 'beanie') {
    kap(1.1, 1.08);
    const band = mesh(new THREE.TorusGeometry(R * 1.0, R * 0.12, 10, 32), mat, kop, 0, R * 0.46, 0); band.rotation.x = Math.PI / 2;
    mesh(new THREE.SphereGeometry(R * 0.2, 10, 8), mat, kop, 0, R * 1.12, 0);
    return;
  }
  // Mii-kapsel: dikke kap met een pony die tot net boven de wenkbrauwen valt
  kap(stijl === 'curly' ? 1.13 : 1.08, stijl === 'slick' ? 1.0 : 1.08);
  achter(stijl === 'curly' ? 1.11 : 1.07, stijl === 'bob' ? 2.25 : stijl === 'long' ? 2.4 : 1.85);
  if (['short', 'bob', 'long', 'bun', 'ponytail'].includes(stijl)) {
    const pony = mesh(new THREE.SphereGeometry(R * 1.085, 28, 8, Math.PI / 2 - 0.95, 1.9, 0.92, 0.18), mat, kop);
    pony.rotation.y = stijl === 'short' ? 0.15 : 0;
  }
  if (stijl === 'slick') { const kuif = mesh(new THREE.SphereGeometry(R * 0.5, 16, 10), mat, kop, R * 0.15, R * 0.78, R * 0.35); kuif.scale.set(1.5, 0.6, 1); }
  if (stijl === 'long') { const m = mesh(new THREE.CapsuleGeometry(R * 0.75, R * 0.9, 6, 16), mat, kop, 0, -R * 1.05, -R * 0.45); m.scale.set(1.25, 1, 0.55); }
  if (stijl === 'bun') mesh(new THREE.SphereGeometry(R * 0.42, 16, 12), mat, kop, 0, R * 1.02, -R * 0.45);
  if (stijl === 'ponytail') { const m = mesh(new THREE.CapsuleGeometry(R * 0.24, R * 1.3, 4, 10), mat, kop, 0, -R * 0.5, -R * 1.05); m.rotation.x = 0.35; }
  if (stijl === 'spiky') for (let i = 0; i < 9; i++) { const a = i / 9 * Math.PI * 2; const c = mesh(new THREE.ConeGeometry(R * 0.2, R * 0.55, 8), mat, kop, Math.cos(a) * R * 0.5, R * 0.98, Math.sin(a) * R * 0.5 - R * 0.05); c.rotation.set(Math.sin(a) * 0.55, 0, -Math.cos(a) * 0.55); }
  if (stijl === 'curly') for (let i = 0; i < 14; i++) { const a = i / 14 * Math.PI * 2; mesh(new THREE.SphereGeometry(R * 0.3, 12, 10), mat, kop, Math.cos(a) * R * 0.88, R * (0.55 + (i % 2) * 0.22), Math.sin(a) * R * 0.88 - (Math.sin(a) > 0.6 ? R * 0.3 : 0)); }
}

// ---------- gezichten met emoties (Mii-stijl), per uitdrukking één keer getekend ----------
function maakGezicht(l) {
  const cache = new Map();
  return {
    tex(emo, open, dicht) {
      const key = `${emo}|${+open}|${+dicht}`;
      if (!cache.has(key)) {
        const c = document.createElement('canvas'); c.width = 512; c.height = 256;
        tekenGezicht(c.getContext('2d'), l, emo, open, dicht);
        const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; cache.set(key, t);
      }
      return cache.get(key);
    },
  };
}
function tekenGezicht(g, l, emo, open, dicht) {
  const W = 512, H = 256, X = p => (p + 1.05) / 2.1 * W, Y = t => (t - 0.6) / 1.7 * H;
  const sx = W / 2.1, sy = H / 1.7 / 1.06;
  const ell = (p, t, rx, ry, rot = 0) => { g.beginPath(); g.ellipse(X(p), Y(t), rx * sx, ry * sy, rot, 0, Math.PI * 2); };
  const huid = l.skin || '#F1C7A5';
  const donker = ['#8D5A3B', '#C68863', '#D9A27A'].includes(String(huid).toUpperCase());
  const lijn = donker ? '#2a1a12' : '#3b2a22';
  const brauw = (l.look === 'beanie' || l.look === 'bald') ? '#3F2A1E' : (l.hair || '#3F2A1E');
  const oogKleur = ['#4B5563', '#3B6EA8', '#5B3A24', '#2F6B4F'][[...(l.shirt || 'x')].reduce((a, c) => a + c.charCodeAt(0), 0) % 4];
  g.lineCap = 'round'; g.lineJoin = 'round';
  // Mii: grote gezichtstrekken, dus alles iets uitvergroten rond het midden van het gezicht
  g.translate(X(0), Y(1.58)); g.scale(1.28, 1.25); g.translate(-X(0), -Y(1.58));

  if (l.beard) {
    g.fillStyle = l.hair || '#4B3428';
    g.beginPath(); g.moveTo(X(-0.92), Y(1.5)); g.quadraticCurveTo(X(-0.85), Y(2.28), X(0), Y(2.26)); g.quadraticCurveTo(X(0.85), Y(2.28), X(0.92), Y(1.5));
    g.quadraticCurveTo(X(0.5), Y(1.74), X(0), Y(1.72)); g.quadraticCurveTo(X(-0.5), Y(1.74), X(-0.92), Y(1.5)); g.fill();
  }
  // blosjes
  if (['blij', 'verbaasd', 'neutraal', 'zeker'].includes(emo) || !donker) {
    g.fillStyle = emo === 'blij' ? 'rgba(244,63,94,.32)' : 'rgba(244,63,94,.14)';
    for (const k of [-1, 1]) { ell(k * 0.52, 1.7, 0.12, 0.07); g.fill(); }
  }
  // wenkbrauwen: [binnen, buiten] verschuiving (positief = lager)
  const B = { neutraal: [0, 0], blij: [-0.04, -0.02], boos: [0.1, -0.05], bezorgd: [-0.08, 0.05], verdrietig: [-0.07, 0.07], verbaasd: [-0.12, -0.1], zeker: [0.02, -0.02] }[emo] || [0, 0];
  g.strokeStyle = brauw; g.lineWidth = 13;
  for (const k of [-1, 1]) {
    const scheef = emo === 'zeker' && k < 0 ? -0.08 : 0;
    g.beginPath(); g.moveTo(X(k * 0.12), Y(1.27 + B[0] + scheef)); g.quadraticCurveTo(X(k * 0.29), Y(1.22 + (B[0] + B[1]) / 2 + scheef - (emo === 'blij' ? 0.04 : 0)), X(k * 0.46), Y(1.28 + B[1] + scheef)); g.stroke();
  }
  // ogen
  for (const k of [-1, 1]) {
    const p = k * 0.28, t = 1.47, groot = emo === 'verbaasd' ? 1.18 : 1;
    if (dicht || (emo === 'blij' && open === 'lach')) {
      g.strokeStyle = lijn; g.lineWidth = 6; g.beginPath(); g.moveTo(X(p - 0.1), Y(t)); g.quadraticCurveTo(X(p), Y(t + 0.05), X(p + 0.1), Y(t)); g.stroke(); continue;
    }
    g.fillStyle = '#fff'; ell(p, t, 0.105 * groot, 0.125 * groot); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 2.5; g.stroke();
    const kijk = emo === 'bezorgd' ? -0.02 : 0;
    g.fillStyle = oogKleur; ell(p + kijk, t + 0.01, 0.068 * (emo === 'verbaasd' ? 0.8 : 1), 0.083 * (emo === 'verbaasd' ? 0.8 : 1)); g.fill();
    g.fillStyle = '#0b0b10'; ell(p + kijk, t + 0.01, 0.036, 0.044); g.fill();
    g.fillStyle = '#fff'; ell(p + kijk + 0.025, t - 0.03, 0.02, 0.022); g.fill();
    // oogleden voor de emotie (in huidkleur)
    g.fillStyle = huid;
    if (emo === 'blij') { ell(p, t + 0.16, 0.14, 0.1); g.fill(); }
    const lid = (yBinnen, yBuiten) => { const yR = k > 0 ? yBuiten : yBinnen, yL = k > 0 ? yBinnen : yBuiten; g.beginPath(); g.moveTo(X(p - 0.14), Y(t - 0.18)); g.lineTo(X(p + 0.14), Y(t - 0.18)); g.lineTo(X(p + 0.14), Y(yR)); g.lineTo(X(p - 0.14), Y(yL)); g.closePath(); g.fill(); };
    if (emo === 'boos') lid(t - 0.02, t - 0.11);
    if (emo === 'bezorgd' || emo === 'verdrietig') lid(t - 0.11, t - 0.04);
    if (emo === 'zeker') { g.fillRect(X(p - 0.13), Y(t - 0.17), 0.26 * sx, 0.1 * sy); }
  }
  // neus
  g.strokeStyle = 'rgba(0,0,0,.28)'; g.lineWidth = 5;
  g.beginPath(); g.moveTo(X(-0.05), Y(1.6)); g.quadraticCurveTo(X(0), Y(1.69), X(0.05), Y(1.6)); g.stroke();
  // mond (extra groot, Mii-stijl)
  const mt = 1.82; g.save(); g.translate(X(0), Y(mt)); g.scale(1.55, 1.45); g.translate(-X(0), -Y(mt)); g.lineWidth = 6; g.strokeStyle = '#8f3530';
  const binnenMond = () => { g.fillStyle = '#7a2228'; g.fill(); };
  if (open) {
    if (emo === 'blij') { g.beginPath(); g.moveTo(X(-0.17), Y(mt - 0.02)); g.quadraticCurveTo(X(0), Y(mt + 0.17), X(0.17), Y(mt - 0.02)); g.closePath(); binnenMond(); g.fillStyle = '#fff'; g.fillRect(X(-0.13), Y(mt - 0.01), 0.26 * sx, 0.03 * sy); }
    else if (emo === 'verbaasd') { ell(0, mt + 0.02, 0.06, 0.08); binnenMond(); }
    else if (emo === 'boos') { g.beginPath(); g.moveTo(X(-0.15), Y(mt + 0.05)); g.quadraticCurveTo(X(0), Y(mt - 0.05), X(0.15), Y(mt + 0.05)); g.lineTo(X(0.13), Y(mt + 0.09)); g.lineTo(X(-0.13), Y(mt + 0.09)); g.closePath(); binnenMond(); g.fillStyle = '#fff'; g.fillRect(X(-0.11), Y(mt + 0.0), 0.22 * sx, 0.025 * sy); }
    else { ell(0, mt + 0.015, 0.1, 0.055); binnenMond(); g.fillStyle = '#e8737a'; ell(0, mt + 0.045, 0.06, 0.022); g.fill(); }
  } else {
    g.beginPath();
    if (emo === 'blij') { g.moveTo(X(-0.17), Y(mt - 0.02)); g.quadraticCurveTo(X(0), Y(mt + 0.15), X(0.17), Y(mt - 0.02)); g.closePath(); binnenMond(); g.fillStyle = '#fff'; g.fillRect(X(-0.13), Y(mt - 0.01), 0.26 * sx, 0.03 * sy); g.beginPath(); }
    else if (emo === 'boos') { g.moveTo(X(-0.12), Y(mt + 0.05)); g.quadraticCurveTo(X(0), Y(mt - 0.03), X(0.12), Y(mt + 0.05)); }
    else if (emo === 'verdrietig') { g.moveTo(X(-0.12), Y(mt + 0.06)); g.quadraticCurveTo(X(0), Y(mt - 0.04), X(0.12), Y(mt + 0.06)); }
    else if (emo === 'bezorgd') { g.moveTo(X(-0.12), Y(mt + 0.02)); g.bezierCurveTo(X(-0.05), Y(mt - 0.03), X(0.03), Y(mt + 0.06), X(0.12), Y(mt)); }
    else if (emo === 'verbaasd') { ell(0, mt + 0.01, 0.045, 0.055); binnenMond(); g.beginPath(); }
    else if (emo === 'zeker') { g.moveTo(X(-0.11), Y(mt + 0.01)); g.quadraticCurveTo(X(0.02), Y(mt + 0.05), X(0.13), Y(mt - 0.04)); }
    else { g.moveTo(X(-0.1), Y(mt)); g.quadraticCurveTo(X(0), Y(mt + 0.04), X(0.1), Y(mt)); }
    g.stroke();
  }
  g.restore();
  // bril
  if (l.glasses) {
    g.strokeStyle = '#1F2937'; g.lineWidth = 7;
    for (const k of [-1, 1]) { const x = X(k * 0.28), y = Y(1.47); rond(g, x - 0.17 * sx, y - 0.15 * sy, 0.34 * sx, 0.3 * sy, 18); g.stroke(); }
    g.beginPath(); g.moveTo(X(-0.11), Y(1.45)); g.quadraticCurveTo(X(0), Y(1.41), X(0.11), Y(1.45)); g.stroke();
    g.beginPath(); g.moveTo(X(-0.45), Y(1.44)); g.lineTo(X(-1.0), Y(1.42)); g.moveTo(X(0.45), Y(1.44)); g.lineTo(X(1.0), Y(1.42)); g.stroke();
  }
}

// Publiek: zelfde Mii-stijl, maar in een paar InstancedMeshes zodat je telefoon het trekt
function maakPubliek(scene, plekken, rnd) {
  const JAS = [0x1f2a44, 0x3a3f4b, 0x6b7280, 0x9a3412, 0x9a7b4f, 0xe5e7eb, 0x0f766e, 0x4338ca, 0x111827, 0xbe185d, 0x65a30d, 0xea580c];
  const HUID = [0xf1c7a5, 0xe8b896, 0xd9a27a, 0x8d5a3b, 0xf6d1b5, 0xc68863];
  const HAAR = [0x1c1917, 0x4b3428, 0x7c4a2d, 0xd4a72c, 0x9ca3af, 0x2d2d2d, 0xa16207];
  const huidVan = [];
  const delen = [
    { geo: ROMP_GEO, kleur: JAS, m: o => o.position.set(0, HEUP_ZIT, 0), s: [1, 1, 0.74] },
    { geo: new THREE.BoxGeometry(0.28, 0.13, 0.4), kleur: [0x2a3040], m: o => o.position.set(0, HEUP_ZIT, 0.18) },
    { geo: new THREE.BoxGeometry(0.26, 0.4, 0.12), kleur: [0x2a3040], m: o => o.position.set(0, HEUP_ZIT - 0.2, 0.36) },
    { geo: new THREE.SphereGeometry(HR, 24, 18), kleur: HUID, m: o => o.position.set(0, HEUP_ZIT + 0.66, 0), s: [1, 1.06, 0.96], huid: true },
    { geo: new THREE.SphereGeometry(HR * 1.08, 24, 12, 0, Math.PI * 2, 0, 1.15), kleur: HAAR, m: o => o.position.set(0, HEUP_ZIT + 0.66, -0.005), s: [1, 1.06, 0.97] },
    { geo: GEZICHT_GEO(), kleur: [0xffffff], m: o => o.position.set(0, HEUP_ZIT + 0.66, 0), s: [1, 1.06, 0.96], gezicht: true },
  ];
  const keuzes = plekken.map(() => delen.map(d => d.kleur[Math.floor(rnd() * d.kleur.length)]));
  const neutraal = maakGezicht({ skin: '#E8B896', shirt: 'x' }).tex('neutraal', false, false);
  const basis = new THREE.Object3D(), deel = new THREE.Object3D(), c = new THREE.Color();
  const yaws = plekken.map(p => p.yaw + (rnd() - 0.5) * 0.3);
  delen.forEach((d, di) => {
    const mat = d.gezicht ? new THREE.MeshStandardMaterial({ map: neutraal, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, roughness: 0.6 }) : new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.7 });
    const inst = new THREE.InstancedMesh(d.geo, mat, plekken.length);
    plekken.forEach((p, i) => {
      basis.position.copy(p.pos); basis.rotation.set(0, yaws[i], 0); basis.updateMatrix();
      deel.position.set(0, 0, 0); deel.scale.set(...(d.s || [1, 1, 1])); d.m(deel); deel.updateMatrix();
      inst.setMatrixAt(i, basis.matrix.clone().multiply(deel.matrix));
      if (!d.gezicht) inst.setColorAt(i, c.setHex(keuzes[i][di]));
    });
    inst.castShadow = !d.gezicht; inst.receiveShadow = true; scene.add(inst);
  });
}

function maakPlant(scene, x, z, sc) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.scale.setScalar(sc);
  const pot = new THREE.Mesh(new THREE.CylinderGeometry(0.26, 0.2, 0.5, 20), new THREE.MeshStandardMaterial({ color: 0xf3f1ec, roughness: 0.6 })); pot.position.y = 0.25; g.add(pot);
  const groen = [0x2f7d4f, 0x3f9a5f, 0x256b43];
  for (let i = 0; i < 9; i++) {
    const a = i * 2.39, r = 0.12 + (i % 3) * 0.07;
    const blad = new THREE.Mesh(new THREE.SphereGeometry(0.2 + (i % 2) * 0.06, 10, 8), new THREE.MeshStandardMaterial({ color: groen[i % 3], roughness: 0.8 }));
    blad.position.set(Math.cos(a) * r, 0.65 + i * 0.09, Math.sin(a) * r); blad.scale.set(1, 1.3, 1); blad.castShadow = true; g.add(blad);
  }
  pot.castShadow = true; scene.add(g);
}
function naamLabel(naam, kleur) {
  const c = document.createElement('canvas'), g = c.getContext('2d');
  g.font = '700 40px Inter, sans-serif';
  const w = Math.ceil(g.measureText(naam).width) + 64; c.width = w; c.height = 60;
  g.font = '700 40px Inter, sans-serif';
  g.fillStyle = 'rgba(255,255,255,.94)'; rond(g, 0, 0, w, 60, 30); g.fill();
  g.fillStyle = kleur; g.beginPath(); g.arc(28, 30, 9, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#0E1220'; g.fillText(naam, 46, 44);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false }));
  sp.scale.set(0.14 * w / 60, 0.14, 1); sp.renderOrder = 5; return sp;
}
function maakKunst(zaad) {
  const c = document.createElement('canvas'); c.width = 384; c.height = 384; const g = c.getContext('2d');
  let i = zaad * 9301; const rnd = () => ((i = (i * 16807) % 2147483647) / 2147483647);
  g.fillStyle = '#F7F3EA'; g.fillRect(0, 0, 384, 384);
  const pal = ['#4F46E5', '#B8862B', '#0F766E', '#E11D48', '#1E1B4B', '#A5B4FC', '#F59E0B'];
  for (let k = 0; k < 9; k++) {
    g.fillStyle = pal[Math.floor(rnd() * pal.length)]; g.globalAlpha = 0.55 + rnd() * 0.4;
    if (rnd() < 0.5) g.fillRect(rnd() * 300, rnd() * 300, 40 + rnd() * 140, 20 + rnd() * 120);
    else { g.beginPath(); g.arc(rnd() * 384, rnd() * 384, 20 + rnd() * 90, 0, Math.PI * 2); g.fill(); }
  }
  g.globalAlpha = 1; g.strokeStyle = '#1F2937'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(20, 300); for (let x = 20; x < 370; x += 25) g.lineTo(x, 300 - rnd() * 160 - (x / 370) * 60); g.stroke();
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function maakKleed() {
  const c = document.createElement('canvas'); c.width = c.height = 512; const g = c.getContext('2d');
  g.fillStyle = '#C9CCE6'; g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 4000; i++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.25)' : 'rgba(60,60,120,.12)'; g.fillRect(Math.random() * 512, Math.random() * 512, 1.4, 1.4); }
  g.strokeStyle = '#B8862B'; g.lineWidth = 7; g.beginPath(); g.arc(256, 256, 238, 0, Math.PI * 2); g.stroke();
  g.strokeStyle = 'rgba(79,70,229,.55)'; g.lineWidth = 3; g.beginPath(); g.arc(256, 256, 222, 0, Math.PI * 2); g.stroke();
  for (let k = 0; k < 24; k++) { const a = k / 24 * Math.PI * 2; g.fillStyle = '#B8862B'; g.beginPath(); g.arc(256 + Math.cos(a) * 230, 256 + Math.sin(a) * 230, 4, 0, Math.PI * 2); g.fill(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}

// Zet een figuur in een houding. zit 0 = staan, 1 = zitten.
function zetZit(f, zit) { pose(f, { zit, stap: 0, zwaai: 0, praat: false, t: 0 }); }
function pose(f, { zit, stap, zwaai, praat, t, kijkNaar, yaw = 0, hamer = 0 }) {
  const sw = Math.sin(stap) * 0.55 * zwaai;
  f.heup.position.y = HEUP_STAAN + (HEUP_ZIT - HEUP_STAAN) * zit + Math.abs(Math.cos(stap)) * 0.02 * zwaai;
  f.bL.dij.rotation.x = -Math.PI / 2 * zit + sw;
  f.bR.dij.rotation.x = -Math.PI / 2 * zit - sw;
  f.bL.knie.rotation.x = Math.PI / 2 * zit + Math.max(0, -Math.sin(stap)) * 0.7 * zwaai;
  f.bR.knie.rotation.x = Math.PI / 2 * zit + Math.max(0, Math.sin(stap)) * 0.7 * zwaai;
  f.romp.rotation.x = 0.06 * zit + 0.04 * zwaai;
  const adem = Math.sin(t * 1.6 + f.root.position.x) * 0.01;
  f.romp.scale.y = 1 + adem * 0.5;
  // armen: zittend met de onderarmen op het bankje, lopend zwaaiend, pratend gebarend
  const gebaar = praat ? Math.sin(t * 3.1) : 0;
  f.aL.schouder.rotation.set(-0.75 * zit - sw * 0.9, 0, -0.12);
  f.aL.elleboog.rotation.x = -0.75 * zit - 0.15 * (1 - zit) - Math.max(0, -sw) * 0.4;
  f.aR.schouder.rotation.set(-0.75 * zit + sw * 0.9 - (praat ? 0.55 + gebaar * 0.25 : 0) - hamer * 1.6, 0, 0.12);
  f.aR.elleboog.rotation.x = -0.75 * zit - 0.15 * (1 - zit) - (praat ? 0.7 + gebaar * 0.2 : 0) - hamer * 0.4;
  // hoofd: knikt bij praten, kijkt naar de spreker
  let hy = 0;
  if (kijkNaar) {
    const p = f.root.position, d = Math.atan2(kijkNaar.x - p.x, kijkNaar.z - p.z) - yaw;
    hy = Math.max(-0.9, Math.min(0.9, Math.atan2(Math.sin(d), Math.cos(d))));
  }
  f.hoofd.rotation.y += (hy - f.hoofd.rotation.y) * 0.08;
  f.hoofd.rotation.x = praat ? Math.sin(t * 5.3) * 0.05 : -0.04 * zit;
}
function raadEmotie(tekst = '') {
  const t = tekst.toLowerCase();
  if (/\?$/.test(t.trim()) && t.length < 80) return 'verbaasd';
  if (/(onzin|absurd|gewaarschuwd|nee[,.]|belachelijk|hype)/.test(t)) return 'boos';
  if (/(bang|angst|daal|dalend|verkoopt|risico|crash|oorlog|speculatief|onzeker)/.test(t)) return 'bezorgd';
  if (/(kans|herstel|stijg|winst|akkoord|prima|sterk|positief)/.test(t)) return 'blij';
  return 'zeker';
}
const draai = (a, b, k) => { let d = b - a; d = Math.atan2(Math.sin(d), Math.cos(d)); return a + d * Math.min(1, k); };

// ======================================================================
// texturen en hulpjes
// ======================================================================
function maakHoutTextuur(a, b) {
  const c = document.createElement('canvas'); c.width = 512; c.height = 64; const g = c.getContext('2d');
  g.fillStyle = a; g.fillRect(0, 0, 512, 64);
  for (let i = 0; i < 70; i++) { g.strokeStyle = Math.random() < 0.5 ? b : 'rgba(255,240,220,.25)'; g.globalAlpha = 0.25 + Math.random() * 0.3; g.lineWidth = 0.6 + Math.random() * 1.6; const y = Math.random() * 64; g.beginPath(); g.moveTo(0, y); g.bezierCurveTo(170, y + Math.random() * 6 - 3, 340, y + Math.random() * 6 - 3, 512, y); g.stroke(); }
  g.globalAlpha = 1;
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(0.35, 0.35); return t;
}
function maakTapijt(basis) {
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d');
  g.fillStyle = basis; g.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 3200; i++) { g.fillStyle = Math.random() < 0.5 ? 'rgba(255,255,255,.32)' : 'rgba(60,70,95,.16)'; g.fillRect(Math.random() * 256, Math.random() * 256, 1.3, 1.3); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(0.6, 0.6); return t;
}
function maakWandTextuur() {
  const c = document.createElement('canvas'); c.width = 256; c.height = 512; const g = c.getContext('2d');
  g.fillStyle = '#F6F4EF'; g.fillRect(0, 0, 256, 512);
  const hoogteHout = 512 * (2.6 / 7.8);
  g.fillStyle = '#C38D52'; g.fillRect(0, 512 - hoogteHout, 256, hoogteHout);
  for (let x = 0; x < 256; x += 16) { g.fillStyle = 'rgba(80,45,15,.28)'; g.fillRect(x, 512 - hoogteHout, 3, hoogteHout); }
  g.fillStyle = '#B8862B'; g.fillRect(0, 512 - hoogteHout - 6, 256, 5);
  for (let y = 40; y < 512 - hoogteHout - 20; y += 70) { g.fillStyle = 'rgba(0,0,0,.035)'; g.fillRect(0, y, 256, 2); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.wrapS = THREE.RepeatWrapping; t.repeat.set(18, 1); return t;
}
function maakSteenTextuur() {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 512; const g = c.getContext('2d');
  g.fillStyle = '#EAE5DC'; g.fillRect(0, 0, 1024, 512);
  for (let y = 0; y < 512; y += 64) for (let x = (y / 64) % 2 ? -64 : 0; x < 1024; x += 128) {
    g.fillStyle = `rgba(${200 + Math.random() * 30},${190 + Math.random() * 30},${170 + Math.random() * 25},.35)`; g.fillRect(x + 2, y + 2, 124, 60);
  }
  g.strokeStyle = 'rgba(150,135,110,.25)'; g.lineWidth = 2;
  for (let y = 0; y < 512; y += 64) { g.beginPath(); g.moveTo(0, y); g.lineTo(1024, y); g.stroke(); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
function maakGordijn() {
  const c = document.createElement('canvas'); c.width = 128; c.height = 8; const g = c.getContext('2d');
  for (let x = 0; x < 128; x++) { const v = 200 + Math.sin(x / 128 * Math.PI * 12) * 45; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, 0, 1, 8); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
}
// Een ringsegment (deel van een halve cirkel) met hoogte, liggend op de vloer.
function sector(rIn, rUit, a0, a1, hoogte) {
  const vorm = new THREE.Shape(), n = Math.max(8, Math.ceil((a1 - a0) * rUit * 3));
  for (let k = 0; k <= n; k++) { const a = a0 + (a1 - a0) * k / n; const x = rUit * Math.cos(a), y = -rUit * Math.sin(a); k ? vorm.lineTo(x, y) : vorm.moveTo(x, y); }
  for (let k = n; k >= 0; k--) { const a = a0 + (a1 - a0) * k / n; vorm.lineTo(rIn * Math.cos(a), -rIn * Math.sin(a)); }
  const geo = new THREE.ExtrudeGeometry(vorm, { depth: hoogte, bevelEnabled: false, curveSegments: 1 });
  geo.rotateX(-Math.PI / 2);
  return geo;
}
function plaatje(tekst, { w, h, bg, fg, px }) {
  const c = document.createElement('canvas'), g = c.getContext('2d');
  c.width = Math.max(64, Math.round(128 * w / h)); c.height = 128;
  g.fillStyle = bg; rond(g, 0, 0, c.width, c.height, 22); g.fill();
  g.fillStyle = fg; g.font = `700 ${px * 1.6}px Inter, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  while (g.measureText(tekst).width > c.width - 24 && px > 8) { px -= 2; g.font = `700 ${px * 1.6}px Inter, sans-serif`; }
  g.fillText(tekst, c.width / 2, c.height / 2 + 4);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, transparent: true }));
}
function rond(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
