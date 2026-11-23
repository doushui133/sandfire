// hud.js — on-screen readouts, radar, kill feed, buy menu, scoreboard and round banners
(function (G) {
  'use strict';
  const W = G.Weapons, M = G.Map;
  const H = G.HUD = { buyOpen: false, scoresOpen: false };
  const $ = (id) => document.getElementById(id);
  let el, rctx, fctx, msgTimer = 0, vign = 0, buyRefresh = 0, sbRefresh = 0, moneyT = 0, lastHint = '', buyRev = -1, iconTick = 29;
  const TEAM = { atk: '进攻方', def: '防守方' };
  const MULTI = ['', '击杀', '双杀', '三杀', '四杀', '全歼'];
  const STAT_NAME = { '伤': '伤害', '射': '射速', '精': '精度', '机': '机动' };

  H.init = function () {
    el = {};
    ['hud', 'radar', 'scoreAtk', 'scoreDef', 'timer', 'aliveAtk', 'aliveDef', 'killfeed', 'hp', 'armor', 'armorIco', 'armorMark', 'hpBar', 'armorBar', 'vitHp', 'money', 'moneyDelta', 'clip', 'reserve', 'ammoIcon', 'slots',
      'crosshair', 'chL', 'chR', 'chT', 'chB', 'chDot', 'hitmarker', 'hitFx', 'scope', 'centerMsg', 'msgTitle', 'msgSub', 'progress', 'progressBar', 'progressLabel', 'hint', 'vignette',
      'dmgdir', 'death', 'deathCard', 'buyHint', 'buymenu', 'scoreboard', 'endScreen', 'endTitle', 'endSub', 'ammo', 'vcursor', 'edgeL', 'edgeR', 'bombStat', 'killBanner',
      'mapOverlay', 'mapFull', 'mapClose', 'nadeWheel', 'nadeCharge', 'killPips', 'specName'].forEach((k) => (el[k] = $(k)));
    rctx = el.radar.getContext('2d');
    fctx = el.mapFull ? el.mapFull.getContext('2d') : null;
    if (el.radar) el.radar.addEventListener('pointerup', (e) => {
      if (e.button && e.button !== 0) return;
      if (G.Touch && G.Touch.editing) return;
      H.toggleMap();
    });
    if (el.mapOverlay) el.mapOverlay.addEventListener('pointerup', () => { if (H.mapOpen) H.toggleMap(false); });
    let pips = '';
    for (let i = 0; i < 5; i++) pips += '<i></i>';
    el.aliveAtk.innerHTML = pips; el.aliveDef.innerHTML = pips;
    el.buymenu.addEventListener('click', (e) => {
      const cat = e.target.closest('[data-category]');
      if (cat) { category = Number(cat.dataset.category); renderBuy(); return; }
      const b = e.target.closest('[data-buy]');
      if (b) buy(b.dataset.buy);
      if (e.target.closest('[data-close]')) H.toggleBuy(false);
    });
    el.scoreboard.addEventListener('click', (e) => {
      if (e.target.closest('[data-close-scores]')) H.showScores(false);
    });
    window.addEventListener('keydown', (e) => {
      if (!H.buyOpen || G.Touch.enabled || e.repeat) return;
      const n = parseInt(e.key, 10);
      if (n === 0) { category = -1; renderBuy(); return; }
      if (n >= 1 && n <= 9) {
        e.preventDefault(); delete G.input.pressed[e.code];
        if (category < 0) { if (n <= categories.length) { category = n - 1; renderBuy(); } }
        else { const id = buyList()[n - 1]; if (id) buy(id); }
      }
    });
  };

  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }
  function agentName(a) {
    if (!a) return '';
    return typeof a === 'string' ? a : (a.name || '');
  }
  function weaponId(weapon) {
    if (weapon == null || weapon === '') return '';
    if (typeof weapon !== 'string') {
      if (weapon.id) return weaponId(weapon.id);
      if (weapon.name) return weaponId(weapon.name);
      return '';
    }
    if (weapon === '爆炸' || weapon === '炸弹') return 'bomb';
    if (W.defs[weapon] || (G.GunModels && G.GunModels.IDS.indexOf(weapon) >= 0)) return weapon;
    for (const id in W.defs) if (W.defs[id].name === weapon) return id;
    return '';
  }
  function weaponLabel(weapon) {
    const id = weaponId(weapon);
    if (id && W.defs[id]) return W.defs[id].name;
    if (id === 'bomb') return '炸弹';
    return typeof weapon === 'string' ? weapon : '';
  }
  function ico(id, cls) {
    if (!id) return '';
    const url = G.Icons && G.Icons.get ? G.Icons.get(id) : '';
    const extra = cls ? ' ' + cls : '';
    if (!url) return '<i class="wico wico-ph' + extra + '"></i>';
    return '<img class="wico' + extra + '" alt="" draggable="false" src="' + url + '">';
  }
  function glyph(id) {
    if (id === 'vesthelm') return '<i class="glyph glyph-helm"></i>';
    if (id === 'kit') return '<i class="glyph glyph-kit"></i>';
    return '<i class="glyph glyph-vest"></i>';
  }

  // ---------- messages ----------
  H.message = function (title, sub, dur) {
    el.msgTitle.textContent = title || ''; el.msgSub.textContent = sub || '';
    el.centerMsg.hidden = !title && !sub;
    msgTimer = dur || 0;
    el.msgTitle.style.color = '';
  };
  function clearKills() {
    killQ.length = 0;
    killPhase = '';
    if (killTimer) { clearTimeout(killTimer); killTimer = 0; }
    if (el.killBanner) el.killBanner.hidden = true;
  }
  H.roundStart = function (round, hasBomb) {
    if (G.Touch.enabled) G.Touch.reset();
    const p = G.Player.agent;
    const sub = hasBomb ? '你携带炸弹 · 前往 A 点或 B 点安放' : p.team === 'atk' ? '进攻：掩护队友安放炸弹' : '防守：守住 A、B 两个包点';
    H.message('第 ' + round + ' 回合', sub, G.Game.CFG.freeze);
    H.deathStage('');
    clearKills();
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
    clearKills();
  };
  H.moneyDelta = function (v) {
    const node = el.moneyDelta;
    node.textContent = '+$' + v;
    moneyT = 3;
    node.classList.remove('pop');
    void node.offsetWidth;
    node.classList.add('pop');
  };
  H.hitmarker = function (head, killed) {
    el.hitmarker.classList.toggle('hs', !!head);
    el.hitmarker.classList.toggle('kill', !!killed);
    el.hitmarker.style.transition = 'none'; el.hitmarker.style.opacity = 1;
    requestAnimationFrame(() => { el.hitmarker.style.transition = ''; el.hitmarker.style.opacity = 0; });
  };
  H.hitFx = function (info) {
    if (!el || !el.hitmarker) return;
    info = info || {};
    const head = !!(info.head || info.headshot);
    H.hitmarker(head, !!info.kill);
    if (!el.hitFx || info.dmg == null) return;
    const n = document.createElement('b');
    n.className = 'hit-dmg' + (head ? ' hs' : '') + (info.kill ? ' kill' : '');
    n.textContent = String(Math.round(info.dmg));
    el.hitFx.appendChild(n);
    el.hitFx.hidden = false;
    while (el.hitFx.children.length > 4) el.hitFx.firstChild.remove();
    setTimeout(() => {
      n.remove();
      if (el.hitFx && !el.hitFx.children.length) el.hitFx.hidden = true;
    }, 450);
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
  H.killfeed = function (k, v, wname, head, wall) {
    let hs = false, wb = false, weapon = wname;
    if (head && typeof head === 'object') {
      hs = !!(head.head || head.headshot);
      wb = !!(head.wallbang || head.wall);
      if (head.weapon) weapon = head.weapon;
    } else { hs = !!head; wb = !!wall; }
    const p = G.Player.agent, d = document.createElement('div');
    const mine = k === p, fell = v === p && !mine;
    d.className = 'kf' + (mine ? ' me' : '') + (fell ? ' died' : '');
    const nm = (a) => a ? '<span class="t-' + (a.team || 'atk') + '">' + esc(a.name || '') + '</span>' : '';
    d.innerHTML = (k && k !== v ? nm(k) : '') + ico(weaponId(weapon), 'wico-sm') +
      (hs ? '<span class="mark hs">爆头</span>' : '') + (wb ? '<span class="mark wb">穿墙</span>' : '') + nm(v);
    el.killfeed.appendChild(d);
    while (el.killfeed.children.length > 5) el.killfeed.firstChild.remove();
    setTimeout(() => d.remove(), 7000);
  };

  // ---------- kill / death moments ----------
  const killQ = [];
  let killPhase = '', killTimer = 0, killStarted = 0, killUntil = 0;
  const skullPip = '<svg viewBox="0 0 48 48"><use href="#km-skull"/></svg>';
  function paintKill(info, fast) {
    const tier = info.ace ? 5 : G.clamp(info.multi | 0, 1, 5);
    const label = [MULTI[tier], agentName(info.victim), weaponLabel(info.weapon)];
    let classes = 'kill-marker' + (fast ? ' fast' : '') + (tier === 5 ? ' ace' : '');
    if (info.headshot) { classes += ' headshot'; label.push('爆头'); }
    if (info.knife) { classes += ' knife'; label.push('刀杀'); }
    if (info.grenade) { classes += ' grenade'; label.push('雷杀'); }
    if (info.wallbang) { classes += ' wallbang'; label.push('穿墙'); }
    if (info.first) label.push('首杀');
    if (info.last) label.push('终结');
    if (info.streak > 1) label.push('连击 ' + info.streak);
    el.killPips.innerHTML = skullPip.repeat(tier);
    el.killBanner.setAttribute('aria-label', label.filter(Boolean).join('，'));
    el.killBanner.className = classes;
    el.killBanner.hidden = false;
  }
  function scheduleKillExit(until) {
    killUntil = until;
    clearTimeout(killTimer);
    killTimer = setTimeout(() => {
      killPhase = 'leave';
      el.killBanner.classList.add('leaving');
      killTimer = setTimeout(playKill, 160);
    }, Math.max(0, until - G.now()));
  }
  function playKill() {
    killTimer = 0;
    if (!killQ.length) { clearKills(); return; }
    const info = killQ.shift();
    const fast = killQ.length > 0;
    paintKill(info, fast);
    killPhase = 'hold';
    killStarted = G.now();
    scheduleKillExit(killStarted + (fast ? 450 : 1600));
  }
  H.killFx = function (info) {
    if (!info || !el || !el.killBanner) return;
    if (killQ.length >= 5) killQ.shift();
    killQ.push(info);
    if (!killPhase) playKill();
    else if (killPhase === 'hold') {
      const until = Math.max(killStarted + 450, G.now() + 120);
      if (until < killUntil) scheduleKillExit(until);
    }
  };
  let deathInfo, deathActor, deathStage = '', deathHp, specActor, specTouch;
  function fillDeath(info, hp) {
    const name = agentName(info.killer);
    const team = deathActor ? deathActor.team : '';
    const wid = weaponId(info.weapon);
    const head = info.headshot ? '<svg class="dc-head" viewBox="0 0 24 24" role="img" aria-label="爆头"><circle cx="12" cy="12" r="7" fill="none" stroke="currentColor"/><path d="M12 1v7m0 8v7M1 12h7m8 0h7" stroke="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/></svg>' : '';
    el.deathCard.innerHTML = '<div class="dc-card"><div class="dc-weapon" title="' + esc(weaponLabel(info.weapon)) + '">' +
      ico(wid, 'wico-lg') + '</div><div class="dc-details"><div class="dc-row"><b class="' + (team ? 't-' + team : '') +
      '">' + esc(name || '你已阵亡') + '</b>' + head + '</div>' +
      (hp == null ? '' : '<div class="dc-hp" aria-label="剩余生命 ' + hp + '"><span aria-hidden="true">+</span><s><i style="width:' +
        Math.min(100, hp) + '%"></i></s><b class="num">' + hp + '</b></div>') + '</div></div>';
  }
  H.deathFx = function (info) {
    if (info) deathInfo = info;
  };
  H.died = function (k, wname, head) {
    if (G.Touch.enabled) G.Touch.reset();
    deathActor = k && k !== G.Player.agent ? k : null;
    deathInfo = { killer: k, weapon: wname, headshot: !!head };
    H.deathStage('fall');
    H.toggleBuy(false);
  };
  H.deathStage = function (stage) {
    if (!el) return;
    if (deathStage !== stage) {
      deathStage = stage;
      if (!stage) { deathInfo = deathActor = specActor = null; }
      el.deathCard.hidden = stage !== 'killer' || !deathInfo;
      el.death.hidden = stage !== 'fall' && stage !== 'killer';
      if (!el.death.hidden) el.specName.textContent = G.Touch.enabled ? '轻点跳过' : '点击跳过';
      deathHp = undefined;
    }
    if (stage !== 'killer' || !deathInfo) return;
    const rawHp = deathActor ? deathActor.hp : deathInfo.killer !== '爆炸' ? deathInfo.killerHp : null;
    const hp = Number.isFinite(rawHp) ? Math.max(0, Math.round(rawHp)) : null;
    if (hp !== deathHp) { deathHp = hp; fillDeath(deathInfo, hp); }
  };
  H.spectating = function (t) {
    if (el.death.hidden === !!t) el.death.hidden = !t;
    if (specActor === t && specTouch === G.Touch.enabled) return;
    specActor = t;
    specTouch = G.Touch.enabled;
    if (t) el.specName.textContent = '正在观察：' + t.name + (specTouch ? ' · 轻点切换' : ' · 左键切换');
  };
  // glow on the screen edge while the fallback cursor turns the view
  H.edge = function (e) {
    const l = e < 0 ? (-e).toFixed(2) : '0', r = e > 0 ? e.toFixed(2) : '0';
    if (el.edgeL.style.opacity !== l) el.edgeL.style.opacity = l;
    if (el.edgeR.style.opacity !== r) el.edgeR.style.opacity = r;
  };

  // ---------- buy menu ----------
  const categories = [
    ['手枪', 'p10', 'm18', 'h50'], ['冲锋枪', 'k5', 'u45', 'v9'], ['霰弹枪', 's8'], ['机枪', 'l60'],
    ['步枪', 'fa2', 'ar7', 'tr4'], ['狙击步枪', 's40', 'r90'], ['投掷物'].concat(W.grenades), ['装备', 'vest', 'vesthelm', 'kit'],
  ];
  let category = -1;
  function allowed(id, team) {
    const d = W.defs[id] || W.equipment[id];
    return d && (!d.team || d.team === team);
  }
  function buyList() {
    return categories[category].slice(1).filter((id) => allowed(id, G.Player.agent.team));
  }
  function buy(id) {
    if (!G.Game.buy(G.Player.agent, id)) G.Audio.click('deny');
    renderBuy();
  }
  function gunStats(d) {
    if (!d || !d.dmg || d.slot === 'grenade') return null;
    const raw = d.pellets ? d.dmg * d.pellets : d.dmg;
    return [
      ['伤', clamp01(raw / 160)],
      ['射', d.rpm ? clamp01(d.rpm / 1000) : clamp01(d.rate ? 0.5 / d.rate : 0.4)],
      ['精', d.inacc && d.inacc.stand != null ? clamp01(1 - d.inacc.stand / 0.05) : 0.5],
      ['机', d.speed ? clamp01((d.speed - 4.15) / 2.15) : 0.5]
    ];
  }
  function bars(rows) {
    let h = '<span class="stats">';
    for (let i = 0; i < rows.length; i++) {
      h += '<span class="stat" title="' + STAT_NAME[rows[i][0]] + '"><b>' + rows[i][0] + '</b><s><i style="width:' + Math.round(rows[i][1] * 100) + '%"></i></s></span>';
    }
    return h + '</span>';
  }
  function blurb(id) {
    if (id === 'vest') return '护甲 100';
    if (id === 'vesthelm') return '护甲 100 · 头盔';
    if (id === 'kit') return '拆除缩短为 5 秒';
    if (id === 'he') return '范围爆炸';
    if (id === 'flash') return '遮蔽视野';
    if (id === 'smoke') return '烟雾遮挡';
    if (id === 'molotov' || id === 'incendiary') return '地面火焰';
    return '';
  }
  function renderBuy() {
    const p = G.Player.agent, title = category < 0 ? '购买装备' : categories[category][0];
    buyRev = G.Icons ? G.Icons.rev : 0;
    let html = '<div class="slab bm-slab"><div class="bm-head"><div><h2>' + esc(title) + '</h2><span class="bm-help mouse-only">数字键选择 · 0 返回 · B / Esc 关闭</span></div><span class="num bm-money">$' + p.money + '</span><button type="button" data-close>关闭</button></div>';
    if (category >= 0) {
      html += '<div class="bm-tabs">';
      categories.forEach((c, i) => {
        if (!c.slice(1).some((id) => allowed(id, p.team))) return;
        html += '<button type="button" data-category="' + i + '" class="' + (i === category ? 'on' : '') + '">' + esc(c[0]) + '</button>';
      });
      html += '</div>';
    }
    html += '<div class="bm-grid' + (category >= 0 ? ' bm-cards' : '') + '">';
    if (category < 0) {
      categories.forEach((c, i) => {
        const n = c.slice(1).filter((id) => allowed(id, p.team)).length;
        if (!n) return;
        html += '<button type="button" data-category="' + i + '"><span><span class="k">' + (i + 1) + '</span>' + esc(c[0]) + '</span><small>' + n + '</small></button>';
      });
    } else buyList().forEach((id, i) => {
      const d = W.defs[id] || W.equipment[id], price = G.Game.priceOf(p, id), own = G.Game.owns(p, id);
      const full = d.slot === 'grenade' && !W.canCarry(p, id);
      const poor = p.money < price;
      const team = !!(d.team && d.team === p.team);
      let state = own ? '已拥有' : full ? '携带已满' : poor ? '余额不足' : '';
      const count = d.slot === 'grenade' && p.nades[id] ? ' ×' + p.nades[id] : '';
      const st = gunStats(d);
      html += '<button type="button" class="bm-card' + (own ? ' own' : state ? ' no' : '') + (team ? ' team' : '') + '" data-buy="' + id + '"' + (state ? ' disabled' : '') + '>' +
        '<span class="bm-ico">' + (W.defs[id] ? ico(id) : glyph(id)) + '</span>' +
        '<span class="bm-copy"><span class="bm-name"><span class="k">' + (i + 1) + '</span>' + esc(d.name) + esc(count) + '</span>' +
        '<span class="bm-meta"><span class="p">$' + price + '</span>' + (state ? '<span class="st">' + state + '</span>' : '') + (team ? '<span class="tag">本方专属</span>' : '') + '</span></span>' +
        (st ? bars(st) : '<span class="bm-blurb">' + esc(blurb(id)) + '</span>') + '</button>';
    });
    const left = Math.max(0, Math.ceil(G.Game.buyUntil - G.time));
    html += '</div><div class="bm-foot">' + (category >= 0 ? '<button type="button" data-category="-1">' + (G.Touch.enabled ? '' : '0 · ') + '返回分类</button>' : '<span></span>') +
      '<span>购买时间剩余 <b class="num" id="buySeconds">' + left + '</b> 秒</span></div></div>';
    el.buymenu.innerHTML = html;
    if (vc.on) { vc.hover = null; H.moveCursor(0, 0, false); }
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
      G.Nades.cancel(p); category = -1;
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
      if (on) el.scoreboard.innerHTML = '<div class="slab sb-slab"><button type="button" data-close-scores>关闭比分</button><div id="scoreContent"></div></div>';
      G.Touch.sync();
    }
    if (on) renderScores();
  };
  function renderScores() {
    sbRefresh = 0.25;
    const p = G.Player.agent;
    let html = '<div class="sb-head"><h2>记分板</h2><span class="sb-round">第 ' + G.Game.round + ' 回合</span><span class="num sb-score"><span class="t-atk">' +
      G.Game.score.atk + '</span><span class="sb-colon">:</span><span class="t-def">' + G.Game.score.def + '</span></span></div>';
    ['atk', 'def'].forEach((t) => {
      html += '<section class="sb-team is-' + t + '"><h3 class="t-' + t + '">' + TEAM[t] + '</h3><table class="sb"><thead><tr><th>干员</th><th>击杀</th><th>死亡</th><th>金钱</th></tr></thead><tbody>';
      G.Game.agents.filter((a) => a.team === t).sort((a, b) => b.kills - a.kills).forEach((a) => {
        const tags = (a.inv.bomb && t === p.team ? '<span class="tag">炸弹</span>' : '') + (a.kit && t === p.team ? '<span class="tag">拆弹器</span>' : '');
        html += '<tr class="' + (a === p ? 'me ' : '') + (a.alive ? '' : 'dead') + '"><td><i class="pip' + (a.alive ? ' on' : '') + '"></i>' + esc(a.name) + tags +
          '</td><td class="n">' + a.kills + '</td><td class="n">' + a.deaths + '</td><td class="n">' + (a.team === p.team ? '$' + a.money : '—') + '</td></tr>';
      });
      html += '</tbody></table></section>';
    });
    if (G.Touch.enabled) {
      const content = $('scoreContent');
      if (content && content._t !== html) { content.innerHTML = html; content._t = html; }
    } else el.scoreboard.innerHTML = '<div class="slab sb-slab">' + html + '</div>';
  }

  // ---------- radar ----------
  const eyeV = new G.THREE.Vector3(), seeP = new G.THREE.Vector3();
  const seenEnemy = {};
  let radarBase = null, spawnMark = null;
  const MAP_FONT = '"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif';
  H.mapOpen = false;
  H.toggleMap = function (force) {
    if (!el || !el.mapOverlay) return;
    if (G.paused || H.buyOpen || H.scoresOpen || (G.Touch && G.Touch.editing)) force = false;
    const next = typeof force === 'boolean' ? force : !H.mapOpen;
    H.mapOpen = next;
    el.mapOverlay.hidden = !next;
    if (next) paintMap(el.mapFull, fctx, true);
  };
  function paintMap(canvas, ctx, full) {
    if (!canvas || !ctx) return;
    const css = canvas.clientWidth || canvas.width;
    if (css < 32) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const buf = Math.max(64, Math.round(css * dpr));
    if (canvas.width !== buf || canvas.height !== buf) { canvas.width = buf; canvas.height = buf; }
    drawMap(ctx, buf, full, css);
  }
  function seesEnemy(view, enemy) {
    if (!view || !enemy.alive || !G.Nades || !G.Nades.visible || view.blindUntil > G.time) return false;
    G.eyePos(view, eyeV);
    const head = enemy.pos.y + 1.62 - 0.48 * enemy.crouch;
    const body = enemy.pos.y + 1.05 - 0.28 * enemy.crouch;
    return G.Nades.visible(eyeV, seeP.set(enemy.pos.x, head, enemy.pos.z))
      || G.Nades.visible(eyeV, seeP.set(enemy.pos.x, body, enemy.pos.z));
  }
  function buildRadarBase() {
    if (!M || !M.W || !M.walkable || !M.ch) return M && M.radar;
    const px = 5, c = document.createElement('canvas');
    c.width = M.W * px; c.height = M.H * px;
    const x = c.getContext('2d');
    if (!x) return M.radar;
    x.fillStyle = '#14110e';
    x.fillRect(0, 0, c.width, c.height);
    for (let r = 0; r < M.H; r++) for (let col = 0; col < M.W; col++) {
      if (!M.walkable(col, r)) continue;
      const ch = M.ch(col, r);
      if (ch === 'A' || ch === 'B') x.fillStyle = '#f4e7c8';
      else if (ch === 'T') x.fillStyle = '#e7b184';
      else if (ch === 'D') x.fillStyle = '#b7d0ea';
      else x.fillStyle = '#d8c6a2';
      x.fillRect(col * px, r * px, px, px);
    }
    x.strokeStyle = '#ffb14a';
    x.lineWidth = 2;
    const sites = M.sites || {};
    for (const k in sites) {
      const s = sites[k];
      x.strokeRect(s.c0 * px + 1.5, s.r0 * px + 1.5, (s.c1 - s.c0 + 1) * px - 3, (s.r1 - s.r0 + 1) * px - 3);
    }
    return c;
  }
  function radarImage() {
    if (!radarBase) radarBase = buildRadarBase();
    return radarBase;
  }
  function spawnMarks() {
    if (spawnMark || !M.spawns) return spawnMark;
    const cen = (list) => {
      let x = 0, z = 0;
      for (let i = 0; i < list.length; i++) { x += list[i].x; z += list[i].z; }
      return { x: x / list.length, z: z / list.length };
    };
    spawnMark = {
      atk: M.spawns.atk && M.spawns.atk.length ? cen(M.spawns.atk) : null,
      def: M.spawns.def && M.spawns.def.length ? cen(M.spawns.def) : null,
    };
    return spawnMark;
  }
  function drawMap(c, S, full, css) {
    const p = G.Player.agent;
    if (!p || !c || !M.toRadar) return;
    const view = p.alive ? p : (G.Player.spectateTarget() || p);
    const base = radarImage();
    if (!base) return;
    const mapW = base.width || 250, mapH = base.height || 250;
    const rp = M.toRadar(view.pos.x, view.pos.z);
    const follow = G.settings.radarRot !== false;
    const rot = follow ? view.yaw : 0;
    const fit = full && follow ? Math.SQRT2 : 1;
    const scale = full ? (S - 28) / (Math.max(mapW, mapH) * fit) : 1.25;
    const ox = full ? mapW / 2 : rp[0], oy = full ? mapH / 2 : rp[1];
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.clearRect(0, 0, S, S);
    c.fillStyle = '#100e0b';
    c.fillRect(0, 0, S, S);
    c.save();
    c.beginPath(); c.rect(3, 3, S - 6, S - 6); c.clip();
    c.translate(S / 2, S / 2);
    if (rot) c.rotate(rot);
    c.scale(scale, scale);
    c.translate(-ox, -oy);
    c.imageSmoothingEnabled = false;
    c.drawImage(base, 0, 0);
    c.restore();
    const project = (wx, wz) => {
      const pt = M.toRadar(wx, wz);
      const x = (pt[0] - ox) * scale, y = (pt[1] - oy) * scale;
      const co = Math.cos(rot), si = Math.sin(rot);
      return [S / 2 + x * co - y * si, S / 2 + x * si + y * co];
    };
    const k = css > 32 ? S / css : 1;
    const inside = (x, y) => x >= 8 && y >= 8 && x <= S - 8 && y <= S - 8;
    const label = (text, x, y, fill, size) => {
      c.font = '700 ' + size + 'px ' + MAP_FONT;
      c.textAlign = 'center'; c.textBaseline = 'middle';
      c.lineWidth = Math.max(3, size / 6);
      c.strokeStyle = 'rgba(0,0,0,.82)';
      c.strokeText(text, x, y);
      c.fillStyle = fill;
      c.fillText(text, x, y);
    };
    const sites = M.sites || {};
    for (const name in sites) {
      const spot = project(sites[name].center.x, sites[name].center.z);
      if (inside(spot[0], spot[1])) label(name, spot[0], spot[1], '#ffb14a', Math.round((full ? 26 : 15) * k));
    }
    const marks = spawnMarks();
    if (marks) {
      if (marks.atk) {
        const s = project(marks.atk.x, marks.atk.z);
        if (inside(s[0], s[1])) label('攻', s[0], s[1], '#ff8a3d', Math.round((full ? 18 : 12) * k));
      }
      if (marks.def) {
        const s = project(marks.def.x, marks.def.z);
        if (inside(s[0], s[1])) label('守', s[0], s[1], '#8ec5ff', Math.round((full ? 18 : 12) * k));
      }
    }
    const origin = project(view.pos.x, view.pos.z);
    const north = project(view.pos.x, view.pos.z - 6);
    const nx = north[0] - origin[0], ny = north[1] - origin[1], nlen = Math.hypot(nx, ny) || 1;
    label('北', S / 2 + nx / nlen * (S / 2 - 12 * k), S / 2 + ny / nlen * (S / 2 - 12 * k), 'rgba(244,234,216,.9)', Math.round((full ? 16 : 11) * k));
    const agents = G.Game.agents || [];
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      if (a === view) continue;
      const friend = a.team === p.team;
      if (!a.alive) {
        if (friend) {
          const s = project(a.pos.x, a.pos.z);
          if (!inside(s[0], s[1])) continue;
          c.strokeStyle = 'rgba(255,255,255,.7)'; c.lineWidth = 2;
          c.beginPath();
          c.moveTo(s[0] - 4, s[1] - 4); c.lineTo(s[0] + 4, s[1] + 4);
          c.moveTo(s[0] + 4, s[1] - 4); c.lineTo(s[0] - 4, s[1] + 4);
          c.stroke();
        }
        delete seenEnemy[a.id];
        continue;
      }
      if (friend) {
        const ahead = project(a.pos.x - Math.sin(a.yaw) * 1.2, a.pos.z - Math.cos(a.yaw) * 1.2);
        const at = project(a.pos.x, a.pos.z);
        if (!inside(at[0], at[1])) continue;
        drawArrow(c, at[0], at[1], Math.atan2(ahead[1] - at[1], ahead[0] - at[0]), (full ? 13 : 10) * k, a.team === 'atk' ? '#ff8a3d' : '#7cc4ff');
      } else {
        const fresh = a.spottedUntil > G.time + 0.85 || seesEnemy(view, a);
        if (fresh) seenEnemy[a.id] = { x: a.pos.x, z: a.pos.z, at: G.time };
        const rec = seenEnemy[a.id];
        if (!rec) continue;
        const age = G.time - rec.at;
        if (!(age >= 0 && age < 3)) { delete seenEnemy[a.id]; continue; }
        const s = project(rec.x, rec.z);
        if (!inside(s[0], s[1])) continue;
        const alpha = fresh ? 1 : 1 - age / 3;
        c.fillStyle = 'rgba(255,59,48,' + alpha.toFixed(3) + ')';
        c.beginPath(); c.arc(s[0], s[1], (full ? 6.5 : 4.5) * k, 0, 7); c.fill();
      }
    }
    const self = project(view.pos.x, view.pos.z);
    const selfAhead = project(view.pos.x - Math.sin(view.yaw) * 1.2, view.pos.z - Math.cos(view.yaw) * 1.2);
    if (inside(self[0], self[1])) drawArrow(c, self[0], self[1], Math.atan2(selfAhead[1] - self[1], selfAhead[0] - self[0]), (full ? 16 : 12) * k, '#fff');
    drawBomb(c, p, view, project, inside, full, k);
  }
  function drawArrow(c, x, y, ang, len, fill) {
    c.save();
    c.translate(x, y); c.rotate(ang);
    c.fillStyle = fill; c.strokeStyle = 'rgba(0,0,0,.85)'; c.lineWidth = 2; c.lineJoin = 'round';
    c.beginPath();
    c.moveTo(len, 0);
    c.lineTo(-len * 0.72, len * 0.55);
    c.lineTo(-len * 0.32, 0);
    c.lineTo(-len * 0.72, -len * 0.55);
    c.closePath();
    c.stroke(); c.fill();
    c.restore();
  }
  function drawBomb(c, p, view, project, inside, full, k) {
    const b = G.Game.bomb;
    if (!b || !b.state || b.state === 'none' || b.state === 'exploded' || b.state === 'defused') return;
    let x = 0, z = 0, show = false, planted = false;
    if (b.state === 'planted') { x = b.pos.x; z = b.pos.z; show = true; planted = true; }
    else if (b.state === 'dropped' && p.team === 'atk') { x = b.pos.x; z = b.pos.z; show = true; }
    else if (b.state === 'carried' && b.carrier && b.carrier.alive) {
      const mate = b.carrier.team === p.team;
      if (mate || b.carrier === view) { x = b.carrier.pos.x; z = b.carrier.pos.z; show = true; }
      else {
        const rec = seenEnemy[b.carrier.id];
        const age = rec ? G.time - rec.at : 9;
        if (rec && age >= 0 && age < 3) { x = rec.x; z = rec.z; show = true; }
      }
    }
    if (!show) return;
    const s = project(x, z);
    if (!inside(s[0], s[1])) return;
    const pulse = 1 + 0.28 * Math.sin(G.time * 7);
    const rad = (full ? 11 : 8) * k * pulse;
    c.strokeStyle = planted ? '#ff3b30' : '#ffd23f';
    c.lineWidth = Math.max(1.5, 1.6 * k);
    c.beginPath(); c.arc(s[0], s[1], rad, 0, 7); c.stroke();
    c.fillStyle = planted ? '#ff3b30' : '#ffd23f';
    c.beginPath(); c.arc(s[0], s[1], (full ? 4 : 3) * k, 0, 7); c.fill();
  }

  // ---------- per-frame ----------
  // Only touch the page when a value really changes: every write makes the browser restyle the HUD.
  function txt(e, v) { v = String(v); if (e._t !== v) { e._t = v; e.textContent = v; } }
  function cls(e, name, on) { const k = '_c' + name; if (e[k] !== on) { e[k] = on; e.classList.toggle(name, on); } }
  function sty(e, prop, v) { const k = '_s' + prop; if (e[k] !== v) { e[k] = v; e.style[prop] = v; } }
  function hid(e, h) { if (e._h !== h) { e._h = h; e.hidden = h; } }
  function nadeIcon(id) {
    const url = G.Icons && G.Icons.get ? G.Icons.get(id) : '';
    return url ? '<img class="wico wico-sm" alt="" draggable="false" src="' + url + '">' :
      '<i class="nade-glyph">' + W.defs[id].icon + '</i>';
  }
  const nadeKeys = { he: 6, flash: 7, smoke: 8, molotov: 9, incendiary: 9 };
  function updateNadeHUD(p) {
    const wheel = G.Nades.wheel, showWheel = p.alive && wheel.open;
    const showCharge = p.alive && !!p.primed;
    hid(el.nadeWheel, !showWheel);
    hid(el.nadeCharge, !showCharge);
    if (showWheel) {
      const e = el.nadeWheel, list = wheel.options;
      if (e._options !== list) {
        e._options = list;
        e.innerHTML = '<span class="nade-wheel-caption">松开 <kbd>4</kbd> 选择</span>' + list.map(({ id, name, count }, i) => {
          const angle = i * 2 * Math.PI / list.length;
          const x = Math.round(78 * Math.sin(angle)), y = Math.round(-78 * Math.cos(angle));
          return '<span class="nade-wheel-item" data-index="' + i + '" style="--x:' + x + 'px;--y:' + y + 'px">' +
            nadeIcon(id) + '<b>×' + count + '</b><small>' + esc(name) + '</small></span>';
        }).join('');
        sty(e, 'left', wheel.x + 'px'); sty(e, 'top', wheel.y + 'px');
      }
      if (e._choice !== wheel.index) { e._choice = wheel.index; e.dataset.choice = wheel.index; }
    }
    if (showCharge) {
      const e = el.nadeCharge, angle = Math.round(p.throwPower * 108);
      if (e._angle !== angle) { e._angle = angle; e.style.setProperty('--charge', angle + 'deg'); }
    }
  }
  const slotCache = {};
  function updateSlots(view, p) {
    let counts = 0;
    for (const id of W.grenades) counts = counts * 3 + (view.nades[id] || 0);
    const rev = G.Icons ? G.Icons.rev : 0;
    const c = slotCache, inv = view.inv;
    if (c.primary === inv.primary && c.pistol === inv.pistol && c.grenade === inv.grenade && c.bomb === inv.bomb &&
        c.counts === counts && c.cur === view.cur && c.alive === p.alive && c.touch === G.Touch.enabled && c.rev === rev) return;
    const touch = G.Touch.enabled;
    const slotTxt = ['primary', 'pistol', 'knife', 'grenade', 'bomb'].map((s, i) => {
      const has = s === 'bomb' ? view.inv.bomb : view.inv[s];
      if (!has) return '';
      let body;
      if (s === 'grenade') {
        body = W.grenadeList(view).map(({ id, name, count }) =>
          '<span class="nade-chip' + (id === has.id ? ' selected' : '') + '" title="' + esc(name) + '">' +
          (touch ? '' : '<kbd>' + nadeKeys[id] + '</kbd>') + nadeIcon(id) + '<b>×' + count + '</b></span>').join('');
      } else if (s === 'bomb') body = ico('bomb', 'wico-sm') + '<em class="slot-name">炸弹</em>';
      else {
        const full = has.def.name, short = full.split(' ')[0];
        body = ico(has.id, 'wico-sm') + '<em class="slot-name">' + esc(touch ? (s === 'knife' ? '匕首' : short) : full) + '</em>';
      }
      const key = '<i class="slot-key">' + (i + 1) + '</i>';
      if (touch) return '<button type="button" data-slot="' + s + '" class="' + (view.cur === s ? 'on' : '') + '"' + (p.alive ? '' : ' disabled') + '>' + key + body + '</button>';
      return '<div class="' + (view.cur === s ? 'on' : '') + '">' + key + body + '</div>';
    }).join('');
    c.primary = inv.primary; c.pistol = inv.pistol; c.grenade = inv.grenade; c.bomb = inv.bomb;
    c.counts = counts; c.cur = view.cur; c.alive = p.alive; c.touch = touch; c.rev = G.Icons ? G.Icons.rev : 0;
    if (el.slots._t !== slotTxt) { el.slots.innerHTML = slotTxt; el.slots._t = slotTxt; }
  }
  function syncAmmoIcon(it, view) {
    if (!el.ammoIcon) return;
    let id = '';
    if (view.cur === 'bomb') id = 'bomb';
    else if (it && it.id) id = it.id;
    else if (view.inv.knife && view.cur === 'knife') id = view.inv.knife.id;
    const rev = G.Icons ? G.Icons.rev : 0;
    if (el.ammoIcon._id === id && el.ammoIcon._rev === rev) return;
    const url = id && G.Icons && G.Icons.get ? G.Icons.get(id) : '';
    el.ammoIcon._id = id; el.ammoIcon._rev = G.Icons ? G.Icons.rev : 0;
    if (url) { el.ammoIcon.src = url; el.ammoIcon.hidden = false; }
    else el.ammoIcon.hidden = true;
  }
  function bombLabel(b, p) {
    if (!b || !b.state || b.state === 'none' || b.state === 'exploded' || b.state === 'defused') return '';
    const touch = G.Touch.enabled;
    if (b.state === 'planted') return (p.defusing || b.defuser) ? '拆除中' : (b.site ? b.site + ' 点' : '已安放');
    if (!p || p.team !== 'atk') return '';
    if (b.state === 'carried') return b.carrier === p ? (touch ? '携带' : '你携带炸弹') : (touch ? '队友' : '队友携带');
    if (b.state === 'dropped') return touch ? '掉落' : '炸弹掉落';
    return '';
  }
  let radarTick = 0;
  H.update = function (dt) {
    const p = G.Player.agent;
    if (!p || !el) return;
    if (G.Icons && (iconTick = (iconTick + 1) % 30) === 0) G.Icons.ensure();
    const Gm = G.Game, view = p.alive ? p : G.Player.spectateTarget() || p;
    const hp = Math.max(0, view.hp);
    txt(el.hp, hp); cls(el.hp, 'low', view.hp <= 25);
    if (el.vitHp) cls(el.vitHp, 'low', view.hp <= 25);
    if (el.hpBar) sty(el.hpBar, 'width', Math.min(100, hp) + '%');
    txt(el.armor, view.armor);
    txt(el.armorIco, view.helmet ? '护甲+盔' : '护甲');
    if (el.armorMark) cls(el.armorMark, 'helm', !!view.helmet);
    if (el.armorBar) sty(el.armorBar, 'width', Math.max(0, Math.min(100, view.armor)) + '%');
    txt(el.money, '$' + p.money);
    if (moneyT > 0) { moneyT -= dt; if (moneyT <= 0) el.moneyDelta.textContent = ''; }
    const it = W.current(view);
    if (it && it.def.rpm) {
      txt(el.clip, it.reloading ? '…' : it.clip); txt(el.reserve, '/ ' + it.reserve);
      cls(el.clip, 'low', it.clip <= Math.ceil(it.def.clip * 0.2));
    } else { txt(el.clip, view.cur === 'bomb' ? '炸弹' : '—'); txt(el.reserve, ''); cls(el.clip, 'low', false); }
    if (el.ammo) cls(el.ammo, 'reloading', !!(it && it.reloading));
    syncAmmoIcon(it, view);
    updateSlots(view, p);
    if (p.alive && el.deathCard && !el.deathCard.hidden) el.deathCard.hidden = true;

    const b = Gm.bomb;
    if (b.state === 'planted') { txt(el.timer, G.fmtTime(b.timer || 0)); cls(el.timer, 'bomb', true); sty(el.timer, 'color', ''); }
    else {
      cls(el.timer, 'bomb', false);
      txt(el.timer, Gm.phase === 'freeze' ? G.fmtTime(Gm.phaseT) : G.fmtTime(Gm.timeLeft));
      sty(el.timer, 'color', Gm.phase === 'freeze' ? 'var(--sun)' : '');
    }
    if (el.bombStat) {
      const label = bombLabel(b, p);
      hid(el.bombStat, !label);
      if (label) txt(el.bombStat, label);
      cls(el.bombStat, 'hot', b.state === 'planted');
    }
    txt(el.scoreAtk, Gm.score.atk); txt(el.scoreDef, Gm.score.def);
    ['atk', 'def'].forEach((t) => {
      const n = Gm.alive(t), pips = (t === 'atk' ? el.aliveAtk : el.aliveDef).children;
      for (let i = 0; i < pips.length; i++) cls(pips[i], 'dead', i >= n);
    });

    // crosshair & scope
    const scoped = it && it.def.scope && it.zoom > 0 && p.alive;
    hid(el.scope, !scoped);
    const showCh = p.alive && !scoped;
    const ch = el.crosshair;
    hid(ch, !showCh);
    if (showCh) {
      const settings = G.settings, ia = it && it.def.inacc;
      let extra = 0;
      if (ia && !settings.chStatic) {
        extra = Math.max(0, W.spread(p, it) - G.lerp(ia.stand, ia.crouch, p.crouch));
      }
      const target = Math.min(24, (4 + 60 * Math.sqrt(extra)) * settings.chGap);
      if (ch._gap === undefined || settings.chStatic) {
        ch._gap = target; ch._gapVelocity = 0;
      } else {
        // Exact critically damped step, about 90% settled in 120 ms.
        const offset = ch._gap - target, omega = 32;
        const advance = ch._gapVelocity + omega * offset, decay = Math.exp(-omega * dt);
        ch._gap = target + (offset + advance * dt) * decay;
        ch._gapVelocity = (ch._gapVelocity - omega * advance * dt) * decay;
      }
      const scale = innerHeight / 1080;
      const length = Math.max(1, Math.round(24 * settings.chSize * scale) / 4);
      const thickness = Math.max(1, Math.round(8 * Math.sqrt(settings.chSize) * scale) / 4);
      const gap = Math.round(4 * G.clamp(ch._gap, 0, 24) * scale) / 4;
      sty(ch, 'color', settings.chColor);
      hid(el.chDot, !settings.chDot);
      if (ch._length !== length || ch._thickness !== thickness || ch._paintedGap !== gap) {
        ch._length = length; ch._thickness = thickness; ch._paintedGap = gap;
        const long = length + 'px', short = thickness + 'px', centre = -thickness / 2 + 'px';
        sty(el.chL, 'width', long); sty(el.chL, 'height', short); sty(el.chL, 'top', centre);
        sty(el.chR, 'width', long); sty(el.chR, 'height', short); sty(el.chR, 'top', centre);
        sty(el.chT, 'height', long); sty(el.chT, 'width', short); sty(el.chT, 'left', centre);
        sty(el.chB, 'height', long); sty(el.chB, 'width', short); sty(el.chB, 'left', centre);
        sty(el.chDot, 'width', short); sty(el.chDot, 'height', short);
        sty(el.chDot, 'left', centre); sty(el.chDot, 'top', centre);
        const near = gap + 'px', far = (-gap - length) + 'px';
        sty(el.chL, 'left', far); sty(el.chR, 'left', near);
        sty(el.chT, 'top', far); sty(el.chB, 'top', near);
      }
    } else ch._gap = undefined;

    // progress (plant / defuse)
    if (p.alive && (p.planting || p.defusing)) {
      hid(el.progress, false);
      const dur = p.planting ? Gm.CFG.plant : p.kit ? Gm.CFG.defuseKit : Gm.CFG.defuse;
      txt(el.progressLabel, p.planting ? '正在安放炸弹…' : '正在拆除炸弹…');
      sty(el.progressBar, 'width', Math.min(100, Math.round((p.planting ? p.plantT : p.defuseT) / dur * 200) / 2) + '%');
    } else hid(el.progress, true);

    updateNadeHUD(p);
    // context hint
    let hint = '';
    if (p.alive && !H.buyOpen && !H.scoresOpen && !H.mapOpen && !G.Nades.wheel.open && !p.planting && !p.defusing) {
      const action = Gm.bombUse(p), touch = G.Touch.enabled;
      if (action === 'defuse') {
        hint = (touch ? '按住「使用」拆除炸弹' : '按住 E 拆除炸弹') + (p.kit ? '（拆弹器：5 秒）' : '（10 秒）');
      } else if (action) hint = touch ? '按住「使用」安放炸弹' : '按住 E 安放炸弹';
      else {
        const target = W.pickupTarget(p);
        if (target) {
          if (el.hint._def !== target.def || el.hint._touch !== touch) {
            el.hint._def = target.def; el.hint._touch = touch;
            el.hint._pickup = (touch ? '点「使用」拾取 ' : '按 E 拾取 ') + target.def.name;
          }
          hint = el.hint._pickup;
        }
      }
    }
    if (hint !== lastHint) { el.hint.textContent = hint; el.hint.hidden = !hint; lastHint = hint; }
    hid(el.buyHint, !(Gm.canBuy(p) && !H.buyOpen));
    if (H.buyOpen) {
      if (!Gm.canBuy(p)) H.toggleBuy(false);
      else if ((G.Icons ? G.Icons.rev : 0) !== buyRev) renderBuy();
      else if ((buyRefresh -= dt) <= 0) {
        buyRefresh = 0.5;
        const sec = $('buySeconds');
        if (sec) txt(sec, Math.max(0, Math.ceil(Gm.buyUntil - G.time)));
      }
    }
    if (G.Touch.enabled) G.Touch.sync();
    if (H.mapOpen && (G.paused || H.buyOpen || H.scoresOpen)) H.toggleMap(false);
    if (msgTimer > 0) { msgTimer -= dt; if (msgTimer <= 0) el.centerMsg.hidden = true; }
    vign = Math.max(0, vign - dt * 1.2);
    sty(el.vignette, 'opacity', Math.max(vign, p.alive && p.hp <= 25 ? 0.35 : 0).toFixed(2));
    if ((radarTick = (radarTick + 1) % 2) === 0) {
      paintMap(el.radar, rctx, false);
      if (H.mapOpen) paintMap(el.mapFull, fctx, true);
    }
  };
})(window.G);
