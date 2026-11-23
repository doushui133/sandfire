// nades.js — inventory actions, fixed-step projectile flight and persistent area effects.
(function (G) {
  'use strict';
  const T = G.THREE, M = G.Map, W = G.Weapons;
  const N = G.Nades = { flying:[], smokes:[], fires:[] };
  const STEP = 1/90, R = 0.065, eye = new T.Vector3(), direction = new T.Vector3(), point = new T.Vector3();
  const trial = { pos:new T.Vector3(), vel:new T.Vector3() }, meshes = {};
  const overlay = document.getElementById('gasView'), white = document.getElementById('flashView');
  let dots, landing, previewAt = 0;
  const speeds = [0, 18, 6.5, 12], chargeTime = 0.65, minPower = 0.45;

  // Sweep the centre against radius-expanded map boxes. Keep the first contact, even when
  // the whole box fits between two steps. The map's shared query array is consumed immediately.
  const axes = ['x','y','z'], low = ['x0','y0','z0'], high = ['x1','y1','z1'];
  N.step = function (g) {
    if (g.rest) return;
    const p = g.pos, v = g.vel;
    v.y -= 14 * STEP;
    let remaining = STEP;
    for (let impact = 0; impact < 4 && remaining > 1e-7; impact++) {
      let first = remaining, axis = -1, sign = 0;
      if (v.y < 0 && p.y + v.y * remaining <= R) {
        first = Math.max(0, (R - p.y) / v.y); axis = 1; sign = 1;
      }
      const x = p.x + v.x * remaining, z = p.z + v.z * remaining;
      const list = M.query(Math.min(x,p.x)-R,Math.min(z,p.z)-R,Math.max(x,p.x)+R,Math.max(z,p.z)+R);
      for (let i = 0; i < list.length; i++) {
        const b = list[i];
        let near = -Infinity, far = first, kNear = -1, normal = 0;
        for (let k = 0; k < 3; k++) {
          const o = p[axes[k]], d = v[axes[k]], lo = b[low[k]]-R, hi = b[high[k]]+R;
          if (Math.abs(d) < 1e-9) { if (o <= lo || o >= hi) { far = -Infinity; break; } continue; }
          const a = (lo-o)/d, c = (hi-o)/d, enter = Math.min(a,c);
          if (enter > near) { near = enter; kNear = k; normal = d > 0 ? -1 : 1; }
          far = Math.min(far, Math.max(a,c));
        }
        if (near >= -1e-8 && near <= far && near <= first) { first = Math.max(0,near); axis = kNear; sign = normal; }
      }
      p.addScaledVector(v, first);
      if (axis < 0) break;
      p[axes[axis]] += sign * 0.0001;
      v[axes[axis]] *= -0.42;
      if (axis === 1 && sign === 1) {
        g.groundHit = true;
        v.x *= 0.78; v.z *= 0.78;
        if (Math.abs(v.y) < 0.42) v.y = 0;
        if (v.lengthSq() < 0.13) { v.set(0,0,0); g.rest = true; break; }
      } else v.multiplyScalar(0.89);
      remaining -= first;
    }
  };
  function fuse(id) { return id === 'he' || id === 'flash' ? 1.6 : 2; }
  function bursts(g) {
    return g.age >= fuse(g.id) || (g.id === 'smoke' && g.rest) ||
      ((g.id === 'molotov' || g.id === 'incendiary') && g.groundHit);
  }
  function aim(a, strength, out) {
    G.eyePos(a,out.pos);
    G.forward(a.yaw, G.clamp(a.pitch+0.14,-1.5,1.55), out.vel).multiplyScalar(strength).add(a.vel);
    out.age = 0; out.rest = out.groundHit = false;
  }
  function launch(id, owner, pos, vel) {
    const pool = meshes[id] || (meshes[id] = []);
    const m = pool.pop() || W.makeGunMesh(id);
    m.position.copy(pos); m.rotation.set(0,0,0); G.scene.add(m);
    const g = { id, owner, pos:m.position, vel:vel.clone(), age:0, acc:0, rest:false, groundHit:false, mesh:m };
    N.flying.push(g);
    if (owner && G.BotModel.gesture) G.BotModel.gesture(owner, 'throw');
    G.Audio.grenade('throw', pos);
    return g;
  }
  N.throw = function (a,id,pos,vel) {
    if (G.time < a.throwReady || !a.nades[id]) return false;
    const mode = a.primed;
    launch(id,a,pos,vel); W.takeGrenade(a,id);
    a.throwReady = G.time + 0.72;
    if (a.isPlayer) G.VM.onThrow(id, mode);
    return true;
  };
  function preview(a, speed) {
    if (!dots) {
      const geo = new T.BufferGeometry();
      geo.setAttribute('position', new T.Float32BufferAttribute(new Float32Array(76*3),3));
      dots = new T.Points(geo,new T.PointsMaterial({ color:0xffdf92, size:0.06 }));
      dots.frustumCulled = false; G.scene.add(dots);
      dots.visible = false;
      landing = new T.Mesh(new T.SphereGeometry(0.085,8,6), new T.MeshBasicMaterial({ color:0xffdf92 }));
      G.scene.add(landing);
    }
    if (dots.visible && previewAt > G.time) return;
    previewAt = G.time + 1/24;
    aim(a,speed,trial); trial.id = a.inv.grenade.id;
    const attr = dots.geometry.attributes.position;
    const sx = trial.pos.x, sy = trial.pos.y, sz = trial.pos.z;
    let n = 0;
    for (let i=0; i<225; i++) {
      N.step(trial); trial.age += STEP;
      // dots are size-attenuated squares: the first ones, right at the eye, would cover the screen
      const near = (trial.pos.x-sx)**2 + (trial.pos.y-sy)**2 + (trial.pos.z-sz)**2 < 4;
      if ((i%3 === 0 && !near) || bursts(trial)) attr.setXYZ(n++,trial.pos.x,trial.pos.y,trial.pos.z);
      if (bursts(trial)) break;
    }
    attr.needsUpdate = true; dots.geometry.setDrawRange(0,n); dots.visible = true;
    landing.position.copy(trial.pos); landing.visible = true;
  }
  function clearCharge(a, latch) {
    a.primed = a.chargeAt = a.throwPower = a.pendingThrow = 0;
    a.throwLatch = latch;
    if (a.isPlayer && dots) dots.visible = landing.visible = false;
  }
  N.cancel = function (a, blockHeld = true) {
    if (!a) return;
    const inp = G.input;
    clearCharge(a, blockHeld && a.isPlayer && (inp.left || inp.right || inp.leftPressed || inp.rightPressed));
    if (wheel.agent === a) closeWheel();
  };
  N.control = function (a, ctl) {
    if (!a.isPlayer) return;
    if (!a.alive || G.paused || G.Game.frozen || G.HUD.buyOpen || a.planting || a.defusing || ctl.blocked) {
      clearCharge(a, G.input.left || G.input.right);
      return;
    }
    const held = (ctl.fire ? 1 : 0) | (ctl.alt ? 2 : 0);
    const pressed = (ctl.firePressed ? 1 : 0) | (ctl.altPressed ? 2 : 0);
    if (a.throwLatch) {
      if (!held) a.throwLatch = false;
      return;
    }
    if (G.time < a.switchEnd) {
      if (pressed) a.pendingThrow = held | pressed;
      return;
    }
    if (G.time < a.throwReady) return;
    if (!a.primed) {
      a.primed = (held | pressed) || a.pendingThrow || 0;
      a.pendingThrow = 0;
      if (!a.primed) return;
      a.chargeAt = G.time;
      G.Audio.click('reload1');
    }
    if ((a.primed & held) === a.primed) a.primed = held;
    const remaining = 1 - G.clamp((G.time - a.chargeAt) / chargeTime, 0, 1);
    a.throwPower = 1 - (1 - minPower) * remaining * remaining;
    const speed = speeds[a.primed] * a.throwPower;
    if ((a.primed & held) === a.primed) { preview(a,speed); return; }
    aim(a,speed,trial); N.throw(a,a.inv.grenade.id,trial.pos,trial.vel);
    clearCharge(a, !!held);
  };

  const wheel = N.wheel = { agent:null, open:false, options:null, index:-1, x:0, y:0 };
  const cursor = { x:0, y:0, seen:false };
  let wheelAt = 0, wheelX = 0, wheelY = 0, cursorX = 0, cursorY = 0;
  function closeWheel() {
    wheel.agent = null; wheel.open = false; wheel.options = null; wheel.index = -1;
  }
  window.addEventListener('mousemove', (e) => {
    if (G.input.locked || !G.input.active || G.Touch.enabled) return;
    cursor.x = e.clientX; cursor.y = e.clientY; cursor.seen = true;
  });
  window.addEventListener('blur', () => {
    cursor.seen = false;
    if (G.Player) N.cancel(G.Player.agent);
  });
  N.updateWheel = function (a, inp, blocked) {
    if (blocked || G.Touch.enabled) { closeWheel(); return false; }
    if (inp.hit('Digit4')) {
      if (!inp.down('Digit4')) { W.switchTo(a, 'grenade'); return false; }
      if (!a.inv.grenade) return false;
      wheel.agent = a; wheelAt = G.now() + 250;
    }
    if (wheel.agent !== a) return false;
    if (!wheel.open) {
      if (!inp.down('Digit4')) { closeWheel(); W.switchTo(a, 'grenade'); return false; }
      if (G.now() < wheelAt) return false;
      if (!a.inv.grenade) { closeWheel(); return false; }
      wheel.open = true; wheel.options = W.grenadeList(a);
      wheelX = wheelY = 0;
      cursorX = !inp.locked && cursor.seen ? cursor.x : window.innerWidth / 2;
      cursorY = !inp.locked && cursor.seen ? cursor.y : window.innerHeight / 2;
      wheel.x = G.clamp(cursorX, 123, Math.max(123, window.innerWidth - 123));
      wheel.y = G.clamp(cursorY, 123, Math.max(123, window.innerHeight - 123));
      clearCharge(a, G.input.left || G.input.right);
      return true;
    }
    if (inp.locked) {
      wheelX += inp.dx; wheelY += inp.dy;
      const length = Math.hypot(wheelX, wheelY);
      if (length > 95) { wheelX *= 95 / length; wheelY *= 95 / length; }
    } else if (cursor.seen && (cursor.x !== cursorX || cursor.y !== cursorY)) {
      wheelX = cursor.x - wheel.x; wheelY = cursor.y - wheel.y;
      cursorX = cursor.x; cursorY = cursor.y;
    }
    if (Math.hypot(wheelX, wheelY) < 14) wheel.index = -1;
    else {
      const count = wheel.options.length;
      wheel.index = (Math.round(Math.atan2(wheelX, -wheelY) * count / (2 * Math.PI)) + count) % count;
    }
    if (!inp.down('Digit4')) {
      const choice = wheel.options[wheel.index];
      closeWheel();
      if (choice) W.selectGrenade(a, choice.id);
    }
    return true;
  };

  N.blocks = function (a,b) {
    const dx=b.x-a.x, dy=b.y-a.y, dz=b.z-a.z, len=dx*dx+dy*dy+dz*dz;
    for (const s of N.smokes) {
      const x=s.pos.x-a.x, y=s.pos.y-a.y, z=s.pos.z-a.z;
      const t=len ? G.clamp((x*dx+y*dy+z*dz)/len,0,1) : 0;
      if ((x-t*dx)**2+(y-t*dy)**2+(z-t*dz)**2 < s.radius*s.radius) return true;
    }
    return false;
  };
  N.visible = (a,b) => !N.blocks(a,b) && M.clearLine(a,b);
  function areaDamage(a,g,damage) {
    if (damage >= 1) G.Game.damage(a,g.owner,Math.round(damage),{ weapon:g.id, from:g.pos, area:true });
  }
  function ignite(g) {
    const p = g.pos.clone();
    const ground = M.raycast(p.x,p.y+0.01,p.z,0,-1,0,40);
    if (!ground) return;
    p.y = ground.y + 0.09;
    const cells = [];
    for (let x=-3; x<=3; x++) for (let z=-3; z<=3; z++) {
      const d = Math.hypot(x,z);
      if (d>3.6) continue;
      const c = point.set(p.x+x,p.y,p.z+z);
      if (!M.walkable(M.colOf(c.x),M.rowOf(c.z)) || !M.clearLine(p,c)) continue;
      const h = M.raycast(c.x,c.y+0.38,c.z,0,-1,0,1.3);
      if (!h) continue;
      c.y=h.y+0.09;
      if (M.clearLine(p,c) && !N.blocks(c,c)) cells.push({ pos:c.clone(), delay:d/3.6 });
    }
    if (!cells.length) return;
    N.fires.push({ id:g.id,owner:g.owner,pos:p,cells,age:0,tick:0,visual:0,stop:G.Audio.fireLoop(p),scorch:G.FX.scorch(p) });
  }
  function burst(g) {
    const p = g.pos;
    G.Audio.grenade(g.id,p);
    if (g.id === 'smoke') {
      const center = p.clone(); center.y += 0.65;
      N.smokes.push({ pos:center, radius:0.18, age:0, cloud:G.FX.cloud(center) }); return;
    }
    if (g.id === 'molotov' || g.id === 'incendiary') { ignite(g); return; }
    if (g.id === 'he') G.FX.explosion(p,true);
    for (const a of G.Game.agents) {
      if (!a.alive) continue;
      G.eyePos(a,eye);
      if (g.id === 'he') eye.y -= 0.6;
      const dist = eye.distanceTo(p);
      if (g.id === 'he') {
        if (dist < 8.5 && M.clearLine(p,eye)) areaDamage(a,g,98*(1-dist/8.5)*(a.armor ? 0.5 : 1));
      } else if (dist < 26 && N.visible(eye,p)) {
        const facing = G.forward(a.yaw,a.pitch,direction).dot(point.copy(p).sub(eye).normalize());
        const duration = 4.5*(1-dist/26)*(0.12+0.88*Math.max(0,(facing+0.1)/1.1));
        a.blindUntil = Math.max(a.blindUntil || 0,G.time+duration);
        if (a.isPlayer) { G.Audio.ring(a.blindUntil-G.time); if (G.FX.flashGhost) G.FX.flashGhost(a.blindUntil-G.time); }
      }
    }
  }
  const foot = new T.Vector3();
  N.hot = function (pos) {
    for (const f of N.fires) {
      if (G.dist2D(f.pos,pos)>4.6) continue;
      for (const c of f.cells) {
        if (f.age>=c.delay && Math.abs(pos.y-c.pos.y)<1.6 && G.dist2D(pos,c.pos)<0.86 &&
            M.clearLine(c.pos,foot.set(pos.x,pos.y+.12,pos.z))) return f;
      }
    }
    return null;
  };
  function recycle(g) { G.scene.remove(g.mesh); meshes[g.id].push(g.mesh); }
  N.clear = function () {
    for (const g of N.flying) recycle(g);
    for (const s of N.smokes) G.FX.recycleCloud(s.cloud);
    for (const f of N.fires) { if (f.stop) f.stop(); if (f.scorch && G.FX.fadeScorch) G.FX.fadeScorch(f.scorch); }
    N.flying.length = N.smokes.length = N.fires.length = 0;
    N.cancel(G.Player.agent, false);
    overlay.hidden = white.hidden = true;
  };
  N.update = function (dt) {
    for (let i=N.flying.length-1; i>=0; i--) {
      const g=N.flying[i]; g.acc+=dt;
      while (g.acc+1e-9>=STEP) {
        N.step(g); g.acc-=STEP; g.age+=STEP;
        if (bursts(g)) { burst(g); recycle(g); N.flying.splice(i,1); break; }
        if (!g.rest) g.mesh.rotation.x+=STEP*5;
      }
    }
    for (let i=N.smokes.length-1; i>=0; i--) {
      const s=N.smokes[i]; s.age+=dt;
      if (s.age>=19) { G.FX.recycleCloud(s.cloud); N.smokes.splice(i,1); continue; }
      s.radius=5.5*Math.min(1,0.04+s.age,19-s.age);
      G.FX.sizeCloud(s.cloud,s.radius,s.age);
    }
    for (let i=N.fires.length-1; i>=0; i--) {
      const f=N.fires[i]; f.age+=dt; f.tick-=dt; f.visual-=dt;
      for (let j=f.cells.length-1; j>=0; j--) if (N.blocks(f.cells[j].pos,f.cells[j].pos)) f.cells.splice(j,1);
      if (!f.cells.length || f.age>=7) { if (f.stop) f.stop(); if (f.scorch) G.FX.fadeScorch(f.scorch); N.fires.splice(i,1); continue; }
      if (f.tick<=0) {
        f.tick+=0.2;
        for (const a of G.Game.agents) if (a.alive && N.hot(a.pos)===f) areaDamage(a,f,6);
      }
      if (f.visual<=0) { f.visual=0.17; G.FX.flames(f); }
    }
  };
  N.updateView = function () {
    const p=G.Player.agent, cam=G.camera;
    const view=p && !p.alive ? G.Player.spectateTarget() : p;
    // Depth-tested puffs alone can reveal a soldier standing in the front half of a cloud.
    if (N.smokes.length) for (const a of G.Game.agents) {
      if (!a.rig || !a.rig.root.visible) continue;
      if (N.blocks(cam.position,G.eyePos(a,eye)) && N.blocks(cam.position,point.set(a.pos.x,a.pos.y+.45,a.pos.z))) {
        a.rig.root.visible=false; if (a.tagSprite) a.tagSprite.visible=false;
      }
    }
    const outside = !N.blocks(cam.position,cam.position);
    if (overlay.hidden !== outside) overlay.hidden=outside;
    const blind=view ? G.clamp((view.blindUntil-G.time)/0.85,0,1) : 0;
    if (white.hidden !== !blind) white.hidden=!blind;
    if (blind && white.style.opacity !== blind.toFixed(2)) white.style.opacity=blind.toFixed(2);
  };
  G.debugGive = function (id,count) {
    const a=G.Player.agent, d=W.defs[id];
    if (!a || !d) return false;
    if (d.slot==='grenade') {
      let given=0;
      while (given<(count===undefined ? 1 : count) && W.addGrenade(a,id)) given++;
      if (given) W.selectGrenade(a,id);
      return given;
    }
    a.inv[d.slot]=W.item(id); W.switchTo(a,d.slot); return true;
  };
  G.debugThrow = function (id, options) {
    if (!W.grenades.includes(id)) return null;
    const a=G.Player.agent, o=options || {};
    const pos=o.pos || G.eyePos(a,eye), dir=o.dir || G.forward(a.yaw,a.pitch,direction);
    return launch(id,a,pos,point.copy(dir).normalize().multiplyScalar(o.speed===undefined ? 18 : o.speed));
  };
  G.debugView = function (x,y,z,yaw,pitch) {
    const a=G.Player.agent;
    a.pos.set(x,y,z); a.vel.set(0,0,0); a.yaw=yaw; a.pitch=pitch;
    G.eyePos(a,G.camera.position); G.Player.camY=G.camera.position.y;
    G.camera.rotation.set(pitch,yaw,0,'YXZ');
  };
})(window.G);
