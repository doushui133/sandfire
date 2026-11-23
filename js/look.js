// look.js — mouse-look spike filter (no dependencies, so the unit tests can load it on its own)
(function (root) {
  'use strict';
  // Pointer lock on a virtual machine sometimes reports one impossible movement of hundreds of
  // pixels. Real hardware, including a fast flick and a low frame rate that coalesces a whole
  // swipe into one event, is applied on the same event: nothing is held back and nothing is
  // smoothed. Only a jump no hand can produce is discarded.
  function LookFilter() { this.frameT = -1e9; this.frameDt = 16.7; this.reset(); }
  LookFilter.prototype.reset = function () {
    this.pend = null; this.pendFrames = 0;
    this.lastT = -1e9; this.refV = 0; this.refT = -1e9;
    this.x = 0; this.y = 0; this.held = 0; this.dropped = 0;
  };
  LookFilter.prototype.push = function (mx, my, t) {
    if (!mx && !my) return;
    const m = Math.sqrt(mx * mx + my * my);
    const dt = Math.min(50, Math.max(1, t - this.lastT));
    const v = m / dt;
    this.lastT = t;
    // ~45 px/ms is past a real flick even at 1000 Hz. A long frame keeps a large but slower
    // sample, because the browser has merged genuine motion into it.
    if (m >= 1200 || (m > 100 && v > 45)) { this.dropped++; return; }
    this.add(mx, my, v, t);
  };
  LookFilter.prototype.add = function (x, y, v, t) { this.x += x; this.y += y; this.refV = v; this.refT = t; };
  // call once per rendered frame, after that frame's input events
  LookFilter.prototype.frame = function (t) {
    const d = t - this.frameT;
    if (d > 0 && d < 100) this.frameDt += (d - this.frameDt) * 0.1;
    this.frameT = t;
  };
  root.LookFilter = LookFilter;
})(typeof module === 'object' && module.exports ? module.exports : (window.G = window.G || {}));
