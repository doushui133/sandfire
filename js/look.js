// look.js — mouse-look spike filter (no dependencies, so the unit tests can load it on its own)
(function (root) {
  'use strict';
  // Chromium on Windows sometimes reports a single bogus pointer-lock movement of hundreds of
  // pixels, which snaps the view somewhere else for no reason. A movement much faster than the
  // motion just before it is held back for one event: if the next event carries on in the same
  // direction it was a genuine flick and both are applied; otherwise the held one is thrown away.
  // Below ~42 fps one frame can contain almost a whole real flick, so there the filter only
  // removes a big jump that comes straight back on the next event.
  const MIN_PX = 40;       // events smaller than this are always applied at once
  const MIN_SPEED = 5;     // px per ms; slower events are never held
  const RATIO = 3;         // held when faster than RATIO x the recent speed + OFFSET
  const OFFSET = 2;
  const KEEP = 0.3;        // at 55+ fps a follow-up this fraction of the held speed confirms it;
                           // the bar falls to 0.05 by 45 fps, where a flick's second frame can be small
  const DECAY_MS = 120;    // how quickly the recent speed is forgotten once the mouse stops
  const HOLD_MS = 60;      // a held event nothing followed up on is settled after this (and 2 frames)
  const STALL_MS = 45;     // after a long frame the next event carries real, coalesced motion
  const SLOW_DT = 24;      // frame length (ms) above which the low-frame-rate rules apply

  function LookFilter() { this.frameT = -1e9; this.frameDt = 16.7; this.reset(); }
  LookFilter.prototype.reset = function () {
    this.pend = null; this.pendFrames = 0;
    this.lastT = -1e9; this.refV = 0; this.refT = -1e9;
    this.x = 0; this.y = 0; this.held = 0; this.dropped = 0;
  };
  LookFilter.prototype.push = function (mx, my, t) {
    if (!mx && !my) return;
    const m = Math.sqrt(mx * mx + my * my);
    const v = m / Math.min(50, Math.max(4, t - this.lastT));
    this.lastT = t;
    const slow = this.frameDt > SLOW_DT;
    const p = this.pend;
    if (p) {
      this.pend = null;
      const dot = p.x * mx + p.y * my;
      // a move of about the same size straight back undoes the jump: a bogus pair
      const bounce = dot < -0.8 * p.m * m && m > 0.6 * p.m && m < 1.7 * p.m;
      const keep = Math.min(KEEP, Math.max(0.05, KEEP - (this.frameDt - 17.5) * 0.0556));
      if ((dot > 0 && v >= keep * p.v) || (slow && !bounce)) {
        this.add(p.x, p.y, p.v, p.t);
        this.add(mx, my, v, t);
        return;
      }
      this.dropped++;
      if (bounce && slow) { this.dropped++; return; }
    }
    const ref = this.refV * Math.exp(-Math.max(0, t - this.refT) / DECAY_MS);
    if (m > MIN_PX && v > Math.max(MIN_SPEED, RATIO * ref + OFFSET) && t - this.frameT <= STALL_MS) {
      this.pend = { x: mx, y: my, m: m, v: v, t: t };
      this.pendFrames = 0; this.held++;
      return;
    }
    this.add(mx, my, v, t);
  };
  LookFilter.prototype.add = function (x, y, v, t) { this.x += x; this.y += y; this.refV = v; this.refT = t; };
  // call once per rendered frame, after that frame's input events
  LookFilter.prototype.frame = function (t) {
    const d = t - this.frameT;
    if (d > 0 && d < 100) this.frameDt += (d - this.frameDt) * 0.1;   // typical frame length
    this.frameT = t;
    const p = this.pend;
    if (p && ++this.pendFrames >= 2 && t - p.t > HOLD_MS) {
      this.pend = null;
      if (this.frameDt > SLOW_DT) this.add(p.x, p.y, p.v, p.t);   // low fps: a lone big move is real
      else this.dropped++;
    }
  };
  root.LookFilter = LookFilter;
})(typeof module === 'object' && module.exports ? module.exports : (window.G = window.G || {}));
