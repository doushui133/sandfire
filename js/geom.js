// geom.js — small procedural modelling kit used by the guns and the soldiers: primitives with
// per-vertex colour and surface values (roughness, metalness, two extra channels), placed with
// position / rotation, merged into one geometry per object.
(function (G) {
  'use strict';
  const THREE = G.THREE;
  const K = G.Geo = {};
  const m4 = new THREE.Matrix4(), eul = new THREE.Euler(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p3 = new THREE.Vector3();
  K.lin = (hex) => [Math.pow(((hex >> 16) & 255) / 255, 2.2), Math.pow(((hex >> 8) & 255) / 255, 2.2), Math.pow((hex & 255) / 255, 2.2)];

  // surface: { c: [r,g,b] linear or hex, r: roughness, m: metalness, z, w: extra channels }
  K.paint = function (geo, s) {
    const c = typeof s.c === 'number' ? K.lin(s.c) : s.c;
    return G.Gfx.paint(geo, c, s.r === undefined ? 0.6 : s.r, s.m || 0, s.z || 0, s.w || 0);
  };
  // place a geometry: position, Euler rotation (radians, XYZ), optional scale
  K.at = function (geo, x, y, z, rx, ry, rz, sx, sy, sz) {
    eul.set(rx || 0, ry || 0, rz || 0);
    q.setFromEuler(eul);
    m4.compose(p3.set(x || 0, y || 0, z || 0), q, sx ? new THREE.Vector3(sx, sy === undefined ? sx : sy, sz === undefined ? sx : sz) : one);
    geo.applyMatrix4(m4);
    return geo;
  };
  K.box = (w, h, d) => new THREE.BoxGeometry(w, h, d);
  // box with rounded edges (radius r)
  K.rbox = function (w, h, d, r, seg) {
    seg = seg || 2;
    const g = new THREE.BoxGeometry(w, h, d, seg * 2, seg * 2, seg * 2);
    const pos = g.attributes.position, nrm = g.attributes.normal, hw = w / 2 - r, hh = h / 2 - r, hd = d / 2 - r, v = new THREE.Vector3(), n = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i);
      const ix = G.clamp(v.x, -hw, hw), iy = G.clamp(v.y, -hh, hh), iz = G.clamp(v.z, -hd, hd);
      n.set(v.x - ix, v.y - iy, v.z - iz);
      if (n.lengthSq() < 1e-12) n.fromBufferAttribute(nrm, i); else n.normalize();
      pos.setXYZ(i, ix + n.x * r, iy + n.y * r, iz + n.z * r);
      nrm.setXYZ(i, n.x, n.y, n.z);
    }
    return g;
  };
  // cylinder along an axis ('x', 'y' or 'z'), centred
  K.cyl = function (r0, r1, len, seg, axis, open) {
    const g = new THREE.CylinderGeometry(r1, r0, len, seg || 12, 1, !!open);
    if (axis === 'z') g.rotateX(-Math.PI / 2); else if (axis === 'x') g.rotateZ(-Math.PI / 2);
    return g;
  };
  K.sphere = (rx, ry, rz, ws, hs) => { const g = new THREE.SphereGeometry(1, ws || 14, hs || 10); g.scale(rx, ry, rz); return g; };
  K.torus = (R, r, seg, tseg, arc) => new THREE.TorusGeometry(R, r, seg || 6, tseg || 16, arc || Math.PI * 2);
  // side profile in the (z, y) plane, extruded across x and centred; pts: [[z, y], ...]; holes likewise
  K.profile = function (pts, width, bevel, holes, curveSeg) {
    const shape = new THREE.Shape(pts.map(([z, y]) => new THREE.Vector2(z, y)));
    (holes || []).forEach((h) => shape.holes.push(new THREE.Path(h.map(([z, y]) => new THREE.Vector2(z, y)))));
    const b = bevel === undefined ? Math.min(0.004, width * 0.2) : bevel;
    const g = new THREE.ExtrudeGeometry(shape, { depth: Math.max(0.0005, width - 2 * b), bevelEnabled: b > 0, bevelThickness: b, bevelSize: b, bevelSegments: 1, curveSegments: curveSeg || 6 });
    g.translate(0, 0, -(width - 2 * b) / 2);
    g.rotateY(Math.PI / 2);   // shape x → -z ... fix below so +z of the shape maps to world z
    g.scale(1, 1, -1);
    // the mirror flips winding; flip triangles back so faces point outward
    const idx = g.index;
    if (idx) { for (let i = 0; i < idx.count; i += 3) { const a = idx.getX(i + 1); idx.setX(i + 1, idx.getX(i + 2)); idx.setX(i + 2, a); } }
    else {
      const pos = g.attributes.position, nrm = g.attributes.normal, uv = g.attributes.uv;
      for (let i = 0; i < pos.count; i += 3) for (const at of [pos, nrm, uv]) {
        const s = at.itemSize;
        for (let k = 0; k < s; k++) { const a = at.array[(i + 1) * s + k]; at.array[(i + 1) * s + k] = at.array[(i + 2) * s + k]; at.array[(i + 2) * s + k] = a; }
      }
    }
    g.computeVertexNormals();
    return g;
  };
  // tube through points with radii (number or per-point [rx, rz]); ends capped.
  // `upv` orients the cross-section (rx lies along tangent × upv)
  K.tube = function (pts, radii, seg, upv) {
    seg = seg || 10;
    const P = [], N = [], UV = [], I = [];
    const up = upv || new THREE.Vector3(0, 0, 1);
    const n = pts.length;
    const rings = [];
    for (let i = 0; i < n; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(n - 1, i + 1)];
      const t = new THREE.Vector3().subVectors(b, a).normalize();
      let side = new THREE.Vector3().crossVectors(t, up);
      if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
      side.normalize();
      const fw = new THREE.Vector3().crossVectors(side, t).normalize();
      const r = radii[i], rx = Array.isArray(r) ? r[0] : r, rz = Array.isArray(r) ? r[1] : r;
      rings.push({ c: pts[i], side, fw, rx, rz });
    }
    rings.forEach((R, i) => {
      for (let k = 0; k <= seg; k++) {
        const ang = k / seg * Math.PI * 2, cs = Math.cos(ang), sn = Math.sin(ang);
        const nx = R.side.x * cs + R.fw.x * sn, ny = R.side.y * cs + R.fw.y * sn, nz = R.side.z * cs + R.fw.z * sn;
        P.push(R.c.x + R.side.x * cs * R.rx + R.fw.x * sn * R.rz, R.c.y + R.side.y * cs * R.rx + R.fw.y * sn * R.rz, R.c.z + R.side.z * cs * R.rx + R.fw.z * sn * R.rz);
        N.push(nx, ny, nz); UV.push(k / seg, i / (n - 1));
      }
    });
    for (let i = 0; i < n - 1; i++) for (let k = 0; k < seg; k++) {
      const a = i * (seg + 1) + k, b = a + seg + 1;
      I.push(a, b, a + 1, b, b + 1, a + 1);
    }
    // caps
    [[0, -1], [n - 1, 1]].forEach(([ri, dir]) => {
      const R = rings[ri], base = P.length / 3, tt = new THREE.Vector3().subVectors(pts[Math.min(n - 1, ri + (dir > 0 ? 0 : 1))], pts[Math.max(0, ri - (dir > 0 ? 1 : 0))]).normalize().multiplyScalar(dir);
      P.push(R.c.x, R.c.y, R.c.z); N.push(tt.x, tt.y, tt.z); UV.push(0.5, 0.5);
      for (let k = 0; k <= seg; k++) {
        const ang = k / seg * Math.PI * 2, cs = Math.cos(ang), sn = Math.sin(ang);
        P.push(R.c.x + R.side.x * cs * R.rx + R.fw.x * sn * R.rz, R.c.y + R.side.y * cs * R.rx + R.fw.y * sn * R.rz, R.c.z + R.side.z * cs * R.rx + R.fw.z * sn * R.rz);
        N.push(tt.x, tt.y, tt.z); UV.push(0.5 + cs * 0.5, 0.5 + sn * 0.5);
      }
      for (let k = 0; k < seg; k++) { if (dir > 0) I.push(base, base + 2 + k, base + 1 + k); else I.push(base, base + 1 + k, base + 2 + k); }
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(N, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(UV, 2));
    g.setIndex(I);
    return g;
  };
  K.lathe = function (prof, seg) { return new THREE.LatheGeometry(prof.map(([r, y]) => new THREE.Vector2(r, y)), seg || 16); };
  // collects painted parts, merges them
  K.Builder = function () { this.parts = []; };
  K.Builder.prototype.add = function (geo, surf) { this.parts.push(K.paint(geo.index ? geo : geo, surf)); return geo; };
  K.Builder.prototype.build = function () {
    // drop attributes that not every part has
    const keep = ['position', 'normal', 'uv', 'color', 'rm', 'skinIndex', 'skinWeight'].filter((k) => this.parts.every((p) => p.attributes[k]));
    this.parts.forEach((p) => { for (const k in p.attributes) if (!keep.includes(k)) p.deleteAttribute(k); });
    const g = G.Gfx.merge(this.parts);
    this.parts.forEach((p) => p.dispose());
    return g;
  };
})(window.G);
