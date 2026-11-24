// WebGL scene: procedural Earth, nebula, stars, a constellation built from the real registered satellites,
// and a conjunction replay driven by the on-chain state of the selected event.
// Orbits and distances are illustrative (not to scale); what each object *means* comes from the chain.
import * as THREE from "three";

const CYAN = 0xffffff, VIOLET = 0xb4b4b2, GREEN = 0xffffff, AMBER = 0xe0e0dc, RED = 0xffffff;
const reduceMotion = typeof matchMedia !== "undefined" && matchMedia("(prefers-reduced-motion: reduce)").matches;

const NOISE = /* glsl */ `
float hash(vec3 p){ p = fract(p*0.3183099+.1); p*=17.0; return fract(p.x*p.y*p.z*(p.x+p.y+p.z)); }
float noise(vec3 x){ vec3 i=floor(x); vec3 f=fract(x); f=f*f*(3.0-2.0*f);
  return mix(mix(mix(hash(i),hash(i+vec3(1,0,0)),f.x),mix(hash(i+vec3(0,1,0)),hash(i+vec3(1,1,0)),f.x),f.y),
             mix(mix(hash(i+vec3(0,0,1)),hash(i+vec3(1,0,1)),f.x),mix(hash(i+vec3(0,1,1)),hash(i+vec3(1,1,1)),f.x),f.y),f.z); }
float fbm(vec3 p){ float a=.5,s=0.; for(int i=0;i<6;i++){ s+=a*noise(p); p*=2.03; a*=.5; } return s; }
`;

