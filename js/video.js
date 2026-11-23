// Display controls and presentation. World, effects and viewmodel share the same scene target.
(function (G) {
  'use strict';
  const THREE = G.THREE, V = G.Video = {};
  const get = id => document.getElementById(id);
  const scales = [1, 0.85, 0.7, 0.5];
  let detail = false, elapsed = 0, frames = 0, counter;
  V.defaults = function (touch, soft) {
    const s = G.settings;
    if (scales.indexOf(s.renderScale) < 0) s.renderScale = 1;
    if (typeof s.dynamicResolution !== 'boolean') s.dynamicResolution = !!(touch || soft);
    if (typeof s.showFPS !== 'boolean') s.showFPS = false;
    counter = get('videoStats');
  };
  V.wire = function () {
    const s = G.settings, q = get('videoQuality'), scale = get('videoScale');
    const dr = get('videoDynamic'), fps = get('videoFPS');
    const query = new URL(location.href);
    q.value = query.searchParams.get('quality') || s.quality || 'auto';
    get('qNote').textContent = '当前：' + G.Gfx.preset.label;
    q.onchange = function () {
      s.quality = q.value;
      let state = history.state;
      if (!G.saveSettings()) state = Object.assign({}, state, {sandfireReload: s});
      else if (state && state.sandfireReload) { state = Object.assign({}, state); delete state.sandfireReload; }
      query.searchParams.delete('quality');
      try { history.replaceState(state, '', query.href); } catch (e) {}
      location.reload();
    };
    scale.value = s.renderScale;
    scale.onchange = function () { s.renderScale = +scale.value; G.setRenderScale(1); G.saveSettings(); };
    dr.checked = s.dynamicResolution;
    dr.onchange = function () {
      G.DR.auto = s.dynamicResolution = dr.checked;
      G.setRenderScale(1); G.saveSettings();
    };
    fps.checked = s.showFPS;
    fps.onchange = function () { s.showFPS = fps.checked; counter.hidden = !(s.showFPS || detail); G.saveSettings(); };
    window.addEventListener('keydown', function (e) {
      if (e.code !== 'F3') return;
      e.preventDefault();
      if (!e.repeat) { detail = !detail; elapsed = frames = 0; counter.hidden = !(detail || s.showFPS); }
    });
  };
  V.stats = function (ms) {
    if (!(G.settings.showFPS || detail) || ms <= 0 || ms > 500) return;
    elapsed += ms; frames++;
    if (elapsed < 400) return;
    const avg = elapsed / frames, r = G.renderer;
    let label = Math.round(1000 / avg) + ' FPS · ' + avg.toFixed(1) + ' ms';
    if (detail) label += '\n' + V.width + '×' + V.height + ' · ' + G.Gfx.preset.label +
      '\n绘制 ' + r.info.render.calls + ' · 三角形 ' + r.info.render.triangles;
    counter.textContent = label; counter.hidden = false; elapsed = frames = 0;
  };

  const vs = 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=vec4(position.xy,0.,1.); }';
  const common = 'varying vec2 vUv; uniform sampler2D src; uniform vec2 pixel;';
  // Extract a soft highlight from four separated source samples into a quarter-width target.
  const bloomFS = common + [
    'vec3 bright(vec2 p){ vec3 c=texture2D(src,p).rgb; return c*smoothstep(.82,.99,dot(c,vec3(.25,.61,.14))); }',
    'void main(){vec2 d=pixel*2.; gl_FragColor=vec4(.25*(bright(vUv+d)+bright(vUv-d)+bright(vUv+vec2(d.x,-d.y))+bright(vUv+vec2(-d.x,d.y))),1.);}'
  ].join('\n');
  const presentFS = common + [
    'uniform sampler2D bloom; uniform vec2 halo; uniform float sharpen;',
    'void main(){vec3 c=texture2D(src,vUv).rgb;',
    'if(sharpen>0.){vec3 a=texture2D(src,vUv+vec2(pixel.x,0.)).rgb,b=texture2D(src,vUv-vec2(pixel.x,0.)).rgb;',
    'vec3 d=texture2D(src,vUv+vec2(0.,pixel.y)).rgb,e=texture2D(src,vUv-vec2(0.,pixel.y)).rgb;',
    'vec3 lo=min(min(a,b),min(d,e)),hi=max(max(a,b),max(d,e));',
    'c=clamp(c+(c-.25*(a+b+d+e))*sharpen/(1.+4.*(hi-lo)),min(c,lo),max(c,hi));}',
    '#ifdef BLOOM',
    'vec3 h=texture2D(bloom,vUv).rgb*.4;',
    'h+=.15*(texture2D(bloom,vUv+halo).rgb+texture2D(bloom,vUv-halo).rgb+texture2D(bloom,vUv+vec2(-halo.x,halo.y)).rgb+texture2D(bloom,vUv+vec2(halo.x,-halo.y)).rgb);',
    'c+=h*.075; c*=1.-.045*smoothstep(.1,.5,dot(vUv-.5,vUv-.5));',
    '#endif',
    'gl_FragColor=vec4(c,1.);}'
  ].join('\n');
  let rt, glow, scene, cam, quad, extract, present, canvasKey = '';
  V.init = function (r, p) {
    if (!p.aa) return;
    rt = new THREE.WebGLMultisampleRenderTarget(1,1,{stencilBuffer:false});
    rt.samples = Math.min(r.capabilities.maxSamples, p.key === 'ultra' ? 4 : 2);
    if (p.movingShadow) glow = new THREE.WebGLRenderTarget(1,1,{depthBuffer:false, stencilBuffer:false});
    const uniforms = {src:{value:rt.texture}, bloom:{value:glow && glow.texture}, pixel:{value:new THREE.Vector2()},
      halo:{value:new THREE.Vector2()}, sharpen:{value:0}};
    const pass = fs => new THREE.ShaderMaterial({uniforms,vertexShader:vs,fragmentShader:fs,
      defines:glow ? {BLOOM:1} : {}, depthTest:false,depthWrite:false,toneMapped:false});
    present = pass(presentFS); extract = pass(bloomFS);
    scene = new THREE.Scene(); cam = new THREE.Camera();
    quad = new THREE.Mesh(new THREE.PlaneGeometry(2,2),present); quad.frustumCulled = false; scene.add(quad);
    r.compile(scene,cam);
    if (glow) { quad.material = extract; r.compile(scene,cam); quad.material = present; }
  };
  V.resize = function (r, base, scale) {
    V.width = Math.max(1,Math.floor(innerWidth*base*scale));
    V.height = Math.max(1,Math.floor(innerHeight*base*scale));
    V.offscreen = !!rt && (!!glow || scale < 0.9999);
    // Assigning the canvas size clears it even when nothing changes, so only touch it on a real change
    // (offscreen rendering scales the render targets instead of the canvas).
    const pr = base * (V.offscreen ? 1 : scale), key = pr + 'x' + innerWidth + 'x' + innerHeight;
    if (key !== canvasKey) { canvasKey = key; r.setPixelRatio(pr); r.setSize(innerWidth,innerHeight); }
    G.Gfx.U.uSharpen.value = rt ? 0 : (1-scale)*0.65;
    if (!V.offscreen) return;
    rt.setSize(V.width,V.height);
    const u = present.uniforms;
    u.pixel.value.set(1/V.width,1/V.height); u.sharpen.value = (1-scale)*1.15;
    if (glow) {
      glow.setSize(Math.max(1,V.width>>2),Math.max(1,V.height>>2));
      u.halo.value.set(1.3/glow.width,1.3/glow.height);
    }
  };
  V.begin = r => r.setRenderTarget(V.offscreen ? rt : null);
  V.end = function (r) {
    if (!V.offscreen) return;
    if (glow) { r.setRenderTarget(glow); quad.material=extract; r.render(scene,cam); }
    r.setRenderTarget(null); quad.material=present; r.render(scene,cam);
  };
})(window.G);
