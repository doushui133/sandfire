// fx.js — effects, each kind drawn in a single instanced draw call: smoke / dust / blood mist,
// glowing sparks and flashes, tracers, bullet holes and blood splats, brass casings, explosion.
// Gunfire also lights the town for a moment through the world shader's flash light.
(function (G) {
  'use strict';
  const THREE = G.THREE, U = G.Gfx.U;
  const FX = G.FX = { shake: 0 };
  let scene, smoke, glow, flamePool, decals, tracers, shells;
  const v1 = new THREE.Vector3(), v2 = new THREE.Vector3(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), zAxis = new THREE.Vector3(0, 0, 1);
  const flashL = { t: 0, max: 0.06, peak: new THREE.Color() };

  // ---------- billboard particle pools ----------
  const PVS = [
    'attribute vec4 iPos; attribute vec4 iCol; attribute float iRot;',
    'uniform vec3 uFogColor; uniform float uFogDensity;',
    'varying vec2 vUv; varying vec4 vCol; varying float vFog;',
    'void main() {',
    '  vec3 right = vec3( viewMatrix[ 0 ][ 0 ], viewMatrix[ 1 ][ 0 ], viewMatrix[ 2 ][ 0 ] );',
    '  vec3 up = vec3( viewMatrix[ 0 ][ 1 ], viewMatrix[ 1 ][ 1 ], viewMatrix[ 2 ][ 1 ] );',
    '  float c = cos( iRot ), s = sin( iRot );',
    '  vec2 p = vec2( position.x * c - position.y * s, position.x * s + position.y * c ) * iPos.w;',
    '  vec3 wp = iPos.xyz + right * p.x + up * p.y;',
    '  vUv = uv; vCol = iCol;',
    '  vFog = 1.0 - exp( -length( wp - cameraPosition ) * uFogDensity );',
    '  gl_Position = projectionMatrix * viewMatrix * vec4( wp, 1.0 );',
    '}',
  ].join('\n');
  const PFS = [
    'uniform sampler2D map; uniform vec3 uFogColor; uniform float time;',
    'varying vec2 vUv; varying vec4 vCol; varying float vFog;',
    'void main() {',
    '  vec2 uv = vUv;',
    '#ifdef FLAME',
    '  uv.x = .5 + (uv.x-.5)/(1.-.78*uv.y) + .13*sin(time*8.+uv.y*7.)*uv.y;',
    '  if (uv.x<0. || uv.x>1.) discard;',
    '#endif',
    '  vec4 t = texture2D( map, uv );',
    '#ifdef ADDITIVE',
    '  vec3 c = vCol.rgb * t.rgb * t.a * vCol.a * ( 1.0 - vFog );',
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
    for (let i = 0; i < n; i++) items.push({ life: 0, max: 1, x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, size: 0, grow: 0, rot: 0, spin: 0, r: 1, g: 1, b: 1, a: 1, drag: 1, rise: 0, fade: 1 });
    return { mesh, items, n, idx: 0, pos, col, rot };
  }
  function emit(P, o) {
    const it = P.items[P.idx]; P.idx = (P.idx + 1) % P.n;
    it.life = 0; it.max = o.life || 0.6;
    it.x = o.x; it.y = o.y; it.z = o.z; it.vx = o.vx || 0; it.vy = o.vy || 0; it.vz = o.vz || 0;
    it.size = o.size || 0.3; it.grow = o.grow || 0; it.rot = o.rot === undefined ? Math.random() * 6.28 : o.rot; it.spin = o.spin || 0;
    const c = o.color || [1, 1, 1]; it.r = c[0]; it.g = c[1]; it.b = c[2]; it.a = o.alpha === undefined ? 1 : o.alpha;
    it.drag = o.drag || 0; it.rise = o.rise || 0; it.fade = o.fade || 0;
  }
  function stepPool(P, dt) {
    const pa = P.pos.array, ca = P.col.array, ra = P.rot.array;
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
    }
    P.pos.needsUpdate = P.col.needsUpdate = P.rot.needsUpdate = true;
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
    q.setFromUnitVectors(zAxis, v1);
    q.multiply(new THREE.Quaternion().setFromAxisAngle(zAxis, Math.random() * 6.28));
    m4.compose(v2.set(x + nx * 0.008, y + ny * 0.008, z + nz * 0.008), q, sc.set(size, size, size));
    D.mesh.setMatrixAt(i, m4);
    const r = DEC[kind]; D.uvr.setXYZW(i, r[0], r[1], r[2], r[3]); D.al.setX(i, alpha === undefined ? 1 : alpha);
    D.mesh.count = D.used;
    D.mesh.instanceMatrix.needsUpdate = true; D.uvr.needsUpdate = true; D.al.needsUpdate = true;
  }

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
    const geo = G.Geo.paint(G.Geo.cyl(0.0048, 0.0048, 0.022, 7, 'z'), { c: 0xb8923e, r: 0.3, m: 1, w: 0.2 });
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
    flamePool = pool(Math.round(200 * k),G.Tex.tex('puff'),true);
    flamePool.mesh.material.defines.FLAME = ''; flamePool.mesh.visible=false;
    scene.add(flamePool.mesh);
    glow.flashTex = G.Tex.tex('flash');
    decals = decalPool(200);
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

  FX.impact = function (x, y, z, nx, ny, nz) {
    for (let i = 0; i < 3; i++) emit(smoke, {
      x: x + nx * 0.05, y: y + ny * 0.05, z: z + nz * 0.05, color: dustCol, size: 0.12 + Math.random() * 0.12, grow: 1.6, life: 0.5 + Math.random() * 0.5, alpha: 0.7,
      vx: nx * G.rand(0.6, 1.8) + G.rand(-0.4, 0.4), vy: ny * G.rand(0.6, 1.8) + G.rand(0, 0.5), vz: nz * G.rand(0.6, 1.8) + G.rand(-0.4, 0.4), drag: 3, rise: 0.2,
    });
    for (let i = 0; i < 2; i++) emit(glow, { x, y, z, color: [1.6, 1.1, 0.6], size: 0.03, life: 0.08 + Math.random() * 0.06, vx: (nx + G.rand(-0.8, 0.8)) * 6, vy: (ny + G.rand(0, 1)) * 6, vz: (nz + G.rand(-0.8, 0.8)) * 6 });
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
    if (!firstPerson) {
      emit(FX.flashes, { x: pos.x + dir.x * 0.05, y: pos.y + dir.y * 0.05, z: pos.z + dir.z * 0.05, color: [1.6, 1.15, 0.6], size: big ? 0.55 : 0.38, life: 0.05 });
      emit(smoke, { x: pos.x, y: pos.y, z: pos.z, color: [0.55, 0.53, 0.5], size: 0.1, grow: 2, life: 0.6, alpha: 0.22, vx: dir.x * 0.8, vy: 0.3, vz: dir.z * 0.8, drag: 2 });
    }
    light(pos.x, pos.y, pos.z, tmpC.setRGB(2.6, 1.7, 0.8).multiplyScalar(big ? 1.3 : 1), 0.06, big ? 9 : 7);
  };
  const tmpC = new THREE.Color();
  FX.shell = function (pos, model) {
    if (!pos || model === 'sniper') return;
    const S = shells, s = S.items[S.idx]; S.idx = (S.idx + 1) % S.n;
    const cam = G.camera, right = v1.set(1, 0, 0).applyQuaternion(cam.quaternion), up = v2.set(0, 1, 0).applyQuaternion(cam.quaternion);
    s.p.copy(pos);
    s.v.copy(right).multiplyScalar(G.rand(1.6, 2.6)).addScaledVector(up, G.rand(1.2, 2.2));
    s.r.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
    s.w.set(G.rand(-20, 20), G.rand(-20, 20), G.rand(-20, 20));
    s.t = 0; s.on = true; s.rest = false;
    S.mesh.count = Math.max(S.mesh.count, S.idx === 0 ? S.n : S.idx);
  };
  // Cloud geometry stores only puff offsets. The renderer sorts whole clouds by depth.
  const cloudPool = [];
  let cloudGeometry, cloudMaterial;
  FX.cloud = function (pos) {
    if (!cloudGeometry) {
      const base = new THREE.PlaneGeometry(1,1), g = new THREE.InstancedBufferGeometry();
      g.index=base.index; g.setAttribute('position',base.attributes.position); g.setAttribute('uv',base.attributes.uv);
      const n=G.gpu && G.gpu.soft || G.Touch.primary() ? 16 : 28, offsets=new Float32Array(n*4);
      offsets[3]=2.12;
      for (let i=1;i<n;i++) {
        const y=1-2*i/n, r=Math.sqrt(1-y*y), theta=i*2.4;
        offsets.set([0.69*r*Math.cos(theta),0.69*y,0.69*r*Math.sin(theta),0.84],4*i);
      }
      g.setAttribute('puff',new THREE.InstancedBufferAttribute(offsets,4)); g.instanceCount=n;
      cloudGeometry=g;
      cloudMaterial=new THREE.ShaderMaterial({ transparent:true, depthWrite:false,
        uniforms:{ map:{value:G.Tex.tex('puff')}, sun:U.uSunDir },
        vertexShader:`attribute vec4 puff; varying vec2 vUv; varying float lightness; varying float core;
          uniform vec3 sun;
          void main(){ vec4 p=modelViewMatrix*vec4(puff.xyz,1.);
          p.xy+=position.xy*puff.w*length(modelMatrix[0].xyz);
          vUv=uv; lightness=.45+.14*dot(puff.xyz, sun); core=step(2.,puff.w);
          gl_Position=projectionMatrix*p; }`,
        fragmentShader:`uniform sampler2D map; varying vec2 vUv; varying float lightness; varying float core;
          void main(){float d=length(vUv-.5)*2.; float fluff=texture2D(map,vUv).a;
          float a=mix(fluff,smoothstep(0.,.08,1.-d),core);
          if(a<.005) discard; gl_FragColor=vec4(vec3(.98,.96,.93)*(lightness+.09*fluff),a);}`,
      });
    }
    const m=cloudPool.pop() || new THREE.Mesh(cloudGeometry,cloudMaterial);
    m.frustumCulled=false; m.renderOrder=3; m.position.copy(pos); m.scale.setScalar(0.18); scene.add(m); return m;
  };
  FX.sizeCloud = function (m,r,age) { m.scale.setScalar(r); m.rotation.y=age*0.08; };
  FX.recycleCloud = function (m) { scene.remove(m); cloudPool.push(m); };
  FX.scorch = (p) => putDecal('scorch',p.x,p.y-0.085,p.z,0,1,0,4,0.8);
  const flameColor=[2.4,0.55,0.07], emberColor=[2,1.1,0.17];
  const flame = {color:flameColor,life:.32,grow:-1,rot:0}, ember={color:emberColor,size:.055,life:.6,vy:2.6,vx:.4};
  FX.flames = function (f) {
    const p=f.pos; flamePool.mesh.visible=true; flamePool.until=G.time+0.4;
    for (const c of f.cells) {
      if (f.age<c.delay) continue;
      const v=c.pos;
      flame.x=v.x; flame.y=v.y+.2; flame.z=v.z; flame.size=G.rand(.64,1); flame.vy=G.rand(1.4,2.5); emit(flamePool,flame);
      if (Math.random()<0.11) { ember.x=v.x; ember.y=v.y+.4; ember.z=v.z; emit(glow,ember); }
    }
    light(p.x,p.y+0.5,p.z,tmpC.setRGB(G.rand(2,3),0.75,0.18),0.23,7);
  };
  FX.explosion = function (pos, small) {
    light(pos.x, pos.y + 1.5, pos.z, tmpC.setRGB(14, 8, 3), 0.9, 22);
    for (let i = 0; i < 18; i++) emit(glow, {
      x: pos.x + G.rand(-1, 1), y: pos.y + G.rand(0.3, 2), z: pos.z + G.rand(-1, 1), color: G.pick([[2.4, 1.4, 0.5], [2.2, 0.9, 0.3], [2.6, 2.0, 1.1]]), size: G.rand(1.6, 3.2), grow: 2.2, life: G.rand(0.35, 0.75),
      vx: G.rand(-6, 6), vy: G.rand(2, 9), vz: G.rand(-6, 6), drag: 3,
    });
    for (let i = 0; i < 24; i++) emit(glow, { x: pos.x, y: pos.y + 0.5, z: pos.z, color: [2, 1.3, 0.6], size: 0.06, life: G.rand(0.4, 1.0), vx: G.rand(-14, 14), vy: G.rand(4, 16), vz: G.rand(-14, 14), drag: 0.5, rise: -9 });
    for (let i = 0; i < 26; i++) emit(smoke, {
      x: pos.x + G.rand(-2, 2), y: pos.y + G.rand(0.5, 3), z: pos.z + G.rand(-2, 2), color: G.pick([[0.16, 0.13, 0.11], [0.26, 0.21, 0.17], [0.38, 0.32, 0.25]]), size: G.rand(2, 4), grow: 0.8, life: G.rand(3, 6), alpha: 0.8,
      vx: G.rand(-4, 4), vy: G.rand(1, 5), vz: G.rand(-4, 4), drag: 1.2, rise: 0.6, fade: 0.15,
    });
    putDecal('scorch', pos.x, pos.y + 0.01, pos.z, 0, 1, 0, 7, 0.95);
    FX.shake = small ? Math.max(FX.shake,1.1*Math.max(0,1-G.camera.position.distanceTo(pos)/12)) : 1.4;
  };
  FX.warm = function () {
    emit(smoke, { x: 0, y: -50, z: 0, size: 1, life: 0.2 }); emit(glow, { x: 0, y: -50, z: 0, size: 1, life: 0.2 }); emit(FX.flashes, { x: 0, y: -50, z: 0, size: 1, life: 0.2 });
    putDecal('hole', 0, -50, 0, 0, 1, 0, 0.1, 1);
    FX.tracer(new THREE.Vector3(0, -50, 0), new THREE.Vector3(0, -50, 10));
    FX.shell(new THREE.Vector3(0, -50, 0), 'ar');
    stepPool(smoke, 0.01); stepPool(glow, 0.01); stepPool(FX.flashes, 0.01);
  };
  FX.clear = function () {
    if (flamePool) flamePool.mesh.visible=false;
    for (const P of [smoke, glow, flamePool, FX.flashes]) { if (!P) continue; P.items.forEach((it) => (it.life = it.max)); stepPool(P, 0); }
    if (decals) { decals.used = 0; decals.idx = 0; decals.mesh.count = 0; }
    if (tracers) tracers.items.forEach((t) => (t.on = false));
    if (shells) { shells.items.forEach((s) => (s.on = false)); shells.mesh.count = 0; }
    U.uFlashColor.value.setRGB(0, 0, 0); flashL.t = 0;
  };

  const e3 = new THREE.Euler();
  FX.update = function (dt) {
    G.Nades.updateView();
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
    FX.shake = Math.max(0, FX.shake - dt * 1.5);
  };
  function floorBelow(p) {
    let best = 0;
    const list = G.Map.query(p.x - 0.01, p.z - 0.01, p.x + 0.01, p.z + 0.01);
    for (const b of list) if (b.x0 <= p.x && b.x1 >= p.x && b.z0 <= p.z && b.z1 >= p.z && b.y1 <= p.y + 0.05 && b.y1 > best) best = b.y1;
    return best;
  }
})(window.G);
