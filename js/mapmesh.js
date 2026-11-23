// mapmesh.js — turns MapGeo's data into meshes: lightmapped town chunks, decals, props lit by the
// probe grid (barrels, palms, cables), and cheap distant scenery around the town.
(function (G) {
  'use strict';
  const THREE = G.THREE, MG = G.MapGeo;
  const MM = G.MapMesh = {};

  function quadGeometry(list, geo, tex) {
    const n = list.length, P = new Float32Array(n * 12), N = new Float32Array(n * 12), UV = new Float32Array(n * 8), UV2 = new Float32Array(n * 8);
    const TG = new Float32Array(n * 12), C = new Float32Array(n * 12), MT = new Float32Array(n * 16);
    const SU = tex.scanLayers && !list[0].decal ? new Float32Array(n * 16) : null;
    const idx = n * 4 > 65535 ? new Uint32Array(n * 6) : new Uint16Array(n * 6);
    const W = geo.atlasW, H = geo.atlasH;
    list.forEach((q, k) => {
      const mat = MG.MATS[q.m];
      const lu = Math.hypot(q.u[0], q.u[1], q.u[2]), lv = Math.hypot(q.v[0], q.v[1], q.v[2]);
      const uh = [q.u[0] / lu, q.u[1] / lu, q.u[2] / lu], vh = [q.v[0] / lv, q.v[1] / lv, q.v[2] / lv];
      let nx = q.u[1] * q.v[2] - q.u[2] * q.v[1], ny = q.u[2] * q.v[0] - q.u[0] * q.v[2], nz = q.u[0] * q.v[1] - q.u[1] * q.v[0];
      const nl = Math.hypot(nx, ny, nz); nx /= nl; ny /= nl; nz /= nl;
      const scan = SU && G.Tex.surfaceScan(q, tex.scanLayers);
      // Match adjoining floor quads and use a common offset along each facade plane.
      const phase = scan ? (q.o[0] * nx + q.o[1] * ny + q.o[2] * nz) * .317 + q.tint[1] * 11.7 : 0;
      const layer = tex.layers ? tex.layers[q.m] : mat.layer;
      [[0, 0], [1, 0], [1, 1], [0, 1]].forEach(([s, t], c) => {
        const v = k * 4 + c;
        const x = q.o[0] + q.u[0] * s + q.v[0] * t, y = q.o[1] + q.u[1] * s + q.v[1] * t, z = q.o[2] + q.u[2] * s + q.v[2] * t;
        P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z;
        N[v * 3] = nx; N[v * 3 + 1] = ny; N[v * 3 + 2] = nz;
        TG[v * 3] = uh[0]; TG[v * 3 + 1] = uh[1]; TG[v * 3 + 2] = uh[2];
        if (q.uv) { UV[v * 2] = s ? q.uv[2] : q.uv[0]; UV[v * 2 + 1] = t ? q.uv[3] : q.uv[1]; }
        else { UV[v * 2] = (x * uh[0] + y * uh[1] + z * uh[2]) / mat.tile; UV[v * 2 + 1] = (x * vh[0] + y * vh[1] + z * vh[2]) / mat.tile; }
        if (SU) {
          SU[v * 4 + 2] = scan ? scan.layer : -1;
          if (scan) {
            SU[v * 4] = (x * uh[0] + y * uh[1] + z * uh[2]) / scan.tile + phase;
            SU[v * 4 + 1] = (x * vh[0] + y * vh[1] + z * vh[2]) / scan.tile + phase * .63;
            SU[v * 4 + 3] = scan.mode;
          }
        }
        UV2[v * 2] = (q.lx + 0.5 + s * (q.tw - 1)) / W; UV2[v * 2 + 1] = (q.ly + 0.5 + t * (q.th - 1)) / H;
        C[v * 3] = q.tint[0]; C[v * 3 + 1] = q.tint[1]; C[v * 3 + 2] = q.tint[2];
        MT[v * 4] = layer === undefined ? 0 : layer; MT[v * 4 + 1] = mat.spec;
        MT[v * 4 + 2] = q.wall ? q.wall[0] : 0; MT[v * 4 + 3] = q.wall ? q.wall[1] : -1;
      });
      idx.set([k * 4, k * 4 + 1, k * 4 + 2, k * 4, k * 4 + 2, k * 4 + 3], k * 6);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
    g.setAttribute('uv2', new THREE.BufferAttribute(UV2, 2));
    g.setAttribute('tang', new THREE.BufferAttribute(TG, 3));
    g.setAttribute('color', new THREE.BufferAttribute(C, 3));
    g.setAttribute('mat', new THREE.BufferAttribute(MT, 4));
    if (SU) g.setAttribute('scan', new THREE.BufferAttribute(SU, 4));
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.computeBoundingSphere();
    return g;
  }

  MM.build = function (scene, geo, tex, preset) {
    const root = new THREE.Group();
    root.name = 'town';
    const worldMat = G.Gfx.worldMaterial(tex, preset, false), decalMat = G.Gfx.worldMaterial(tex, preset, true);
    MM.materials = [worldMat, decalMat];
    // 4×4 chunks so whole districts behind the camera are skipped
    const buckets = new Map();
    for (const q of geo.quads) {
      if (preset.key === 'low' && q.detail) continue;
      const cx = q.o[0] + (q.u[0] + q.v[0]) / 2, cz = q.o[2] + (q.u[2] + q.v[2]) / 2;
      const key = q.decal ? 'decal' : Math.min(3, Math.max(0, Math.floor((cx + 50) / 25))) + ',' + Math.min(3, Math.max(0, Math.floor((cz + 50) / 25)));
      if (!buckets.has(key)) buckets.set(key, []);
      buckets.get(key).push(q);
    }
    for (const [key, list] of buckets) {
      const m = new THREE.Mesh(quadGeometry(list, geo, tex), key === 'decal' ? decalMat : worldMat);
      m.matrixAutoUpdate = false;
      if (key === 'decal') m.renderOrder = 1; else m.layers.enable(2);
      root.add(m);
    }
    buildProps(root, geo.props, preset, tex.barrelMaps);
    buildDistant(root);
    scene.add(root);
    MM.root = root;
    return root;
  };

  // ---------- props lit by the probe grid ----------
  const lin = (hex) => [Math.pow(((hex >> 16) & 255) / 255, 2.2), Math.pow(((hex >> 8) & 255) / 255, 2.2), Math.pow((hex & 255) / 255, 2.2)];
  function frondTexture() {
    const c = document.createElement('canvas'); c.width = 128; c.height = 512;
    const g = c.getContext('2d'), r = G.seeded(601);
    g.strokeStyle = '#6d6a3a'; g.lineWidth = 6; g.beginPath(); g.moveTo(64, 512); g.lineTo(64, 0); g.stroke();
    for (let y = 500; y > 10; y -= 9) {
      const len = 58 * Math.sin(Math.PI * Math.min(1, (512 - y) / 520)) + 6;
      for (const s of [-1, 1]) {
        const shade = 70 + r() * 50;
        g.strokeStyle = 'rgb(' + (shade * 0.75 | 0) + ',' + (shade * 1.05 + 30 | 0) + ',' + (shade * 0.45 | 0) + ')';
        g.lineWidth = 5; g.beginPath(); g.moveTo(64, y); g.quadraticCurveTo(64 + s * len * 0.5, y - 14, 64 + s * len, y - 30 - r() * 10); g.stroke();
      }
    }
    const t = new THREE.CanvasTexture(c);
    t.generateMipmaps = true; t.minFilter = THREE.LinearMipmapLinearFilter;
    return t;
  }
  MM.frondTex = null;
  const detailGroups = [];
  function buildProps(root, props, preset, barrelMaps) {
    const metalGeos = [], trunkGeos = [], frondGeos = [], darkGeos = [];
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), v = new THREE.Vector3();
    const sacks = props.filter(p => p.type === 'sack'), barrels = props.filter(p => p.type === 'barrel');
    const BARREL_COLS = [0x3f6a8a, 0x8a3a2c, 0x4a6a3a, 0xb08a2a, 0x5a5f63];
    for (const p of props) {
      const rng = G.seeded(p.seed || 7);
      if (p.type === 'palm') {
        const h = 5.6 + rng() * 1.3, lean = (rng() - 0.5) * 0.5, leanDir = rng() * 6.28;
        const pts = [];
        for (let i = 0; i <= 8; i++) { const t = i / 8; pts.push(new THREE.Vector3(Math.cos(leanDir) * lean * t * t, h * t, Math.sin(leanDir) * lean * t * t)); }
        const curve = new THREE.CatmullRomCurve3(pts);
        const tg = new THREE.TubeGeometry(curve, 16, 0.2, 8, false);
        // taper and ring bumps
        const pos = tg.attributes.position;
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i);
          const t = G.clamp(v.y / h, 0, 1), k = (1.25 - t * 0.45) * (1 + 0.06 * Math.sin(v.y * 9));
          const cpt = curve.getPoint(t);
          v.x = cpt.x + (v.x - cpt.x) * k; v.z = cpt.z + (v.z - cpt.z) * k;
          pos.setXYZ(i, v.x, v.y, v.z);
        }
        tg.computeVertexNormals();
        G.Gfx.paint(tg, lin(0x8a7458), 0.95, 0);
        tg.applyMatrix4(m4.makeTranslation(p.x, 0, p.z));
        trunkGeos.push(tg);
        const top = curve.getPoint(1);
        const nF = 10 + Math.floor(rng() * 3);
        for (let i = 0; i < nF; i++) {
          const fg = new THREE.PlaneGeometry(1.0, 3.6, 1, 6);
          const fp = fg.attributes.position;
          for (let k = 0; k < fp.count; k++) { const yy = fp.getY(k) + 1.8; fp.setZ(k, -Math.pow(yy / 3.6, 1.8) * 1.6 - Math.abs(fp.getX(k)) * 0.25); fp.setY(k, yy); }
          fg.computeVertexNormals();
          G.Gfx.paint(fg, lin(0xc9d6a0), 0.8, 0);
          const ry = i / nF * Math.PI * 2 + rng() * 0.3, rx = -0.5 - rng() * 0.55;
          m4.makeRotationFromEuler(new THREE.Euler(rx, ry, 0, 'YXZ')).setPosition(p.x + top.x, top.y - 0.1, p.z + top.z);
          fg.applyMatrix4(m4);
          frondGeos.push(fg);
        }
      } else if (p.type === 'planter' && preset.key !== 'low') {
        const pot = new THREE.CylinderGeometry(.22, .135, .34, 8);
        G.Gfx.paint(pot, lin(0xb26544), .86, 0);
        pot.translate(p.x, p.y + .17, p.z);
        trunkGeos.push(pot);
        for (let i = 0; i < 6; i++) {
          const leaf = new THREE.SphereGeometry(1, 5, 3);
          G.Gfx.paint(leaf, lin(i % 2 ? 0x677544 : 0x819252), .88, 0);
          leaf.scale(.055, .095 + rng() * .10, .045);
          leaf.rotateZ(.46 + rng() * .53);
          leaf.translate(-.105, .08, 0);
          leaf.rotateY(i * 2.39996);
          leaf.translate(p.x, p.y + .37, p.z);
          trunkGeos.push(leaf);
        }
        for (let i = 0; i < 3; i++) {
          const stone = new THREE.DodecahedronGeometry(.06 + rng() * .05, 0);
          G.Gfx.paint(stone, lin(0xba956a), .96, 0);
          stone.scale(1.2, .58, .8);
          stone.rotateY(rng() * 6.28);
          stone.translate(p.x + (i - 1) * .23, p.y + .035, p.z + .23);
          trunkGeos.push(stone);
        }
      } else if (p.type === 'rod') {
        const a = new THREE.Vector3().fromArray(p.a), b = new THREE.Vector3().fromArray(p.b), len = a.distanceTo(b);
        const g = new THREE.CylinderGeometry(0.012, 0.012, len, 5, 1, true);
        G.Gfx.paint(g, lin(0x3a3632), 0.5, 0.7);
        q.setFromUnitVectors(up, v.subVectors(b, a).normalize());
        g.applyMatrix4(m4.compose(a.clone().add(b).multiplyScalar(0.5), q, new THREE.Vector3(1, 1, 1)));
        metalGeos.push(g);
      } else if (p.type === 'cable') {
        const a = new THREE.Vector3().fromArray(p.a), b = new THREE.Vector3().fromArray(p.b);
        const mid = a.clone().add(b).multiplyScalar(0.5); mid.y -= p.sag; mid.z += 0.3;
        const g = new THREE.TubeGeometry(new THREE.QuadraticBezierCurve3(a, mid, b), 24, 0.014, 4, false);
        G.Gfx.paint(g, lin(0x1c1a18), 0.7, 0);
        if (!preset.movingShadow) {
          g.computeBoundingSphere();
          const cable = new THREE.Mesh(g,MM.propMat || (MM.propMat=G.Gfx.litMaterial({})));
          cable.matrixAutoUpdate=false; root.add(cable); detailGroups.push(cable);
        } else darkGeos.push(g);
      }
    }
    const add = (geos, mat, layer) => {
      if (!geos.length) return null;
      const m = new THREE.Mesh(G.Gfx.merge(geos), mat);
      m.matrixAutoUpdate = false; if (layer) m.layers.enable(layer);
      root.add(m); return m;
    };
    MM.propMat = MM.propMat || G.Gfx.litMaterial({});
    const instance = (list,geo,transform,mat) => {
      if (!list.length) return;
      G.Gfx.paint(geo,[1,1,1],list === barrels ? .52 : .94, list === barrels ? .48 : 0);
      const mesh = new THREE.InstancedMesh(geo,mat || MM.propMat,list.length);
      list.forEach((p,i) => {
        const shade=transform(p,i);
        mesh.setMatrixAt(i,m4); mesh.setColorAt(i,new THREE.Color(shade).convertSRGBToLinear());
      });
      mesh.layers.enable(2); root.add(mesh);
    };
    const prof=[[0,0],[.39,0],[.41,.025],[.41,.27],[.432,.29],[.41,.31],[.41,.84],[.432,.86],[.41,.88],[.41,1.13],[.39,1.15],[.36,1.15],[.36,1.13],[0,1.13]];
    instance(barrels,new THREE.LatheGeometry(prof.map(p=>new THREE.Vector2(p[0],p[1])),18),p=>{
      m4.makeTranslation(p.x,0,p.z); return BARREL_COLS[p.seed%BARREL_COLS.length];
    },barrelMaps && G.Gfx.litMaterial(barrelMaps));
    const sack=G.Geo.rbox(1,1,1,.23,3), sp=sack.attributes.position;
    for(let i=0;i<sp.count;i++){
      const x=sp.getX(i), y=sp.getY(i), z=sp.getZ(i);
      sp.setXYZ(i,x*(1-.13*y*y),y*(.97-.1*Math.cos(x*11+z*3)),z*(.98+.03*Math.sin(x*12)));
    }
    sack.computeVertexNormals();
    instance(sacks,sack,p=>{
      m4.makeScale(p.w,p.h,p.d).setPosition(p.x,p.y,p.z);
      return [0x9e9069,0xb4a47e,0x95896c][p.seed%3];
    });
    MM.frondTex = frondTexture();
    MM.frondMat = G.Gfx.litMaterial({ map: MM.frondTex, doubleSide: true });
    add(metalGeos, MM.propMat, 2);
    add(trunkGeos, MM.propMat, 2);
    add(darkGeos, MM.propMat, 0);
    add(frondGeos, MM.frondMat, 3);
  }

  MM.updateDetail = function (camera) {
    for (const m of detailGroups) m.visible = m.geometry.boundingSphere.center.distanceToSquared(camera.position) < 48*48;
  };

  // ---------- distant scenery: sand plain, dunes and the rest of the town ----------
  function buildDistant(root) {
    const geos = [], r = G.seeded(701);
    const plain = new THREE.RingGeometry(70, 460, 64, 4);
    plain.rotateX(-Math.PI / 2);
    G.Gfx.paint(plain, lin(0xc7a676), 1, 0);
    plain.translate(0, -0.05, 0);
    geos.push(plain);
    // dunes: a ring whose height rises with distance
    const dunes = new THREE.RingGeometry(150, 440, 96, 6);
    dunes.rotateX(-Math.PI / 2);
    const dp = dunes.attributes.position;
    for (let i = 0; i < dp.count; i++) {
      const x = dp.getX(i), z = dp.getZ(i), d = Math.hypot(x, z), a = Math.atan2(z, x);
      const hgt = Math.max(0, (d - 150) / 290) * (14 + 10 * Math.sin(a * 5 + 1.3) + 7 * Math.sin(a * 13 + 0.4) + 4 * Math.sin(a * 29));
      dp.setY(i, hgt);
    }
    dunes.computeVertexNormals();
    G.Gfx.paint(dunes, lin(0xd0ac78), 1, 0);
    geos.push(dunes);
    // houses beyond the edge of the playable town
    const box = (x, z, w, d, h, c) => {
      const g = new THREE.BoxGeometry(w, h, d);
      g.translate(x, h / 2, z);
      G.Gfx.paint(g, c, 0.95, 0);
      geos.push(g);
    };
    const tints = [0xd9c39a, 0xcfb48a, 0xe2d2b0, 0xc9a77c, 0xd6bea0];
    for (let i = 0; i < 260; i++) {
      const a = r() * Math.PI * 2, d = 58 + Math.pow(r(), 1.4) * 70;
      const x = Math.cos(a) * d, z = Math.sin(a) * d;
      if (Math.abs(x) < 56 && Math.abs(z) < 56) continue;
      const w = 5 + r() * 9, dd = 5 + r() * 9, h = 4 + r() * 6;
      box(x, z, w, dd, h, lin(tints[Math.floor(r() * tints.length)]));
      if (r() < 0.25) box(x + (r() - 0.5) * w * 0.5, z + (r() - 0.5) * dd * 0.5, w * 0.4, dd * 0.4, h + 1.5 + r() * 2, lin(tints[Math.floor(r() * tints.length)]));
    }
    // Eroded mesas: flat cap rock above sloping scree, with an irregular silhouette.
    for (let i=0;i<28;i++) {
      const a=i*.73, dist=165+r()*88, x=Math.cos(a)*dist, z=Math.sin(a)*dist;
      const w=9+r()*17, h=9+r()*13, rock=new THREE.CylinderGeometry(w*.61,w,h,9,2);
      rock.scale(1,1,.65); rock.rotateY(a); rock.translate(x,h*.47,z);
      G.Gfx.paint(rock,lin(0xa88669),1,0); geos.push(rock);
      const cap=new THREE.CylinderGeometry(w*.54,w*.62,h*.18,9);
      cap.scale(1,1,.65); cap.rotateY(a); cap.translate(x,h*1.05,z);
      G.Gfx.paint(cap,lin(0x91765e),.94,0); geos.push(cap);
    }
    // a water tower and a radio mast break the skyline
    box(-78, 64, 1.2, 1.2, 16, lin(0x7a7266)); box(-78, 64, 7, 7, 4, lin(0x9aa4a8)); geos[geos.length - 1].translate(0, 16, 0);
    box(92, -70, 0.8, 0.8, 34, lin(0x8a2a22));
    const m = new THREE.Mesh(G.Gfx.merge(geos), MM.distantMat = G.Gfx.litMaterial({}));
    m.matrixAutoUpdate = false;
    m.renderOrder = 5;   // after the town, so its hidden parts fail the depth test early
    root.add(m);
  }
})(window.G);