function rng(seed) {
  let a = (seed * 2654435761) >>> 0;
  return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

function glowTexture() {
  const c = document.createElement("canvas"); c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)"); grad.addColorStop(0.25, "rgba(255,255,255,.55)"); grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad; g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

export class SkyScene {
  constructor(canvas, labelRoot) {
    this.canvas = canvas;
    this.labelRoot = labelRoot;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance" });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 400);
    this.clock = new THREE.Clock();
    this.glow = glowTexture();
    this.mode = "overview";
    this.pointer = new THREE.Vector2();
    this.labels = [];
    this.camPos = new THREE.Vector3(0, 1.2, 5.6);
    this.camLook = new THREE.Vector3(0, 0, 0);
    this.camTargetPos = this.camPos.clone();
    this.camTargetLook = this.camLook.clone();
    this.shift = 0; this.shiftTarget = 0;
    this.data = { satellites: [], events: [] };
    this.satSig = ""; this.eventKey = ""; this.eventSig = "";
    this.ev = null;

    this.sun = new THREE.Vector3(5, 2.2, 3).normalize();
    this.#build();
    this.overview = new THREE.Group(); this.scene.add(this.overview);
    this.eventGroup = new THREE.Group(); this.scene.add(this.eventGroup); this.eventGroup.visible = false;

    this.onResize = this.#resize.bind(this);
    window.addEventListener("resize", this.onResize);
    window.addEventListener("pointermove", (e) => { this.pointer.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); });
    this.#resize();
    this.renderer.setAnimationLoop(() => this.#frame());
  }

  // ------------------------------------------------------------------------------------------ static world
  #build() {
    const scene = this.scene;
    scene.add(new THREE.AmbientLight(0x9a9a9a, 0.5));
    const sunLight = new THREE.DirectionalLight(0xffffff, 2.3); sunLight.position.copy(this.sun).multiplyScalar(30); scene.add(sunLight);

    // nebula backdrop
    const neb = new THREE.Mesh(new THREE.SphereGeometry(150, 48, 48), new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false,
      uniforms: { uTime: { value: 0 } },
      vertexShader: "varying vec3 vP; void main(){ vP = position; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader: `varying vec3 vP; uniform float uTime; ${NOISE}
        void main(){ vec3 d = normalize(vP);
          float n = fbm(d*2.2 + vec3(0.0,uTime*0.004,0.0)); float m = fbm(d*4.5 + 7.0);
          vec3 col = vec3(0.0) + vec3(0.035)*smoothstep(0.45,0.85,n)*smoothstep(0.4,0.9,m);
          gl_FragColor = vec4(col,1.0); }`,
    }));
    this.nebula = neb; scene.add(neb);

    // stars
    const N = 3500, pos = new Float32Array(N * 3);
    const r = rng(42);
    for (let i = 0; i < N; i++) {
      const u = r() * 2 - 1, t = r() * Math.PI * 2, rad = 60 + r() * 60, s = Math.sqrt(1 - u * u);
      pos.set([rad * s * Math.cos(t), rad * u, rad * s * Math.sin(t)], i * 3);
    }
    const sg = new THREE.BufferGeometry(); sg.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    this.stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.22, sizeAttenuation: true, transparent: true, opacity: 0.85, depthWrite: false }));
    scene.add(this.stars);

    // Earth
    this.earthMat = new THREE.ShaderMaterial({
      uniforms: { uSun: { value: this.sun } },
      vertexShader: `varying vec3 vPos; varying vec3 vNW; varying vec3 vW;
        void main(){ vPos = position; vNW = normalize(mat3(modelMatrix)*normal); vec4 w = modelMatrix*vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix*viewMatrix*w; }`,
      fragmentShader: `varying vec3 vPos; varying vec3 vNW; varying vec3 vW; uniform vec3 uSun; ${NOISE}
        void main(){
          vec3 p = normalize(vPos);
          float h = fbm(p*2.4+3.1);
          float land = smoothstep(0.50,0.535,h);
          float lat = asin(p.y); float lon = atan(p.z,p.x);
          // graticule every 15 degrees, hairline
          float gl = abs(fract(lat*3.8197+0.5)-0.5)/(fwidth(lat*3.8197)+1e-4);
          float gn = abs(fract(lon*2.3873+0.5)-0.5)/(fwidth(lon*2.3873)+1e-4);
          float grid = (1.0-min(min(gl,gn),1.0))*0.28;
          vec3 N = normalize(vNW); vec3 L = normalize(uSun); vec3 V = normalize(cameraPosition - vW);
          float ndl = dot(N,L); float day = smoothstep(-0.1,0.3,ndl);
          // land is ink-white hatched by relief; ocean is near-black
          float relief = fbm(p*9.0+4.0);
          float hatch = smoothstep(0.42,0.58,sin((p.x+p.y*0.6)*260.0+relief*9.0)*0.5+0.5);
          float landTone = mix(0.34,0.86,hatch*0.55+relief*0.45);
          float ocean = 0.012+0.02*smoothstep(0.2,0.5,h);
          float tone = mix(ocean, landTone, land);
          float lights = smoothstep(0.7,0.78,fbm(p*15.0+1.7))*land*(1.0-smoothstep(-0.05,0.18,ndl));
          float v = tone*(0.04+0.96*day) + lights*0.9 + grid*(0.35+0.65*day);
          float rim = pow(1.0-max(dot(N,V),0.0),3.2);
          v += rim*0.55*(0.2+0.8*day);
          vec3 lit = vec3(v);
          gl_FragColor = vec4(lit,1.0);
        }`,
    });
    this.earth = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 96), this.earthMat); scene.add(this.earth);

    this.cloudMat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, uniforms: { uSun: { value: this.sun }, uTime: { value: 0 } },
      vertexShader: `varying vec3 vPos; varying vec3 vNW; void main(){ vPos = position; vNW = normalize(mat3(modelMatrix)*normal); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `varying vec3 vPos; varying vec3 vNW; uniform vec3 uSun; uniform float uTime; ${NOISE}
        void main(){ vec3 p = normalize(vPos); float c = fbm(p*3.4 + vec3(uTime*0.01, 0.0, uTime*0.006));
          float a = smoothstep(0.52,0.78,c); float day = smoothstep(-0.15,0.3,dot(normalize(vNW),normalize(uSun)));
          gl_FragColor = vec4(vec3(1.0)*(0.15+0.85*day), a*0.18); }`,
    });
    this.clouds = new THREE.Mesh(new THREE.SphereGeometry(1.012, 64, 64), this.cloudMat); scene.add(this.clouds);

    this.atmo = new THREE.Mesh(new THREE.SphereGeometry(1.1, 64, 64), new THREE.ShaderMaterial({
      side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false,
      vertexShader: "varying vec3 vN; void main(){ vN = normalize(normalMatrix*normal); gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0);}",
      fragmentShader: "varying vec3 vN; void main(){ float i = pow(max(0.0, 0.68 - dot(vN, vec3(0.0,0.0,1.0))), 2.6)*2.1; gl_FragColor = vec4(vec3(1.0),1.0)*i*0.7; }",
    }));
    scene.add(this.atmo);
  }

  // ------------------------------------------------------------------------------------------ resize / labels
  #resize() {
    const w = this.canvas.clientWidth || innerWidth, h = this.canvas.clientHeight || innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.size = { w, h };
    this.shiftTarget = w > 1000 ? w * 0.17 : 0;
    this.#applyShift();
  }
  #applyShift() {
    const { w, h } = this.size;
    this.camera.setViewOffset(w, h, -this.shift, 0, w, h);
    this.camera.updateProjectionMatrix();
  }
  #label(text, cls) {
    const el = document.createElement("div"); el.className = "sat-label " + (cls || ""); el.textContent = text;
    this.labelRoot.append(el);
    const l = { el, pos: new THREE.Vector3(), show: true };
    this.labels.push(l);
    return l;
  }
  #dropLabels(list) { for (const l of list) { l.el.remove(); this.labels.splice(this.labels.indexOf(l), 1); } }
  #updateLabels() {
    const { w, h } = this.size; const v = new THREE.Vector3();
    for (const l of this.labels) {
      if (!l.show) { l.el.style.opacity = 0; continue; }
      v.copy(l.pos).project(this.camera);
      const behind = v.z > 1;
      // hide labels that sit behind Earth
      const toCam = this.camera.position.clone().sub(l.pos);
      const occluded = this.#occluded(l.pos, toCam);
      l.el.style.opacity = behind || occluded ? 0 : 1;
      l.el.style.transform = `translate(${(v.x * 0.5 + 0.5) * w - this.shift * 0 }px, ${(-v.y * 0.5 + 0.5) * h}px) translate(-50%, -140%)`;
    }
  }
  #occluded(point, toCam) {
    // ray from point toward camera hits the unit sphere?
    const d = toCam.clone().normalize(); const o = point;
    const b = o.dot(d), c = o.dot(o) - 1.0;
    const disc = b * b - c;
    return disc > 0 && -b - Math.sqrt(disc) > 0;
  }

  // ------------------------------------------------------------------------------------------ data in
  setMood(mood) {
    // 'overview' | 'calm' | 'event'
    this.mood = mood;
    if (mood === "overview") { this.mode = "overview"; this.eventGroup.visible = false; this.overview.visible = true; }
    if (mood === "calm") { this.mode = "calm"; this.eventGroup.visible = false; this.overview.visible = true; }
    if (mood === "event") { this.mode = "event"; this.eventGroup.visible = true; this.overview.visible = false; }
  }

  setOverview({ satellites, events }) {
    this.data = { satellites, events };
    const sig = satellites.map((s) => s.id + s.operator + s.label).join("|");
    if (sig !== this.satSig) { this.satSig = sig; this.#buildConstellation(); }
    this.#buildLinks();
  }

  #hue(addr) { return (parseInt(addr.slice(2, 8), 16) % 360) / 360; }

  #makeSat(color, scale = 1) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.034, 0.022, 0.022), new THREE.MeshStandardMaterial({ color: 0xe8e8e8, metalness: 0.7, roughness: 0.35, emissive: color, emissiveIntensity: 0.25 }));
    const pm = new THREE.MeshStandardMaterial({ color: 0x303030, metalness: 0.4, roughness: 0.5, emissive: color, emissiveIntensity: 0.18 });
    const p1 = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.002, 0.026), pm); p1.position.x = 0.045;
    const p2 = p1.clone(); p2.position.x = -0.045;
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, opacity: 0.9 }));
    sprite.scale.setScalar(0.16);
    g.add(body, p1, p2, sprite);
    g.scale.setScalar(scale);
    g.userData.sprite = sprite;
    return g;
  }

  #orbitFor(id) {
    const r = rng(id * 7919 + 13);
    return { radius: 1.3 + r() * 0.8, incl: (r() - 0.5) * 1.9, node: r() * Math.PI * 2, speed: 0.22 + r() * 0.12, phase: r() * Math.PI * 2 };
  }
  #orbitPoint(o, ang, out) {
    out.set(Math.cos(ang) * o.radius, 0, Math.sin(ang) * o.radius);
    out.applyEuler(new THREE.Euler(o.incl, o.node, 0, "YXZ"));
    return out;
  }

  #buildConstellation() {
    this.#dropLabels(this.satLabels || []);
    this.overview.clear();
    this.sats = new Map(); this.satLabels = [];
    for (const s of this.data.satellites) {
      const color = new THREE.Color().setHSL(0, 0, 0.55 + 0.45 * this.#hue(s.operator));
      const o = this.#orbitFor(s.id);
      const pts = []; const tmp = new THREE.Vector3();
      for (let i = 0; i <= 160; i++) pts.push(this.#orbitPoint(o, (i / 160) * Math.PI * 2, tmp).clone());
      const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.22 }));
      const mesh = this.#makeSat(color, 1);
      this.overview.add(line, mesh);
      const label = this.#label(s.label, "overview-label"); this.satLabels.push(label);
      this.sats.set(s.id, { o, mesh, label, s });
    }
    this.linkLines = [];
  }

  #buildLinks() {
    if (!this.sats) return;
    for (const l of this.linkLines || []) { this.overview.remove(l.line); l.line.geometry.dispose(); }
    this.linkLines = [];
    const evs = this.data.events.slice(0, 14);
    for (const e of evs) {
      const a = this.sats.get(e.satA), b = this.sats.get(e.satB);
      if (!a || !b) continue;
      const color = e.finalized ? ({ COORDINATED: GREEN, DOUBLE_MANEUVER: AMBER, UNMITIGATED: RED, INCOMPLETE: 0x777777 }[e.verdict] || 0x777777) : ({ COMMIT: CYAN, REVEAL: VIOLET, LOCKED: AMBER, ATTEST: AMBER }[e.phase] || CYAN);
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: e.finalized ? 0.32 : 0.75 }));
      this.overview.add(line);
      this.linkLines.push({ line, a, b, live: !e.finalized });
    }
  }

  // ------------------------------------------------------------------------------------------ event mode
  setEvent(ev) {
    if (!ev) { this.ev = null; return; }
    this.ev = ev;
    const key = String(ev.id);
    const pa = ev.sideA, pb = ev.sideB;
    const state = {
      sealedA: pa.commits.length > 0, sealedB: pb.commits.length > 0,
      actA: pa.reveal?.action || null, actB: pb.reveal?.action || null,
      obs: ev.observed ? [ev.observed.aMan, ev.observed.bMan, ev.observed.miss] : null,
      fin: ev.finalized, miss: ev.predictedMiss,
    };
    const sig = JSON.stringify(state);
    if (key !== this.eventKey) { this.eventKey = key; this.#buildEvent(ev); this.t0 = this.clock.elapsedTime; }
    if (sig !== this.eventSig) { this.eventSig = sig; this.evState = state; this.#styleEvent(); }
  }

  replay() { this.t0 = this.clock.elapsedTime; for (const t of [this.trailA, this.trailB]) t && (t.n = 0); }

  #buildEvent(ev) {
    this.#dropLabels(this.eventLabels || []);
    this.eventGroup.clear();
    this.eventLabels = [];
    const R = 1.95;
    const X = new THREE.Vector3(1, 0.52, 0.3).normalize().multiplyScalar(R);
    const u = X.clone().normalize();
    const t = new THREE.Vector3().crossVectors(u, new THREE.Vector3(0, 1, 0)).normalize();
    this.ex = { R, X, u, vA: t.clone().applyAxisAngle(u, 0.62), vB: t.clone().applyAxisAngle(u, -0.95) };

    const orbit = (v, color) => {
      const pts = []; for (let i = 0; i <= 220; i++) { const a = (i / 220) * Math.PI * 2; pts.push(u.clone().multiplyScalar(Math.cos(a) * R).add(v.clone().multiplyScalar(Math.sin(a) * R))); }
      return new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.4 }));
    };
    this.eventGroup.add(orbit(this.ex.vA, CYAN), orbit(this.ex.vB, VIOLET));

    this.satA = this.#makeSat(new THREE.Color(CYAN), 1.5); this.satB = this.#makeSat(new THREE.Color(VIOLET), 1.5);
    this.eventGroup.add(this.satA, this.satB);

    const shell = (c) => new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 1), new THREE.MeshBasicMaterial({ color: c, wireframe: true, transparent: true, opacity: 0.55, depthWrite: false }));
    this.shellA = shell(CYAN); this.shellB = shell(VIOLET); this.eventGroup.add(this.shellA, this.shellB);

    this.flareA = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glow, color: AMBER, blending: THREE.AdditiveBlending, transparent: true, depthWrite: false })); this.flareA.scale.setScalar(0.5); this.flareA.visible = false;
    this.flareB = this.flareA.clone(); this.flareB.material = this.flareA.material.clone();
    this.eventGroup.add(this.flareA, this.flareB);

    this.ring = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.18, 64), new THREE.MeshBasicMaterial({ color: GREEN, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
    this.ring.position.copy(X); this.ring.lookAt(X.clone().multiplyScalar(2)); this.eventGroup.add(this.ring);

    const mkTrail = (color) => {
      const n = 90; const geo = new THREE.BufferGeometry(); geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(n * 3), 3)); geo.setDrawRange(0, 0);
      const line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 })); line.frustumCulled = false; this.eventGroup.add(line);
      return { line, n: 0, max: n };
    };
    this.trailA = mkTrail(CYAN); this.trailB = mkTrail(VIOLET);

    this.labA = this.#label(ev.satelliteA.label, "event-label a"); this.labB = this.#label(ev.satelliteB.label, "event-label b");
    this.labX = this.#label("", "event-label x"); this.labX.pos.copy(X.clone().add(u.clone().multiplyScalar(0.25)));
    this.eventLabels.push(this.labA, this.labB, this.labX);
  }

  #styleEvent() {
    const s = this.evState; if (!s || !this.shellA) return;
    const col = (act, sealed, base) => (act === "HOLD" ? GREEN : act === "MANEUVER" ? AMBER : base);
    this.shellA.visible = s.sealedA; this.shellB.visible = s.sealedB;
    this.shellA.material.color.setHex(col(s.actA, s.sealedA, CYAN));
    this.shellB.material.color.setHex(col(s.actB, s.sealedB, VIOLET));
    this.shellA.material.opacity = s.actA ? 0.22 : 0.6; this.shellB.material.opacity = s.actB ? 0.22 : 0.6;

    // who moves in the replay: observed beats revealed plan
    if (s.obs) { this.moveA = s.obs[0]; this.moveB = s.obs[1]; this.basis = "observed"; }
    else { this.moveA = s.actA === "MANEUVER"; this.moveB = s.actB === "MANEUVER"; this.basis = s.actA || s.actB ? "plan" : "sealed"; }
    const missM = s.obs ? s.obs[2] : s.miss;
    this.missVis = THREE.MathUtils.clamp(0.03 + missM / 1500 * 0.16, 0.03, 0.26);
    this.baseVis = THREE.MathUtils.clamp(0.03 + s.miss / 1500 * 0.16, 0.03, 0.26);
    this.burnVis = s.obs && (this.moveA || this.moveB) ? Math.max(0.12, this.missVis - this.baseVis) : 0.2;
    this.resolved = !!s.obs || (s.actA && s.actB);
    this.labX.el.textContent = s.obs ? `${s.obs[2]} m  ·  observed miss` : `${s.miss} m  ·  predicted miss`;
  }

  // ------------------------------------------------------------------------------------------ frame
  #frame() {
    if (document.hidden) return;
    const rawDt = this.clock.getDelta();
    const dt = Math.min(rawDt, 0.05);
    const t = this.clock.elapsedTime;
    // adaptive quality: keep the page responsive on weak GPUs / software rendering
    this._slowMs = (this._slowMs ?? 16) * 0.9 + rawDt * 1000 * 0.1;
    if (this._slowMs > 45 && (this._pr ?? 2) > 0.5) {
      this._pr = Math.max(0.5, (this._pr ?? Math.min(window.devicePixelRatio || 1, 2)) * 0.75);
      this.renderer.setPixelRatio(this._pr); this.#resize(); this._slowMs = 30;
    }
    const slow = reduceMotion ? 0.15 : 1;

    this.earth.rotation.y += dt * 0.035 * slow; this.clouds.rotation.y += dt * 0.045 * slow;
    this.cloudMat.uniforms.uTime.value = t; this.nebula.material.uniforms.uTime.value = t;
    this.stars.rotation.y += dt * 0.002 * slow;

    // camera
    if (this.mode === "event" && this.ex) {
      const X = this.ex.X;
      this.camTargetPos.set(X.x * 0.55 + 0.9, X.y * 0.4 + 1.1, 5.2);
      this.camTargetLook.set(X.x * 0.55, X.y * 0.45, 0.1);
    } else {
      const radius = this.mode === "calm" ? 7.4 : 5.2, ang = reduceMotion ? 0.6 : t * 0.045;
      this.camTargetPos.set(Math.sin(ang) * radius * 0.82, 1.15 + Math.sin(t * 0.07) * 0.25, Math.cos(ang) * radius);
      this.camTargetLook.set(0, 0, 0);
    }
    this.camTargetPos.x += this.pointer.x * 0.35; this.camTargetPos.y += this.pointer.y * 0.2;
    const k = 1 - Math.pow(0.02, dt);
    this.camPos.lerp(this.camTargetPos, k); this.camLook.lerp(this.camTargetLook, k);
    this.camera.position.copy(this.camPos); this.camera.lookAt(this.camLook);
    const sh = this.mode === "calm" ? 0 : this.shiftTarget;
    this.shift += (sh - this.shift) * k; if (Math.abs(this.shiftTarget - this.shift) > 0.5 || this.shift !== sh) this.#applyShift();

    if (this.mode === "event" && this.ex && this.satA) this.#frameEvent(t);
    else this.#frameOverview(t);
    this.#updateLabels();
    this.renderer.render(this.scene, this.camera);
  }

  #frameOverview(t) {
    const show = this.mode === "overview";
    if (this.sats) {
      const tmp = new THREE.Vector3();
      for (const [, v] of this.sats) {
        this.#orbitPoint(v.o, v.o.phase + (t * v.o.speed) / Math.pow(v.o.radius, 1.5), tmp);
        v.mesh.position.copy(tmp); v.mesh.lookAt(0, 0, 0);
        v.label.pos.copy(tmp); v.label.show = show && this.sats.size <= 30;
      }
      for (const l of this.linkLines || []) {
        const p = l.line.geometry.attributes.position;
        p.setXYZ(0, ...l.a.mesh.position.toArray()); p.setXYZ(1, ...l.b.mesh.position.toArray()); p.needsUpdate = true;
        if (l.live) l.line.material.opacity = 0.45 + 0.35 * Math.sin(t * 3);
      }
    }
  }

  #frameEvent(t) {
    const { R, X, u, vA, vB } = this.ex;
    const APPROACH = 7.5, HOLD = 3.0, T = APPROACH + HOLD;
    const e = (t - (this.t0 || 0)) % T;
    const p = Math.min(1, e / APPROACH);
    const D = 1.05;
    const ease = (x) => x * x * (3 - 2 * x);
    const f = ease(THREE.MathUtils.clamp((p - 0.4) / 0.6, 0, 1));
    const P = (v, th) => u.clone().multiplyScalar(Math.cos(th) * R).add(v.clone().multiplyScalar(Math.sin(th) * R));

    const thA = -D * (1 - p), thB = D * (1 - p);
    const offA = this.moveA ? -this.burnVis * f : 0;
    const offB = this.baseVis + (this.moveB ? this.burnVis * f : 0);
    const posA = P(vA, thA).add(u.clone().multiplyScalar(offA));
    const posB = P(vB, thB).add(u.clone().multiplyScalar(offB));
    this.satA.position.copy(posA); this.satB.position.copy(posB);
    this.satA.lookAt(0, 0, 0); this.satB.lookAt(0, 0, 0);
    this.shellA.position.copy(posA); this.shellB.position.copy(posB);
    this.shellA.rotation.y += 0.01; this.shellB.rotation.y -= 0.01;
    this.labA.pos.copy(posA); this.labB.pos.copy(posB);

    for (const [tr, pos] of [[this.trailA, posA], [this.trailB, posB]]) {
      if (e < 0.05) tr.n = 0;
      if (p < 1 || tr.n === 0) {
        const arr = tr.line.geometry.attributes.position.array;
        if (tr.n < tr.max) { arr.set(pos.toArray(), tr.n * 3); tr.n++; } else { arr.copyWithin(0, 3); arr.set(pos.toArray(), (tr.max - 1) * 3); }
        tr.line.geometry.setDrawRange(0, tr.n); tr.line.geometry.attributes.position.needsUpdate = true;
      }
    }

    // burn flares
    const burning = (mv) => mv && p > 0.42 && p < 0.95;
    this.flareA.visible = burning(this.moveA); this.flareB.visible = burning(this.moveB);
    this.flareA.position.copy(posA); this.flareB.position.copy(posB);
    const pulse = 0.4 + 0.25 * Math.sin(t * 18);
    this.flareA.scale.setScalar(pulse); this.flareB.scale.setScalar(pulse);

    // closest-approach ring
    const sep = posA.distanceTo(posB);
    const risky = !(this.moveA || this.moveB);
    this.ring.material.color.setHex(this.basis === "sealed" ? 0x777777 : risky ? RED : GREEN);
    const near = THREE.MathUtils.clamp(1 - Math.abs(p - 1) * 3, 0, 1);
    this.ring.material.opacity = 0.25 + 0.6 * near * (0.7 + 0.3 * Math.sin(t * 8));
    this.ring.scale.setScalar(1 + 0.25 * Math.sin(t * 3));
    this.labX.show = true;
    this.labA.show = this.labB.show = true;
    this.lastSep = sep;
  }

  get basisText() {
    return this.basis === "observed" ? "Replaying what screeners observed" : this.basis === "plan" ? "Replaying the revealed plans" : "Decisions are still sealed, so nobody can predict who moves";
  }

  dispose() { this.renderer.setAnimationLoop(null); window.removeEventListener("resize", this.onResize); this.renderer.dispose(); }
}
