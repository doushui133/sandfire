// hud.js — on-screen readouts, radar, kill feed, buy menu, scoreboard and round banners
(function (G) {
  'use strict';
  const W = G.Weapons, M = G.Map;
  const H = G.HUD = { buyOpen: false, scoresOpen: false };
  const $ = (id) => document.getElementById(id);
  let el, rctx, msgTimer = 0, vign = 0, buyRefresh = 0, sbRefresh = 0, moneyT = 0, lastHint = '';
  const TEAM = { atk: '进攻方', def: '防守方' };

  H.init = function () {
    el = {};
    ['hud', 'radar', 'scoreAtk', 'scoreDef', 'timer', 'aliveAtk', 'aliveDef', 'killfeed', 'hp', 'armor', 'armorIco', 'money', 'moneyDelta', 'clip', 'reserve', 'slots',
      'crosshair', 'chL', 'chR', 'chT', 'chB', 'hitmarker', 'scope', 'centerMsg', 'msgTitle', 'msgSub', 'progress', 'progressBar', 'progressLabel', 'hint', 'vignette',
      'dmgdir', 'death', 'buyHint', 'buymenu', 'scoreboard', 'endScreen', 'endTitle', 'endSub', 'ammo', 'vcursor', 'edgeL', 'edgeR'].forEach((k) => (el[k] = $(k)));
    rctx = el.radar.getContext('2d');
    let pips = '';
    for (let i = 0; i < 5; i++) pips += '<i></i>';
    el.aliveAtk.innerHTML = pips; el.aliveDef.innerHTML = pips;
    el.buymenu.addEventListener('click', (e) => {
      const b = e.target.closest('[data-buy]');
      if (b) buy(b.dataset.buy);
      if (e.target.closest('[data-close]')) H.toggleBuy(false);
    });
    el.scoreboard.addEventListener('click', (e) => {
      if (e.target.closest('[data-close-scores]')) H.showScores(false);
    });
    window.addEventListener('keydown', (e) => {
      if (!H.buyOpen || G.Touch.enabled) return;
      const n = parseInt(e.key, 10);
      if (n >= 1 && n <= 9) { const list = buyList(); if (list[n - 1]) buy(list[n - 1].id); }
    });
  };

  // ---------- messages ----------
  H.message = function (title, sub, dur) {
    el.msgTitle.textContent = title || ''; el.msgSub.textContent = sub || '';
    el.centerMsg.hidden = !title && !sub;
    msgTimer = dur || 0;
    el.msgTitle.style.color = '';
  };
  H.roundStart = function (round, hasBomb) {
    if (G.Touch.enabled) G.Touch.reset();
    const p = G.Player.agent;
    const sub = hasBomb ? '你携带炸弹 · 前往 A 点或 B 点安放' : p.team === 'atk' ? '进攻：掩护队友安放炸弹' : '防守：守住 A、B 两个包点';
    H.message('第 ' + round + ' 回合', sub, G.Game.CFG.freeze);
    el.death.hidden = true;
  };
  H.roundEnd = function (winner, reason) {
    const mine = G.Player.agent.team === winner, loser = winner === 'atk' ? 'def' : 'atk';
    const why = { elim: TEAM[loser] + '已被全部消灭', bomb: '炸弹已爆炸', defuse: '炸弹已被拆除', time: '时间耗尽，炸弹未能安放' }[reason];
    H.message((mine ? '我方获胜 · ' : '敌方获胜 · ') + TEAM[winner], why, G.Game.CFG.endDelay);
    el.msgTitle.style.color = winner === 'atk' ? 'var(--atk)' : 'var(--def)';
    H.toggleBuy(false);
  };
  H.matchOver = function (winner) {
    const p = G.Player.agent, s = G.Game.score;
    el.endTitle.textContent = p.team === winner ? '胜利' : '失败';
    el.endTitle.style.color = p.team === winner ? 'var(--ok)' : 'var(--danger)';
    el.endSub.textContent = '比分 ' + s.atk + ' : ' + s.def + ' · 你的战绩 ' + p.kills + ' 杀 / ' + p.deaths + ' 死';
    el.endScreen.hidden = false;
    G.input.active = false;
    if (G.Touch.enabled) { H.showScores(false); G.Touch.sync(); }
    G.releaseLock();
  };
  H.moneyDelta = function (v) { el.moneyDelta.textContent = '+$' + v; moneyT = 3; };
  H.hitmarker = function (head) {
    el.hitmarker.classList.toggle('hs', !!head);
    el.hitmarker.style.transition = 'none'; el.hitmarker.style.opacity = 1;
    requestAnimationFrame(() => { el.hitmarker.style.transition = ''; el.hitmarker.style.opacity = 0; });
  };
  H.hurt = function (from, dmg) {
    vign = Math.min(0.95, vign + 0.25 + dmg / 70);
    if (!from) return;
    const p = G.Player.agent, rel = G.wrapAngle(G.yawTo(from.x - p.pos.x, from.z - p.pos.z) - p.yaw);
    const i = document.createElement('i');
    i.style.transform = 'rotate(' + (-rel * 180 / Math.PI) + 'deg)';
    i.style.transition = 'opacity 1.2s ease-in';
    el.dmgdir.appendChild(i);
    requestAnimationFrame(() => requestAnimationFrame(() => (i.style.opacity = 0)));
    setTimeout(() => i.remove(), 1300);
  };
  H.killfeed = function (k, v, wname, head) {
    const p = G.Player.agent, d = document.createElement('div');
    d.className = 'kf' + (k === p || v === p ? ' me' : '');
    const nm = (a) => '<span class="t-' + a.team + '">' + a.name + '</span>';
    d.innerHTML = (k && k !== v ? nm(k) : '') + '<span class="w">' + wname + '</span>' + (head ? '<span class="hs">爆头</span>' : '') + nm(v);
    el.killfeed.appendChild(d);
    while (el.killfeed.children.length > 5) el.killfeed.firstChild.remove();
    setTimeout(() => d.remove(), 7000);
  };
  H.died = function (k, wname, head) {
    if (G.Touch.enabled) G.Touch.reset();
    el.death.innerHTML = (k ? '你被 <b class="t-' + k.team + '">' + k.name + '</b> 用 ' + wname + ' 击杀' + (head ? '（爆头）' : '') : '你阵亡了') +
      '<small id="specName">' + (G.Touch.enabled ? '轻点右侧切换观察队友' : '左键切换观察队友') + '</small>';
    el.death.hidden = false;
    H.toggleBuy(false);
  };
  H.spectating = function (t) {
    const s = $('specName'), txt = t ? '正在观察：' + t.name + (G.Touch.enabled ? ' · 轻点右侧切换' : ' · 左键切换') : '';
    if (s && s.textContent !== txt) s.textContent = txt;
  };
  // glow on the screen edge while the fallback cursor turns the view
  H.edge = function (e) {
    const l = e < 0 ? (-e).toFixed(2) : '0', r = e > 0 ? e.toFixed(2) : '0';
    if (el.edgeL.style.opacity !== l) el.edgeL.style.opacity = l;
    if (el.edgeR.style.opacity !== r) el.edgeR.style.opacity = r;
  };

  // ---------- buy menu ----------
  function buyList() {
    const p = G.Player.agent, rifle = p.team === 'atk' ? 'ar7' : 'tr4';
    const list = [
      { id: 'p10', cat: '手枪' }, { id: 'h50', cat: '手枪' }, { id: 'v9', cat: '冲锋枪' }, { id: rifle, cat: '步枪' }, { id: 'r90', cat: '步枪' },
      { id: 'vest', cat: '装备' }, { id: 'vesthelm', cat: '装备' },
    ];
    if (p.team === 'def') list.push({ id: 'kit', cat: '装备' });
    return list;
  }
  function buy(id) {
    const p = G.Player.agent;
    if (!G.Game.buy(p, id)) G.Audio.click('deny');
    renderBuy();
  }
  function renderBuy() {
    const p = G.Player.agent, list = buyList();
    const cats = {};
    list.forEach((it, i) => { (cats[it.cat] = cats[it.cat] || []).push(Object.assign({ n: i + 1 }, it)); });
    const touch = G.Touch.enabled;
    let html = '<div class="slab"><div class="bm-head"><h2>购买装备</h2><span class="num" style="font-size:22px;color:var(--ok)">$' + p.money + '</span>' +
      (touch ? '<button data-close>关闭</button>' : '') + '</div><div class="bm-grid">';
    for (const c in cats) {
      html += '<div class="bm-col"><h3>' + c + '</h3>';
      for (const it of cats[c]) {
        const d = W.defs[it.id] || W.equipment[it.id], price = G.Game.priceOf(p, it.id), own = G.Game.owns(p, it.id);
        html += '<button class="bm-item' + (own ? ' own' : p.money < price ? ' no' : '') + '" data-buy="' + it.id + '"><span><span class="k">' + it.n + '</span>' + d.name +
          '</span><span class="p">' + (own ? '已拥有' : '$' + price) + '</span></button>';
      }
      html += '</div>';
    }
    const left = Math.max(0, Math.ceil(G.Game.buyUntil - G.time));
    html += '</div><div class="row" style="justify-content:space-between;margin-top:14px"><span style="color:var(--muted);font-size:13px">' +
      (touch ? '' : '数字键快速购买 · ') + '购买时间剩余 <span id="buySeconds">' + left + '</span> 秒 · 死亡后会失去武器</span>' +
      (touch ? '' : '<button data-close="1">关闭（B）</button>') + '</div></div>';
    const scroll = touch && el.buymenu.firstElementChild ? el.buymenu.firstElementChild.scrollTop : 0;
    el.buymenu.innerHTML = html;
    if (scroll) el.buymenu.firstElementChild.scrollTop = scroll;
    if (vc.on) { vc.hover = null; H.moveCursor(0, 0, false); }   // the old buttons were replaced
  }
  // The mouse stays captured while buying: an in-game cursor follows it. Releasing and
  // re-capturing the mouse around the menu is what used to make the view jump afterwards.
  const vc = { on: false, x: 0, y: 0, hover: null };
  function setHover(btn) {
    if (vc.hover === btn) return;
    if (vc.hover) vc.hover.classList.remove('vhover');
    vc.hover = btn;
    if (btn) btn.classList.add('vhover');
  }
  H.moveCursor = function (dx, dy, click) {
    if (!H.buyOpen || !vc.on) return;
    vc.x = G.clamp(vc.x + dx, 0, window.innerWidth - 1);
    vc.y = G.clamp(vc.y + dy, 0, window.innerHeight - 1);
    el.vcursor.style.transform = 'translate(' + vc.x.toFixed(1) + 'px,' + vc.y.toFixed(1) + 'px)';
    const hit = document.elementFromPoint(vc.x, vc.y);
    const btn = hit && hit.closest ? hit.closest('#buymenu button') : null;
    setHover(btn);
    if (click && btn) btn.click();
  };
  H.toggleBuy = function (force) {
    const p = G.Player.agent;
    const want = force === undefined ? !H.buyOpen : force;
    if (want && (!p || !G.Game.canBuy(p))) { if (force === undefined) H.message('', '现在无法购买（只能在回合开始时于出生点购买）', 2); return; }
    if (want === H.buyOpen) return;
    H.buyOpen = want;
    el.buymenu.hidden = !want;
    vc.on = want && !G.Touch.enabled && G.input.locked;
    el.vcursor.hidden = !vc.on;
    if (want) {
      vc.x = window.innerWidth / 2; vc.y = window.innerHeight / 2;
      renderBuy();
    } else setHover(null);
    if (G.Touch.enabled) G.Touch.sync();
  };

  // ---------- scoreboard ----------
  H.showScores = function (on) {
    if (on === H.scoresOpen) { if (on && (sbRefresh -= 1 / 60) <= 0) renderScores(); return; }
    H.scoresOpen = on; el.scoreboard.hidden = !on;
    if (G.Touch.enabled) {
      if (on) el.scoreboard.innerHTML = '<div class="slab"><button data-close-scores>关闭比分</button><div id="scoreContent"></div></div>';
      G.Touch.sync();
    }
    if (on) renderScores();
  };
  function renderScores() {
    sbRefresh = 0.25;
    const p = G.Player.agent;
    let html = '<div class="bm-head"><h2>记分板 · 第 ' + G.Game.round + ' 回合</h2><span class="num" style="font-size:20px"><span class="t-atk">' +
      G.Game.score.atk + '</span> : <span class="t-def">' + G.Game.score.def + '</span></span></div>';
    ['atk', 'def'].forEach((t) => {
      html += '<table class="sb"><tr><th class="t-' + t + '">' + TEAM[t] + '</th><th style="text-align:right">击杀</th><th style="text-align:right">死亡</th><th style="text-align:right">金钱</th></tr>';
      G.Game.agents.filter((a) => a.team === t).sort((a, b) => b.kills - a.kills).forEach((a) => {
        html += '<tr class="' + (a === p ? 'me ' : '') + (a.alive ? '' : 'dead') + '"><td>' + a.name + (a.inv.bomb && t === p.team ? ' · 炸弹' : '') + (a.kit && t === p.team ? ' · 拆弹器' : '') +
          '</td><td class="n">' + a.kills + '</td><td class="n">' + a.deaths + '</td><td class="n">' + (a.team === p.team ? '$' + a.money : '—') + '</td></tr>';
      });
      html += '</table>';
    });
    if (G.Touch.enabled) {
      const content = $('scoreContent');
      if (content._t !== html) { content.innerHTML = html; content._t = html; }
    } else el.scoreboard.innerHTML = '<div class="slab">' + html + '</div>';
  }

  // ---------- radar ----------
  function drawRadar() {
    const p = G.Player.agent, view = p.alive ? p : G.Player.spectateTarget() || p;
    const c = rctx, S = 420, scale = 1.25, [px, pz] = M.toRadar(view.pos.x, view.pos.z);
    c.clearRect(0, 0, S, S);
    c.save();
    c.beginPath(); c.rect(0, 0, S, S); c.clip();
    c.fillStyle = 'rgba(10,9,7,.6)'; c.fillRect(0, 0, S, S);
    c.translate(S / 2, S / 2); c.rotate(view.yaw); c.scale(scale, scale); c.translate(-px, -pz);
    c.drawImage(M.radar, 0, 0);
    const b = G.Game.bomb;
    const dot = (x, z, color, r) => { const [rx, rz] = M.toRadar(x, z); c.fillStyle = color; c.beginPath(); c.arc(rx, rz, r, 0, 7); c.fill(); };
    for (const a of G.Game.agents) {
      if (a === view) continue;
      const friend = a.team === p.team;
      if (!a.alive) { if (friend) { const [rx, rz] = M.toRadar(a.pos.x, a.pos.z); c.strokeStyle = 'rgba(255,255,255,.5)'; c.lineWidth = 1.5; c.beginPath(); c.moveTo(rx - 3, rz - 3); c.lineTo(rx + 3, rz + 3); c.moveTo(rx + 3, rz - 3); c.lineTo(rx - 3, rz + 3); c.stroke(); } continue; }
      if (friend) dot(a.pos.x, a.pos.z, a.team === 'atk' ? '#ffa26b' : '#7cc0ff', 4.2);
      else if (a.spottedUntil > G.time) dot(a.pos.x, a.pos.z, '#ff3b30', 4.6);
    }
    if (b.state === 'planted' || (b.state === 'dropped' && p.team === 'atk')) dot(b.pos.x, b.pos.z, b.state === 'planted' ? '#ff3b30' : '#ffd23f', 3.6);
    else if (b.state === 'carried' && b.carrier && b.carrier.team === p.team && b.carrier.alive) { const [rx, rz] = M.toRadar(b.carrier.pos.x, b.carrier.pos.z); c.strokeStyle = '#ffd23f'; c.lineWidth = 1.5; c.beginPath(); c.arc(rx, rz, 6.5, 0, 7); c.stroke(); }
    c.restore();
    // self arrow (always points up)
    c.fillStyle = '#fff';
    c.beginPath(); c.moveTo(S / 2, S / 2 - 11); c.lineTo(S / 2 + 7, S / 2 + 8); c.lineTo(S / 2, S / 2 + 4); c.lineTo(S / 2 - 7, S / 2 + 8); c.closePath(); c.fill();
  }

  // ---------- per-frame ----------
  // Only touch the page when a value really changes: every write makes the browser restyle the HUD.
  function txt(e, v) { v = String(v); if (e._t !== v) { e._t = v; e.textContent = v; } }
  function cls(e, name, on) { const k = '_c' + name; if (e[k] !== on) { e[k] = on; e.classList.toggle(name, on); } }
  function sty(e, prop, v) { const k = '_s' + prop; if (e[k] !== v) { e[k] = v; e.style[prop] = v; } }
  function hid(e, h) { if (e._h !== h) { e._h = h; e.hidden = h; } }
  let radarTick = 0;
  H.update = function (dt) {
    const p = G.Player.agent;
    if (!p || !el) return;
    const Gm = G.Game, view = p.alive ? p : G.Player.spectateTarget() || p;
    txt(el.hp, Math.max(0, view.hp)); cls(el.hp, 'low', view.hp <= 25);
    txt(el.armor, view.armor); txt(el.armorIco, view.helmet ? '护甲+盔' : '护甲');
    txt(el.money, '$' + p.money);
    if (moneyT > 0) { moneyT -= dt; if (moneyT <= 0) el.moneyDelta.textContent = ''; }
    const it = W.current(view);
    if (it && !it.def.melee) {
      txt(el.clip, it.reloading ? '…' : it.clip); txt(el.reserve, '/ ' + it.reserve);
      cls(el.clip, 'low', it.clip <= Math.ceil(it.def.clip * 0.2));
    } else { txt(el.clip, view.cur === 'bomb' ? '炸弹' : '—'); txt(el.reserve, ''); cls(el.clip, 'low', false); }
    const slotTxt = ['primary', 'pistol', 'knife', 'bomb'].map((s, i) => {
      const has = s === 'bomb' ? view.inv.bomb : view.inv[s];
      if (!has) return '';
      const name = s === 'bomb' ? '炸弹' : view.inv[s].def.name;
      if (G.Touch.enabled) return '<button data-slot="' + s + '" class="' + (view.cur === s ? 'on' : '') + '"' + (p.alive ? '' : ' disabled') + '>' + name + '</button>';
      return '<div class="' + (view.cur === s ? 'on' : '') + '">' + (i + 1) + ' · ' + name + '</div>';
    }).join('');
    if (el.slots._t !== slotTxt) { el.slots.innerHTML = slotTxt; el.slots._t = slotTxt; }

    // timer & score
    const b = Gm.bomb;
    if (b.state === 'planted') { txt(el.timer, '炸弹'); cls(el.timer, 'bomb', true); sty(el.timer, 'color', ''); }
    else {
      cls(el.timer, 'bomb', false);
      txt(el.timer, Gm.phase === 'freeze' ? G.fmtTime(Gm.phaseT) : G.fmtTime(Gm.timeLeft));
      sty(el.timer, 'color', Gm.phase === 'freeze' ? 'var(--sun)' : '');
    }
    txt(el.scoreAtk, Gm.score.atk); txt(el.scoreDef, Gm.score.def);
    ['atk', 'def'].forEach((t) => {
      const n = Gm.alive(t), pips = (t === 'atk' ? el.aliveAtk : el.aliveDef).children;
      for (let i = 0; i < pips.length; i++) cls(pips[i], 'dead', i >= n);
    });

    // crosshair & scope
    const scoped = it && it.def.scope && it.zoom > 0 && p.alive;
    hid(el.scope, !scoped);
    const showCh = p.alive && !(it && it.def.scope);
    hid(el.crosshair, !showCh);
    if (showCh) {
      let gap = 4;
      if (it && !it.def.melee) {
        const sp = W.spread(p, it), half = Math.tan(G.camera.fov * Math.PI / 360);
        gap = G.clamp(Math.tan(sp) / half * (innerHeight / 2), 3, 90);
      }
      const L = 8, g = Math.round(gap);
      sty(el.chL, 'left', (-g - L) + 'px'); sty(el.chR, 'left', g + 'px');
      sty(el.chT, 'top', (-g - L) + 'px'); sty(el.chB, 'top', g + 'px');
    }

    // progress (plant / defuse)
    if (p.alive && (p.planting || p.defusing)) {
      hid(el.progress, false);
      const dur = p.planting ? Gm.CFG.plant : p.kit ? Gm.CFG.defuseKit : Gm.CFG.defuse;
      txt(el.progressLabel, p.planting ? '正在安放炸弹…' : '正在拆除炸弹…');
      sty(el.progressBar, 'width', Math.min(100, Math.round((p.planting ? p.plantT : p.defuseT) / dur * 200) / 2) + '%');
    } else hid(el.progress, true);

    // context hint
    let hint = '';
    if (p.alive && Gm.phase === 'live') {
      if (p.inv.bomb && !p.planting) hint = M.siteAt(p.pos.x, p.pos.z) ? '按住 E 安放炸弹' : '';
      else if (p.team === 'def' && b.state === 'planted' && !p.defusing && G.dist2D(p.pos, b.pos) < 1.6) hint = '按住 E 拆除炸弹' + (p.kit ? '（拆弹器：5 秒）' : '（10 秒）');
    }
    if (hint && G.Touch.enabled) hint = hint.replace(' E ', '「使用」');
    if (hint !== lastHint) { el.hint.textContent = hint; el.hint.hidden = !hint; lastHint = hint; }
    hid(el.buyHint, !(Gm.canBuy(p) && !H.buyOpen));
    if (H.buyOpen) {
      if (!Gm.canBuy(p)) H.toggleBuy(false);
      else if ((buyRefresh -= dt) <= 0) {
        buyRefresh = 0.5;
        if (G.Touch.enabled) txt($('buySeconds'), Math.max(0, Math.ceil(Gm.buyUntil - G.time)));
        else renderBuy();
      }
    }
    if (G.Touch.enabled) G.Touch.sync();
    if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) el.centerMsg.hidden = true; }
    vign = Math.max(0, vign - dt * 1.2);
    sty(el.vignette, 'opacity', Math.max(vign, p.alive && p.hp <= 25 ? 0.35 : 0).toFixed(2));
    if ((radarTick = (radarTick + 1) % 2) === 0) drawRadar();   // 30 times a second is plenty
  };
})(window.G);
