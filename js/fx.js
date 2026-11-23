// fx.js — effects, each kind drawn in a single instanced draw call: smoke / dust / blood mist,
// glowing sparks and flashes, tracers, bullet holes and blood splats, brass casings, explosion.
// Gunfire also lights the town for a moment through the world shader's flash light.
(function (G) {
  'use strict';
  const THREE = G.THREE, U = G.Gfx.U;
  const FX = G.FX = { shake: 0 };
  let scene, smoke, glow, flamePool, decals, tracers, shells, decalGen;
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), zAxis = new THREE.Vector3(0, 0, 1);
  const flashL = { t: 0, max: 0.06, peak: new THREE.Color() };

  // ---------- billboard particle pools ----------
  const PVS = [
    'attribute vec4 iPos; attribute vec4 iCol; attribute float iRot;',
    '#ifdef FLAME',
    'attribute float iAsp;',
    '#endif',
    'uniform vec3 uFogColor; uniform float uFogDensity;',
    'varying vec2 vUv; varying vec4 vCol; varying float vFog; varying float vPhase;',
    'void main() {',
    '  vec3 right = vec3( viewMatrix[ 0 ][ 0 ], viewMatrix[ 1 ][ 0 ], viewMatrix[ 2 ][ 0 ] );',
    '  vec3 up = vec3( viewMatrix[ 0 ][ 1 ], viewMatrix[ 1 ][ 1 ], viewMatrix[ 2 ][ 1 ] );',
    '  float c = cos( iRot ), s = sin( iRot );',
    '  vec2 p = vec2( position.x * c - position.y * s, position.x * s + position.y * c );',
    '#ifdef FLAME',
    '  p.x *= 0.58; p.y *= max( iAsp, 0.35 );',
    '#endif',
    '  p *= iPos.w;',
    '  vec3 wp = iPos.xyz + right * p.x + up * p.y;',
    '  vUv = uv; vCol = iCol; vPhase = iRot;',
    '  vFog = 1.0 - exp( -length( wp - cameraPosition ) * uFogDensity );',
    '  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );',
    '}',
  ].join('\n');
  const PFS = [
    'uniform sampler2D map; uniform vec3 uFogColor; uniform float time;',
    '#ifdef FLAME',
    'uniform float uAtlas;',
    '#endif',
    'varying vec2 vUv; varying vec4 vCol; varying float vFog; varying float vPhase;',
    'void main() {',
    '  vec2 uv = vUv;',
    '#ifdef FLAME',
    '  float flick = 0.82 + 0.18 * sin( time * 17.0 + vPhase * 8.0 );',
    '  if ( uAtlas > 0.5 ) {',
    '    float frame = mod( floor( time * 10.0 + vPhase * 3.0 ), 4.0 );',
    '    uv.x = uv.x * 0.25 + frame * 0.25;',
    '  } else {',
    '    uv.x = .5 + (uv.x-.5)/(1.-.62*uv.y) + .1*sin(time*9.+vPhase+uv.y*7.)*uv.y;',
    '    if ( uv.x < 0.0 || uv.x > 1.0 ) discard;',
    '  }',
    '#endif',
    '  vec4 t = texture2D( map, uv );',
    '#ifdef ADDITIVE',
    '  vec3 c = vCol.rgb * t.rgb * t.a * vCol.a * ( 1.0 - vFog );',
    '#ifdef FLAME',
    '  c *= flick;',
    '#endif',
    '  gl_FragColor = vec4( c, 1.0 );',
    '#else',
    '  float a = t.a * vCol.a; if ( a < 0.004 ) discard;',
    '  gl_FragColor = vec4( mix( vCol.rgb * t.rgb, uFogColor, vFog ), a );',
    '#endif',
    '#include <tonemapping_fragment>',
    '#include <encodings_fragment>',
    '}',
  ].join('\n');
  function pool(n, tex, additive) {
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.attributes.position = base.attributes.position; g.attributes.uv = base.attributes.uv;
    const pos = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4), col = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4), rot = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    pos.setUsage(THREE.DynamicDrawUsage); col.setUsage(THREE.DynamicDrawUsage); rot.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', pos); g.setAttribute('iCol', col); g.setAttribute('iRot', rot);
    g.instanceCount = n;
    const mat = new THREE.ShaderMaterial({
      uniforms: { time:U.uTime, map: { value: tex }, uFogColor: U.uFogColor, uFogDensity: U.uFogDensity },
      vertexShader: PVS, fragmentShader: PFS, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      defines: additive ? { ADDITIVE: '' } : {},
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false; mesh.renderOrder = additive ? 4 : 3;
    const items = [];
    for (let i = 0; i < n; i++) items.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0, grow: 0, rot: 0, spin: 0, r: 1, g: 1, b: 1, a: 1, drag: 1, rise: 0, fade: 1, asp: 1 });
    return { mesh, items, n, idx: 0, pos, col, rot };
  }
  function emit(P, o) {
    const it = P.items[P.idx]; P.idx = (P.idx + 1) % P.n;
    it.life = 0; it.max = o.life || 0.6;
    it.x = o.x; it.y = o.y; it.z = o.z; it.vx = o.vx || 0; it.vy = o.vy || 0; it.vz = o.vz || 0;
    it.size = o.size || 0.3; it.grow = o.grow || 0; it.rot = o.rot === undefined ? Math.random() * 6.28 : o.rot; it.spin = o.spin || 0;
    const c = o.color || [1, 1, 1]; it.r = c[0]; it.g = c[1]; it.b = c[2]; it.a = o.alpha === undefined ? 1 : o.alpha;
    it.drag = o.drag || 0; it.rise = o.rise || 0; it.fade = o.fade || 0;
    it.asp = o.asp === undefined ? 1 : o.asp;
  }
  function stepPool(P, dt) {
    const pa = P.pos.array, ca = P.col.array, ra = P.rot.array, aa = P.asp ? P.asp.array : null;
    for (let i = 0; i < P.n; i++) {
      const it = P.items[i];
      if (it.life >= it.max) { if (pa[i * 4 + 3] !== 0) pa[i * 4 + 3] = 0; continue; }
      it.life += dt;
      const k = Math.min(1, it.life / it.max), drag = Math.max(0, 1 - it.drag * dt);
      it.vx *= drag; it.vy = it.vy * drag + it.rise * dt; it.vz *= drag;
      it.x += it.vx * dt; it.y += it.vy * dt; it.z += it.vz * dt;
      it.size *= 1 + it.grow * dt; it.rot += it.spin * dt;
      const fadeIn = it.fade ? Math.min(1, it.life / it.fade) : 1;
      pa[i * 4] = it.x; pa[i * 4 + 1] = it.y; pa[i * 4 + 2] = it.z; pa[i * 4 + 3] = it.life >= it.max ? 0 : it.size;
      ca[i * 4] = it.r; ca[i * 4 + 1] = it.g; ca[i * 4 + 2] = it.b; ca[i * 4 + 3] = it.a * (1 - k) * fadeIn;
      ra[i] = it.rot;
      if (aa) aa[i] = it.asp || 1;
    }
    P.pos.needsUpdate = P.col.needsUpdate = P.rot.needsUpdate = true;
    if (P.asp) P.asp.needsUpdate = true;
  }

  // ---------- decals: bullet holes, blood, scorch (one atlas) ----------
  const DEC = { hole: [0, 0, 0.25, 1], blood: [0.25, 0, 0.5, 1], blood2: [0.5, 0, 0.75, 1], scorch: [0.75, 0, 1, 1] };
  function decalAtlas() {
    const c = document.createElement('canvas'); c.width = 512; c.height = 128;
    const g = c.getContext('2d');
    g.drawImage(G.Tex.tex('hole').image, 0, 0, 128, 128);
    g.drawImage(G.Tex.tex('blood').image, 128, 0, 128, 128);
    g.save(); g.translate(384, 64); g.rotate(2.1); g.scale(1.2, 0.8); g.drawImage(G.Tex.tex('blood').image, -64, -64, 128, 128); g.restore();
    g.drawImage(G.Tex.tex('scorch').image, 384, 0, 128, 128);
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding;
    return t;
  }
  function decalPool(n) {
    const g = new THREE.PlaneGeometry(1, 1);
    const uvr = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4), al = new THREE.InstancedBufferAttribute(new Float32Array(n), 1);
    g.setAttribute('iUv', uvr); g.setAttribute('iAlpha', al);
    const mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: decalAtlas() } },
      vertexShader: 'attribute vec4 iUv; attribute float iAlpha; varying vec2 vUv; varying float vA; void main(){ vUv = mix( iUv.xy, iUv.zw, uv ); vA = iAlpha; gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4( position, 1.0 ); }',
      fragmentShader: 'uniform sampler2D map; varying vec2 vUv; varying float vA; void main(){ vec4 t = texture2D( map, vUv ); float a = t.a * vA; if ( a < 0.01 ) discard; gl_FragColor = vec4( t.rgb * 0.75, a );\n#include <tonemapping_fragment>\n#include <encodings_fragment>\n}',
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4,
    });
    const mesh = new THREE.InstancedMesh(g, mat, n);
    mesh.frustumCulled = false; mesh.renderOrder = 2; mesh.count = 0;
    return { mesh, n, idx: 0, used: 0, uvr, al };
  }
  function putDecal(kind, x, y, z, nx, ny, nz, size, alpha) {
    const D = decals, i = D.idx; D.idx = (D.idx + 1) % D.n; D.used = Math.min(D.n, D.used + 1);
    v1.set(nx, ny, nz);
    if (decalGen) decalGen[i] = (decalGen[i] + 1) & 65535;
    q.setFromUnitVectors(zAxis, v1);
    qSpin.setFromAxisAngle(zAxis, Math.random() * 6.28);
    q.multiply(qSpin);
    m4.compose(v2.set(x + nx * 0.008, y + ny * 0.008, z + nz * 0.008), q, sc.set(size, size, size));
    D.mesh.setMatrixAt(i, m4);
    const r = DEC[kind]; D.uvr.setXYZW(i, r[0], r[1], r[2], r[3]); D.al.setX(i, alpha === undefined ? 1 : alpha);
    D.mesh.count = D.used;
    D.mesh.instanceMatrix.needsUpdate = true; D.uvr.needsUpdate = true; D.al.needsUpdate = true;
    return i;
  }
  const qSpin = new THREE.Quaternion();

  // ---------- tracers: glowing streaks facing the camera ----------
  function tracerPool(n) {
    const g = new THREE.InstancedBufferGeometry(), base = new THREE.PlaneGeometry(1, 1);
    g.index = base.index; g.attributes.position = base.attributes.position; g.attributes.uv = base.attributes.uv;
    const a = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4), b = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
    a.setUsage(THREE.DynamicDrawUsage); b.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iA', a); g.setAttribute('iB', b); g.instanceCount = n;
    const mat = new THREE.ShaderMaterial({
      vertexShader: [
        'attribute vec4 iA; attribute vec4 iB; varying vec2 vUv; varying float vK;',
        'void main() {',
        '  vec3 p = mix( iA.xyz, iB.xyz, position.y + 0.5 );',
        '  vec3 d = normalize( iB.xyz - iA.xyz + vec3( 1e-5 ) ), v = normalize( cameraPosition - p );',
        '  vec3 side = normalize( cross( d, v ) ) * iA.w;',
        '  p += side * position.x * 2.0;',
        '  vUv = uv; vK = iB.w;',
        '  gl_Position = projectionMatrix * viewMatrix * vec4( p, 1.0 );',
        '}',
      ].join('\n'),
      fragmentShader: 'varying vec2 vUv; varying float vK; void main(){ float x = 1.0 - abs( vUv.x * 2.0 - 1.0 ); float a = x * x * vUv.y * vK; gl_FragColor = vec4( vec3( 1.0, 0.85, 0.55 ) * a * 2.2, 1.0 ); }',
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false,
    });
    const mesh = new THREE.Mesh(g, mat);
    mesh.frustumCulled = false; mesh.renderOrder = 4;
    const items = []; for (let i = 0; i < n; i++) items.push({ on: false, fx: 0, fy: 0, fz: 0, dx: 0, dy: 0, dz: 0, dist: 0, t: 0 });
    return { mesh, items, n, idx: 0, a, b };
  }

  // ---------- brass ----------
  function shellPool(n) {
    const geo = G.Geo.paint(G.Geo.cyl(0.007, 0.007, 0.034, 7, 'z'), { c: 0xe2b857, r: 0.26, m: 0.78, w: 0.2 });
    const mesh = new THREE.InstancedMesh(geo, G.GunModels.material(), n);
    mesh.frustumCulled = false; mesh.count = 0;
    const items = []; for (let i = 0; i < n; i++) items.push({ on: false, p: new THREE.Vector3(), v: new THREE.Vector3(), r: new THREE.Euler(), w: new THREE.Vector3(), t: 0, rest: false });
    return { mesh, items, n, idx: 0 };
  }

  FX.init = function (sc0) {
    scene = sc0;
    const k = G.Gfx.preset ? G.Gfx.preset.particles : 1;
    smoke = pool(Math.round(240 * k), G.Tex.tex('puff'), false);
    glow = pool(Math.round(120 * k), G.Tex.tex('puff'), true);
    flamePool = pool(Math.round(200 * k), G.Tex.tex('puff'), true);
    const fmat = flamePool.mesh.material;
    fmat.defines.FLAME = '';
    fmat.uniforms.uAtlas = { value: 0 };
    const atlas = flameAtlas();
    if (atlas) { fmat.uniforms.map.value = atlas; fmat.uniforms.uAtlas.value = 1; }
    fmat.needsUpdate = true;
    const asp = new THREE.InstancedBufferAttribute(new Float32Array(flamePool.n), 1);
    asp.setUsage(THREE.DynamicDrawUsage);
    flamePool.mesh.geometry.setAttribute('iAsp', asp);
    flamePool.asp = asp;
    flamePool.mesh.visible = false;
    scene.add(flamePool.mesh);
    smoke.mesh.onAfterRender = blitGhost;
    glow.flashTex = G.Tex.tex('flash');
    decals = decalPool(200);
    decalGen = new Uint16Array(decals.n);
    tracers = tracerPool(40);
    shells = shellPool(40);
    // flashes use their own pool so they can carry the star-shaped texture
    FX.flashes = pool(16, G.Tex.tex('flash'), true);
    [smoke.mesh, glow.mesh, decals.mesh, tracers.mesh, shells.mesh, FX.flashes.mesh].forEach((m) => scene.add(m));
  };
  function light(x, y, z, peak, dur, range) {
    U.uFlashPos.value.set(x, y, z);
    flashL.peak.copy(peak); flashL.t = dur; flashL.max = dur;
    U.uFlashRange.value = range || 8;
    U.uFlashColor.value.copy(peak);
  }
  const dustCol = [0.62, 0.52, 0.4];
  const caps = [];
  let capGeometry, capMaterial, deathVeil, grade = 0;
  FX.deathGrade = function (amount) {
    if (grade === amount) return;
    grade = amount;
    const canvas = G.renderer && G.renderer.domElement;
    if (canvas) canvas.style.filter = amount ? 'saturate(' + (1 - 0.88 * amount) + ')' : '';
    if (!deathVeil && amount) {
      deathVeil = document.createElement('div');
      deathVeil.style.cssText = 'position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse,transparent 32%,rgba(116,5,9,.78) 100%)';
      document.getElementById('game').appendChild(deathVeil);
    }
    if (deathVeil) { deathVeil.hidden = !amount; deathVeil.style.opacity = amount; }
  };
  FX.deathBurst = function (a, dir, head) {
    const y = a.pos.y + (head ? 1.63 : 1.16) - a.crouch * 0.45;
    FX.blood(a.pos.x, y, a.pos.z, dir, !!head);
    if (!head) return;
    FX.blood(a.pos.x, y + 0.09, a.pos.z, dir, true);
    let cap = caps.find(c => !c.mesh.visible);
    if (!cap) {
      if (!capGeometry) {
        capGeometry = new THREE.SphereGeometry(0.145, 10, 5, 0, 2 * Math.PI, 0, Math.PI * 0.55);
        capMaterial = new THREE.MeshLambertMaterial({ color: 0x695e45, side: THREE.DoubleSide });
      }
      cap = { mesh: new THREE.Mesh(capGeometry, capMaterial), vel: new THREE.Vector3() };
      caps.push(cap); scene.add(cap.mesh);
    }
    cap.mesh.position.set(a.pos.x, y + 0.11, a.pos.z);
    cap.vel.set(dir.x * 2.4 + 0.35, 3.2, dir.z * 2.4);
    cap.mesh.rotation.set(0, a.yaw, 0.1); cap.mesh.visible = true; cap.age = 0;
  };

  FX.impact = function (x, y, z, nx, ny, nz) {
    for (let i = 0; i < 3; i++) emit(smoke, {
      x: x + nx * 0.05, y: y + ny * 0.05, z: z + nz * 0.05, color: dustCol, size: 0.18 + Math.random() * 0.15, grow: 1.6, life: 0.5 + Math.random() * 0.5, alpha: 0.78,
      vx: nx * G.rand(0.6, 1.8) + G.rand(-0.4, 0.4), vy: ny * G.rand(0.6, 1.8) + G.rand(0, 0.5), vz: nz * G.rand(0.6, 1.8) + G.rand(-0.4, 0.4), drag: 3, rise: 0.2,
    });
    for (let i = 0; i < 3; i++) emit(glow, { x, y, z, color: [2.2, 1.4, 0.7], size: 0.052, life: 0.10 + Math.random() * 0.07, vx: (nx + G.rand(-0.8, 0.8)) * 6, vy: (ny + G.rand(0, 1)) * 6, vz: (nz + G.rand(-0.8, 0.8)) * 6 });
    putDecal('hole', x, y, z, nx, ny, nz, 0.11 + Math.random() * 0.05, 1);
    if (Math.random() < 0.5) G.Audio.impact({ x, y, z });
  };
  FX.blood = function (x, y, z, dir, head) {
    const n = head ? 7 : 4;
    for (let i = 0; i < n; i++) emit(smoke, {
      x, y, z, color: head ? [0.34, 0.02, 0.02] : [0.3, 0.03, 0.02], size: 0.1 + Math.random() * 0.14, grow: 2.4, life: 0.35 + Math.random() * 0.3, alpha: 0.9,
      vx: dir.x * G.rand(0.5, 2.2) + G.rand(-0.5, 0.5), vy: G.rand(-0.3, 0.9), vz: dir.z * G.rand(0.5, 2.2) + G.rand(-0.5, 0.5), drag: 4, rise: -2,
    });
    // spatter on the wall or floor behind the victim
    const hit = G.Map.raycast(x, y, z, dir.x, dir.y - 0.25, dir.z, 2.6);
    if (hit) putDecal(Math.random() < 0.5 ? 'blood' : 'blood2', hit.x, hit.y, hit.z, hit.nx, hit.ny, hit.nz, (head ? 0.7 : 0.5) * (1.1 - hit.t / 3), 0.92);
  };
  FX.tracer = function (from, to) {
    const T = tracers, t = T.items[T.idx]; T.idx = (T.idx + 1) % T.n;
    t.fx = from.x; t.fy = from.y; t.fz = from.z;
    t.dx = to.x - from.x; t.dy = to.y - from.y; t.dz = to.z - from.z; t.dist = Math.hypot(t.dx, t.dy, t.dz);
    if (t.dist < 2) { t.on = false; return; }
    t.dx /= t.dist; t.dy /= t.dist; t.dz /= t.dist; t.t = Math.random() * 2; t.on = true;
  };
  FX.muzzle = function (pos, dir, big, firstPerson) {
    emit(FX.flashes, { x: pos.x + dir.x * 0.05, y: pos.y + dir.y * 0.05, z: pos.z + dir.z * 0.05, color: [2.2, 1.6, 0.8], size: firstPerson ? 0.14 : big ? 0.72 : 0.48, life: 0.055 });
    if (!firstPerson) {
      emit(smoke, { x: pos.x, y: pos.y, z: pos.z, color: [0.55, 0.53, 0.5], size: 0.1, grow: 2, life: 0.6, alpha: 0.22, vx: dir.x * 0.8, vy: 0.3, vz: dir.z * 0.8, drag: 2 });
    }
    light(pos.x, pos.y, pos.z, tmpC.setRGB(3.2, 2.1, 1.0).multiplyScalar(big ? 1.3 : 1), 0.065, big ? 10 : 8);
  };
  const tmpC = new THREE.Color();
  FX.shell = function (pos, model) {
    if (!pos) return;
    const S = shells, s = S.items[S.idx]; S.idx = (S.idx + 1) % S.n;
    const cam = G.camera, right = v1.set(1, 0, 0).applyQuaternion(cam.quaternion), up = v2.set(0, 1, 0).applyQuaternion(cam.quaternion);
    s.p.copy(pos);
    s.v.copy(right).multiplyScalar(G.rand(1.6, 2.6)).addScaledVector(up, G.rand(1.2, 2.2));
    s.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    s.w.set(G.rand(-20, 20), G.rand(-20, 20), G.rand(-20, 20));
    s.t = 0; s.on = true; s.rest = false;
    S.mesh.count = Math.max(S.mesh.count, S.idx === 0 ? S.n : S.idx);
  };
  function n2(x, y) {
    const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453;
    return s - Math.floor(s);
  }
  function noise2(x, y) {
    const x0 = Math.floor(x), y0 = Math.floor(y), fx = x - x0, fy = y - y0;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = n2(x0, y0), b = n2(x0 + 1, y0), c = n2(x0, y0 + 1), d = n2(x0 + 1, y0 + 1);
    return a + (b - a) * sx + (c - a) * sy + (a - b - c + d) * sx * sy;
  }
  function fbm2(x, y) {
    let v = 0, a = 0.5, f = 1, t = 0;
    for (let i = 0; i < 5; i++) { v += a * noise2(x * f, y * f); t += a; a *= 0.5; f *= 2.05; }
    return v / t;
  }
  function hermite(x, a, b) {
    const u = Math.max(0, Math.min(1, (x - a) / (b - a || 1)));
    return u * u * (3 - 2 * u);
  }
  function canvasTex(w, h, paint) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    if (!g || typeof g.createImageData !== 'function') return null;
    let img;
    try { img = g.createImageData(w, h); } catch (e) { return null; }
    if (!img || !img.data || img.data.length < w * h * 4) return null;
    paint(img.data, w, h);
    try { g.putImageData(img, 0, 0); } catch (e) { return null; }
    const tex = new THREE.CanvasTexture(c);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
    tex.needsUpdate = true;
    return tex;
  }
  function smokeTex() {
    return canvasTex(128, 128, (data, size) => {
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const u = (x + 0.5) / size, v = (y + 0.5) / size;
        const n = fbm2(u * 4.2, v * 4.2), n2v = fbm2(u * 8.5 + 4.0, v * 8.5);
        const r = Math.hypot(u - 0.5 + (n - 0.5) * 0.2, v - 0.5 + (n2v - 0.5) * 0.2) * 2;
        const edge = 0.72 + (n - 0.5) * 0.46;
        let a = 1 - hermite(r, edge - 0.5, edge);
        a *= 0.45 + 0.55 * n2v;
        a = Math.max(0, Math.min(1, a));
        const o = (y * size + x) * 4, lit = Math.floor((0.72 + 0.28 * n) * 255);
        data[o] = data[o + 1] = data[o + 2] = lit;
        data[o + 3] = Math.floor(a * 255);
      }
    });
  }
  function flameAtlas() {
    return canvasTex(256, 64, (data, w, h) => {
      for (let y = 0; y < h; y++) {
        const vb = (y + 0.5) / h;
        for (let x = 0; x < w; x++) {
          const frame = (x / 64) | 0, u = (x - frame * 64 + 0.5) / 64;
          const wob = Math.sin(vb * 9 + frame * 1.7) * 0.08 * (1 - vb);
          const half = (0.07 + Math.pow(1 - vb, 1.35) * 0.28) * (0.78 + 0.3 * fbm2(u * 3 + frame, vb * 3));
          let a = 1 - hermite(Math.abs(u - 0.5 - wob), half * 0.15, half);
          a *= hermite(vb, 0.0, 0.1);
          a *= 1 - hermite(vb, 0.9, 1) * 0.35;
          const heat = Math.pow(vb, 0.6), o = (y * w + x) * 4;
          data[o] = 255;
          data[o + 1] = Math.floor((0.28 + 0.72 * heat) * 255);
          data[o + 2] = Math.floor((0.04 + 0.7 * heat * heat) * 255);
          data[o + 3] = Math.floor(Math.max(0, Math.min(1, a)) * 255);
        }
      }
    });
  }
  function u01(i, salt) {
    const n = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
    return n - Math.floor(n);
  }
  // One instanced cloud per smoke: soft noise puffs, a dense core, and a ground skirt.
  const cloudPool = [];
  let cloudGeometry, cloudMaterial;
  function ensureCloud() {
    if (cloudGeometry) return;
    const base = new THREE.PlaneGeometry(1, 1), g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.setAttribute('position', base.attributes.position); g.setAttribute('uv', base.attributes.uv);
    const CORE = 14, BODY = 30, SKIRT = 12, n = CORE + BODY + SKIRT;
    const offsets = new Float32Array(n * 4), meta = new Float32Array(n * 4);
    for (let i = 0; i < CORE; i++) {
      const a = u01(i, 1) * 6.2832, rad = 0.05 + u01(i, 2) * 0.22;
      offsets.set([Math.cos(a) * rad, (u01(i, 3) - 0.4) * 0.28, Math.sin(a) * rad, 0.48 + u01(i, 4) * 0.36], i * 4);
      meta.set([u01(i, 5) * 6.2832, 1, 0, 0.9], i * 4);
    }
    for (let i = 0; i < BODY; i++) {
      const k = CORE + i, th = i * 2.399 + u01(i, 9);
      const y = (u01(i, 6) - 0.28) * 1.05;
      const rad = (0.16 + u01(i, 7) * 0.58) * (0.72 + u01(i, 8) * 0.5);
      offsets.set([Math.cos(th) * rad, y * 0.7, Math.sin(th) * rad, 0.28 + u01(i, 10) * 0.36], k * 4);
      meta.set([u01(i, 11) * 6.2832, u01(i, 12) > 0.8 ? 0.55 : 0.12, 0, 0.42 + u01(i, 13) * 0.28], k * 4);
    }
    for (let i = 0; i < SKIRT; i++) {
      const k = CORE + BODY + i, th = i / SKIRT * 6.2832 + u01(i, 14), rad = 0.5 + u01(i, 15) * 0.5;
      offsets.set([Math.cos(th) * rad, -0.02, Math.sin(th) * rad, 0.46 + u01(i, 16) * 0.3], k * 4);
      meta.set([u01(i, 17) * 6.2832, 0, 1, 0.48], k * 4);
    }
    g.setAttribute('puff', new THREE.InstancedBufferAttribute(offsets, 4));
    g.setAttribute('meta', new THREE.InstancedBufferAttribute(meta, 4));
    g.instanceCount = n;
    cloudGeometry = g;
    const tex = smokeTex() || G.Tex.tex('puff');
    cloudMaterial = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { map: { value: tex }, sun: U.uSunDir, uAge: { value: 0 } },
      vertexShader: [
        'attribute vec4 puff; attribute vec4 meta; uniform vec3 sun; uniform float uAge;',
        'varying vec2 vUv; varying float vLight; varying float vAlpha; varying float vCore;',
        'void main() {',
        '  vec3 local = puff.xyz; float seed = meta.x, core = meta.y, skirt = meta.z;',
        '  float wob = 1.0 - core * 0.7;',
        '  local.x += sin(uAge * 0.33 + seed) * 0.05 * wob;',
        '  local.z += cos(uAge * 0.29 + seed * 1.4) * 0.05 * wob;',
        '  local.y += sin(uAge * 0.21 + seed * 2.1) * 0.03 * wob;',
        '  float rad = max(length(modelMatrix[0].xyz), 0.2);',
        '  if (skirt > 0.5) { local.y = -0.62 / rad; local.xz *= 1.15 + 0.08 * sin(uAge * 0.4 + seed); }',
        '  vec4 p = modelViewMatrix * vec4(local, 1.0);',
        '  float spr = puff.w * rad; if (skirt > 0.5) spr *= 1.4;',
        '  p.xy += position.xy * spr; vUv = uv;',
        '  vec3 woff = mat3(modelMatrix) * normalize(local + vec3(0.001, 0.15, 0.001));',
        '  float ny = woff.y; float sd = max(dot(normalize(woff), sun), 0.0);',
        '  vLight = (0.3 + 0.42 * clamp(ny * 0.55 + 0.45, 0.0, 1.0) + 0.36 * sd) * mix(0.48, 1.0, smoothstep(-0.7, 0.35, ny));',
        '  float die = smoothstep(13.5, 18.8, uAge);',
        '  float keep = mix(smoothstep(0.82, 0.16, length(local.xz)), 1.0, core);',
        '  vAlpha = meta.w * mix(1.0 - die * 0.96, 1.0, keep); vCore = core;',
        '  gl_Position = projectionMatrix * p;',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform sampler2D map; varying vec2 vUv; varying float vLight; varying float vAlpha; varying float vCore;',
        'void main() {',
        '  vec4 t = texture2D(map, vUv); float d = length(vUv - 0.5) * 2.0;',
        '  float a = t.a * vAlpha;',
        '  a = mix(a, min(1.0, a * 1.7 + 0.12), vCore * (1.0 - smoothstep(0.2, 0.95, d)));',
        '  if (a < 0.02) discard;',
        '  vec3 col = vec3(0.74, 0.72, 0.67) * vLight * (0.84 + 0.28 * t.r);',
        '  col += vec3(0.08, 0.05, 0.02) * max(vLight - 0.72, 0.0);',
        '  gl_FragColor = vec4(col, a);',
        '#include <tonemapping_fragment>',
        '#include <encodings_fragment>',
        '}',
      ].join('\n'),
    });
  }
  function makeCloud() {
    const mat = cloudMaterial.clone();
    mat.uniforms.sun = cloudMaterial.uniforms.sun;
    mat.uniforms.map = cloudMaterial.uniforms.map;
    const m = new THREE.Mesh(cloudGeometry, mat);
    m.frustumCulled = false; m.renderOrder = 3;
    return m;
  }
  FX.cloud = function (pos) {
    ensureCloud();
    const m = cloudPool.pop() || makeCloud();
    m.position.copy(pos);
    m.scale.setScalar(0.18);
    m.userData.spin = Math.sin(pos.x * 2.17 + pos.z * 1.31) * 2;
    scene.add(m);
    return m;
  };
  FX.sizeCloud = function (m, r, age) {
    m.scale.setScalar(r > 0.02 ? r : 0.02);
    m.rotation.y = (m.userData.spin || 0) + age * 0.08;
    if (m.material.uniforms && m.material.uniforms.uAge) m.material.uniforms.uAge.value = age;
  };
  FX.recycleCloud = function (m) { scene.remove(m); cloudPool.push(m); };
  const SCORCH_N = 8, scorchRec = [];
  for (let i = 0; i < SCORCH_N; i++) scorchRec.push({ on: false, i: 0, gen: 0, a: 0, fade: false, delay: 0, token: 0 });
  let scorchCursor = 0;
  FX.scorch = function (p) {
    if (!decals) return null;
    const i = putDecal('scorch', p.x, p.y - 0.085, p.z, 0, 1, 0, 5.2, 0.9);
    const slot = scorchCursor, s = scorchRec[slot];
    scorchCursor = (scorchCursor + 1) % SCORCH_N;
    s.on = true; s.i = i; s.gen = decalGen ? decalGen[i] : 0; s.a = 0.9; s.fade = false; s.delay = 0;
    s.token = (s.token || 0) + 1;
    return { slot: slot, token: s.token };
  };
  FX.fadeScorch = function (h) {
    if (!h) return;
    const s = scorchRec[h.slot];
    if (!s || s.token !== h.token || !s.on || s.fade) return;
    s.fade = true; s.delay = 1.5;
  };
  const flameHot = [1.7, 1.15, 0.55], flameColor = [1.35, 0.85, 0.32], emberColor = [2, 1.1, 0.17];
  const flame = { color: flameColor, life: 0.32, grow: -0.4, rot: 0, asp: 1.4 };
  const ember = { color: emberColor, size: 0.055, life: 0.7, vy: 2.6, vx: 0.4 };
  const glowBase = { color: [2.15, 0.62, 0.1], size: 2.4, life: 0.22, alpha: 0.55, rot: 0.2, grow: 0.7, fade: 0.02, vy: 0.08, drag: 0.5 };
  const column = { color: [0.15, 0.13, 0.11], size: 0.9, life: 1.75, alpha: 0.4, grow: 0.6, drag: 0.55, rise: 0.8, fade: 0.1, vy: 0.5, rot: 0 };
  FX.flames = function (f) {
    const p = f.pos; flamePool.mesh.visible = true; flamePool.until = G.time + 0.4;
    for (const c of f.cells) {
      if (f.age < c.delay) continue;
      const sz = G.rand(0.64, 1), vy = G.rand(1.4, 2.5), v = c.pos;
      const hf = u01(v.x * 10 + v.z, 3);
      const tall = 0.5 + hf * 1.9;
      flame.x = v.x + (hf - 0.5) * 0.78;
      flame.y = v.y + 0.1 + tall * 0.5;
      flame.z = v.z + (u01(v.z * 10 - v.x, 5) - 0.5) * 0.78;
      flame.size = 0.36 + sz * 0.45;
      flame.vy = vy * (0.32 + hf * 0.28);
      flame.life = 0.22 + sz * 0.16;
      flame.grow = -0.35;
      flame.rot = hf * 6.2832;
      flame.spin = (hf - 0.5) * 2.2;
      flame.asp = tall;
      flame.color = hf > 0.55 ? flameHot : flameColor;
      emit(flamePool, flame);
      if (Math.random() < 0.11) {
        ember.x = flame.x; ember.y = v.y + 0.4 + tall * 0.35; ember.z = flame.z;
        ember.vx = (hf - 0.5) * 1.5; ember.vz = (sz - 0.82) * 1.6; ember.vy = 1.6 + vy;
        emit(glow, ember);
      }
    }
    glowBase.x = p.x; glowBase.y = p.y + 0.12; glowBase.z = p.z;
    emit(glow, glowBase);
    for (let k = 0; k < 3; k++) {
      const a = f.age * 0.7 + k * 2.094;
      column.x = p.x + Math.sin(a) * 0.28;
      column.y = p.y + 0.85 + k * 0.55;
      column.z = p.z + Math.cos(a) * 0.28;
      column.size = 0.7 + k * 0.45;
      column.rot = a;
      column.vy = 0.45 + k * 0.3;
      emit(smoke, column);
    }
    light(p.x, p.y + 0.5, p.z, tmpC.setRGB(G.rand(2, 3), 0.75, 0.18), 0.23, 7);
  };
  const burstP = { color: [1, 1, 1], rot: 0, drag: 1, rise: 0, fade: 0.05, grow: 1, alpha: 1, vx: 0, vy: 0, vz: 0, size: 1, life: 1, spin: 0 };
  const flashWhite = [2.6, 2.2, 1.5], flashFire = [2.4, 1.05, 0.32];
  const dustRing = [0.55, 0.46, 0.34], debA = [0.1, 0.08, 0.07], debB = [0.22, 0.16, 0.11];
  const ballCols = [[2.6, 1.5, 0.45], [2.3, 0.85, 0.22], [2.8, 2.1, 1.2]];
  const sootCols = [[0.1, 0.08, 0.07], [0.18, 0.14, 0.11], [0.3, 0.24, 0.18]];
  FX.explosion = function (pos, small) {
    light(pos.x, pos.y + 1.5, pos.z, tmpC.setRGB(14, 8, 3), 0.9, 22);
    burstP.x = pos.x; burstP.y = pos.y + 0.7; burstP.z = pos.z;
    burstP.vx = burstP.vy = burstP.vz = 0; burstP.drag = 0; burstP.rise = 0;
    burstP.color = flashWhite; burstP.size = small ? 5.4 : 8.2; burstP.life = 0.07; burstP.grow = 5; burstP.alpha = 1; burstP.rot = 0.4; burstP.fade = 0.01;
    emit(FX.flashes, burstP);
    burstP.color = flashFire; burstP.size = small ? 2.6 : 4; burstP.life = 0.18; burstP.grow = 2.6; burstP.rot = 1.3;
    emit(FX.flashes, burstP);
    for (let i = 0; i < 18; i++) emit(glow, {
      x: pos.x + G.rand(-1, 1) * 0.45, y: pos.y + G.rand(0.3, 2) * 0.55, z: pos.z + G.rand(-1, 1) * 0.45,
      color: G.pick(ballCols), size: G.rand(1.6, 3.2) * (small ? 0.9 : 1.15), grow: 3.6, life: G.rand(0.35, 0.75) * 0.75,
      vx: G.rand(-6, 6) * 0.5, vy: G.rand(2, 9) * 0.42, vz: G.rand(-6, 6) * 0.5, drag: 2.4, fade: 0.04,
    });
    for (let i = 0; i < 24; i++) emit(glow, {
      x: pos.x, y: pos.y + 0.5, z: pos.z, color: [1.8, 0.9, 0.35], size: 0.07, life: G.rand(0.4, 1.0),
      vx: G.rand(-14, 14), vy: G.rand(4, 16), vz: G.rand(-14, 14), drag: 0.45, rise: -12,
    });
    for (let i = 0; i < 26; i++) emit(smoke, {
      x: pos.x + G.rand(-2, 2) * 0.4, y: pos.y + G.rand(0.5, 3) * 0.55, z: pos.z + G.rand(-2, 2) * 0.4,
      color: G.pick(sootCols), size: G.rand(2, 4) * 0.8, grow: 1.2, life: G.rand(3, 6), alpha: 0.7,
      vx: G.rand(-4, 4) * 0.65, vy: G.rand(1, 5) * 0.8, vz: G.rand(-4, 4) * 0.65, drag: 1.25, rise: 0.4, fade: 0.18,
    });
    putDecal('scorch', pos.x, pos.y + 0.01, pos.z, 0, 1, 0, small ? 3.4 : 7, 0.95);
    const ring = small ? 14 : 16, spread = small ? 5.5 : 8.5;
    for (let i = 0; i < ring; i++) {
      const a = i / ring * 6.283185;
      burstP.x = pos.x + Math.cos(a) * 0.3; burstP.y = pos.y + 0.06; burstP.z = pos.z + Math.sin(a) * 0.3;
      burstP.vx = Math.cos(a) * spread; burstP.vy = 0.3; burstP.vz = Math.sin(a) * spread;
      burstP.color = dustRing; burstP.size = small ? 0.85 : 1.4; burstP.grow = 1.6; burstP.life = 1.3;
      burstP.alpha = 0.4; burstP.drag = 1.6; burstP.rise = 0.1; burstP.rot = a; burstP.fade = 0.06;
      emit(smoke, burstP);
    }
    for (let i = 0; i < 12; i++) {
      const a = i * 2.39996;
      burstP.x = pos.x; burstP.y = pos.y + 0.4; burstP.z = pos.z;
      burstP.vx = Math.cos(a) * 7; burstP.vy = 3 + (i % 5); burstP.vz = Math.sin(a) * 7;
      burstP.color = i % 2 ? debA : debB; burstP.size = 0.14 + (i % 3) * 0.05; burstP.grow = 0.1;
      burstP.life = 0.85; burstP.alpha = 0.95; burstP.drag = 0.3; burstP.rise = -14; burstP.rot = a; burstP.fade = 0.02;
      emit(smoke, burstP);
    }
    FX.shake = small ? Math.max(FX.shake, 1.1 * Math.max(0, 1 - G.camera.position.distanceTo(pos) / 12)) : 1.4;
  };
  FX.warm = function () {
    emit(smoke, { x: 0, y: -50, z: 0, size: 1, life: 0.2 }); emit(glow, { x: 0, y: -50, z: 0, size: 1, life: 0.2 }); emit(FX.flashes, { x: 0, y: -50, z: 0, size: 1, life: 0.2 });
    putDecal('hole', 0, -50, 0, 0, 1, 0, 0.1, 1);
    FX.tracer(new THREE.Vector3(0, -50, 0), new THREE.Vector3(0, -50, 10));
    FX.shell(new THREE.Vector3(0, -50, 0), 'ar');
    stepPool(smoke, 0.01); stepPool(glow, 0.01); stepPool(FX.flashes, 0.01);
  };
  const ghost = { pending: false, life: 0, hold: 0, max: 0.9, canvas: null, ctx: null };
  function mountGhost() {
    if (ghost.canvas) return !!(ghost.ctx && ghost.ctx.drawImage);
    const c = document.createElement('canvas');
    c.id = 'flashAfter';
    if (c.style) c.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;pointer-events:none;z-index:5;opacity:0';
    const white = document.getElementById('flashView');
    if (white && white.parentNode && white.parentNode.insertBefore) white.parentNode.insertBefore(c, white);
    else if (document.body && document.body.appendChild) document.body.appendChild(c);
    ghost.canvas = c;
    ghost.ctx = c.getContext ? c.getContext('2d') : null;
    return !!(ghost.ctx && ghost.ctx.drawImage);
  }
  function blitGhost() {
    if (!ghost.pending) return;
    ghost.pending = false;
    const src = G.renderer && G.renderer.domElement;
    if (!src || !mountGhost()) return;
    const w = src.width || src.clientWidth || 2, h = src.height || src.clientHeight || 2;
    if (ghost.canvas.width !== w) { ghost.canvas.width = w; ghost.canvas.height = h; }
    try { ghost.ctx.drawImage(src, 0, 0, w, h); } catch (e) { return; }
    ghost.canvas.hidden = false;
    if (ghost.canvas.style) ghost.canvas.style.opacity = 1;
  }
  FX.flashGhost = function (dur) {
    const d = dur > 0.05 ? dur : 0.4;
    ghost.pending = true;
    ghost.hold = Math.max(0, d - 0.9);
    ghost.max = 0.9;
    ghost.life = ghost.hold + ghost.max;
  };
  FX.clear = function () {
    FX.shake = 0;
    for (const cap of caps) cap.mesh.visible = false;
    if (flamePool) flamePool.mesh.visible=false;
    for (const P of [smoke, glow, flamePool, FX.flashes]) { if (!P) continue; P.items.forEach((it) => (it.life = it.max)); stepPool(P, 0); }
    for (let i = 0; i < SCORCH_N; i++) scorchRec[i].on = false;
    ghost.pending = false; ghost.life = 0;
    if (ghost.canvas) ghost.canvas.hidden = true;
    if (decals) { decals.used = 0; decals.idx = 0; decals.mesh.count = 0; }
    if (tracers) tracers.items.forEach((t) => (t.on = false));
    if (shells) { shells.items.forEach((s) => (s.on = false)); shells.mesh.count = 0; }
    U.uFlashColor.value.setRGB(0, 0, 0); flashL.t = 0;
  };

  const e3 = new THREE.Euler();
  FX.update = function (dt) {
    G.Nades.updateView();
    for (const cap of caps) {
      if (!cap.mesh.visible) continue;
      cap.age += dt;
      const pos = cap.mesh.position;
      const floor = floorBelow(pos) + 0.055;
      if (pos.y > floor || cap.vel.y > 0) {
        cap.vel.y -= 11 * dt;
        pos.addScaledVector(cap.vel, dt);
        pos.y = Math.max(floor, pos.y);
        cap.mesh.rotation.x += dt * 8; cap.mesh.rotation.z += dt * 5;
      }
      cap.mesh.visible = cap.age < 3.5;
    }
    if (flamePool.mesh.visible) { stepPool(flamePool,dt); flamePool.mesh.visible=G.time<flamePool.until; }
    stepPool(smoke, dt); stepPool(glow, dt); stepPool(FX.flashes, dt);
    // tracers
    const T = tracers, A = T.a.array, B = T.b.array;
    for (let i = 0; i < T.n; i++) {
      const t = T.items[i];
      if (t.on) { t.t += dt * 260; if (t.t >= t.dist) t.on = false; }
      if (!t.on) { A[i * 4 + 3] = 0; B[i * 4 + 3] = 0; continue; }
      const a = t.t, b = Math.min(t.t + 6, t.dist);
      A[i * 4] = t.fx + t.dx * a; A[i * 4 + 1] = t.fy + t.dy * a; A[i * 4 + 2] = t.fz + t.dz * a; A[i * 4 + 3] = 0.012;
      B[i * 4] = t.fx + t.dx * b; B[i * 4 + 1] = t.fy + t.dy * b; B[i * 4 + 2] = t.fz + t.dz * b; B[i * 4 + 3] = 0.85;
    }
    T.a.needsUpdate = T.b.needsUpdate = true;
    // brass: bounce on floors, settle, then disappear
    const S = shells;
    for (let i = 0; i < S.mesh.count; i++) {
      const s = S.items[i];
      if (!s.on) { m4.makeScale(0, 0, 0); S.mesh.setMatrixAt(i, m4); continue; }
      s.t += dt;
      if (s.t > 4) { s.on = false; continue; }
      if (!s.rest) {
        s.v.y -= 9.8 * dt;
        s.p.addScaledVector(s.v, dt);
        s.r.x += s.w.x * dt; s.r.y += s.w.y * dt; s.r.z += s.w.z * dt;
        const floor = floorBelow(s.p);
        if (s.p.y < floor + 0.005) {
          s.p.y = floor + 0.005;
          if (Math.abs(s.v.y) < 0.6) { s.rest = true; s.r.x = Math.PI / 2; s.r.z = 0; }
          else { s.v.y *= -0.35; s.v.x *= 0.5; s.v.z *= 0.5; s.w.multiplyScalar(0.5); if (Math.random() < 0.4 && s.p.distanceTo(G.camera.position) < 6) G.Audio.shell && G.Audio.shell(s.p); }
        }
      }
      m4.compose(s.p, q.setFromEuler(e3.set(s.r.x, s.r.y, s.r.z)), sc.set(1, 1, 1));
      S.mesh.setMatrixAt(i, m4);
    }
    S.mesh.instanceMatrix.needsUpdate = true;
    // flash light fades
    if (flashL.t > 0) {
      flashL.t = Math.max(0, flashL.t - dt);
      U.uFlashColor.value.copy(flashL.peak).multiplyScalar(flashL.t / flashL.max);
    }
    if (decals && decalGen) {
      let dirty = false;
      for (let i = 0; i < SCORCH_N; i++) {
        const s = scorchRec[i];
        if (!s.on || !s.fade) continue;
        if (decalGen[s.i] !== s.gen) { s.on = false; continue; }
        if (s.delay > 0) { s.delay -= dt; continue; }
        s.a -= dt * 0.22;
        if (s.a <= 0) { s.a = 0; s.on = false; }
        decals.al.setX(s.i, Math.max(0, s.a));
        dirty = true;
      }
      if (dirty) decals.al.needsUpdate = true;
    }
    if (ghost.life > 0) {
      ghost.life = Math.max(0, ghost.life - dt);
      if (ghost.canvas && ghost.canvas.style) {
        const o = ghost.life < ghost.max ? Math.max(0, ghost.life / (ghost.max || 1)) : 1;
        ghost.canvas.style.opacity = o;
        if (ghost.life === 0) ghost.canvas.hidden = true;
      }
    }
    FX.shake = Math.max(0, FX.shake - dt * 1.5);
  };
  function floorBelow(p) {
    let best = 0;
    const list = G.Map.query(p.x - 0.01, p.z - 0.01, p.x + 0.01, p.z + 0.01);
    for (const b of list) if (b.x0 <= p.x && b.x1 >= p.x && b.z0 <= p.z && b.z1 >= p.z && b.y1 <= p.y + 0.05 && b.y1 > best) best = b.y1;
    return best;
  }
})(window.G);
