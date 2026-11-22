// gfx.js — lighting model and shaders. The town is lit by an offline-baked lightmap (sky and bounce
// light) plus a static sun shadow map rendered once at load; moving things use a light "lit" shader
// that reads the same shadow map and a baked grid of ambient probes. Every shader is written to
// stay cheap per pixel, because without a graphics card WebGL runs on the CPU.
(function (G) {
  'use strict';
  const THREE = G.THREE;
  const Gfx = G.Gfx = {};
  const MG = G.MapGeo;

  // ---------- quality ----------
  Gfx.detect = function () {
    let name = '', soft = false, webgl2 = false;
    try {
      const c = document.createElement('canvas');
      const gl = c.getContext('webgl2') || c.getContext('webgl');
      webgl2 = !!(gl && typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext);
      if (gl) {
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
        const lose = gl.getExtension('WEBGL_lose_context'); if (lose) lose.loseContext();
      }
      soft = /swiftshader|basic render|llvmpipe|softpipe|software|warp|mesa offscreen|hyper-v|vmware|virtualbox/i.test(name);
    } catch (e) { /* keep defaults */ }
    return { name, soft, webgl2 };
  };
  function preset(key, label, dprMax, aniso, shadow, movingShadow, surfaceSize, particles) {
    return {key, label, dprMax, aniso, shadow, movingShadow, surfaceSize, particles,
      aa: key !== 'low', normals: key !== 'low', spec: true, pcf9: key === 'ultra', scaleMin: 0.75, scaleMax: 1};
  }
  Gfx.PRESETS = {
    low: preset('low', '流畅', 1.25, 4, 1024, 0, 256, 0.55),
    medium: preset('medium', '均衡', 1.75, 8, 1536, 0, 512, 0.72),
    high: preset('high', '高', 2, 16, 2048, 512, 1024, 1),
    ultra: preset('ultra', '极致', 2.5, 16, 2560, 768, 2048, 1),
  };
  Gfx.autoQuality = function (gpu, touch) {
    if (gpu.soft) return 'low';
    if (touch) return /adreno\D{0,12}(?:7[3-9]\d|8\d\d)|immortalis|mali-g(?:72[05]|92[05])|apple (?:a(?:1[7-9]|2\d)|m[1-9])/i.test(gpu.name) ? 'high' : 'medium';
    return /rtx\s*(?:[3-5]0[7-9]0|[45]060)|rx\s*(?:[67][789]\d0|9[07]70)/i.test(gpu.name) ? 'ultra' : 'high';
  };

  // ---------- shared uniforms (one object, referenced by every material) ----------
  const L = MG.LIGHT;
  const col = (a, k) => new THREE.Color(a[0] * (k || 1), a[1] * (k || 1), a[2] * (k || 1));
  const U = Gfx.U = {
    uSunDir: { value: new THREE.Vector3().fromArray(L.sunDir) },
    uSunColor: { value: col(L.sun) },
    uSkyTop: { value: col(L.skyTop) },
    uSkyHorizon: { value: col(L.skyHorizon) },
    uGround: { value: col(L.ground) },
    uFogColor: { value: col([0.74, 0.7, 0.62]) },
    uFogDensity: { value: 0.0042 },
    uShadowMap: { value: null },
    uShadowMatrix: { value: new THREE.Matrix4() },
    uShadowTexel: { value: new THREE.Vector2(1 / 2048, 1 / 2048) },
    uLightMap: { value: null },
    uProbeMap: { value: null },
    uLMScale: { value: 2.0 },
    uIndirect: { value: 0.82 },
    uFlashPos: { value: new THREE.Vector3(0, -100, 0) },
    uFlashColor: { value: new THREE.Color(0, 0, 0) },
    uFlashRange: { value: 8 },
    uTime: { value: 0 },
    uSharpen: { value: 0 },
    uMovingMatrix: { value: new THREE.Matrix4() },
    uMovingMap: { value: null },
    uMovingTexel: { value: 0 },
  };
  function neutral(r, g, b) {
    const t = new THREE.DataTexture(new Uint8Array([r, g, b, 255]), 1, 1, THREE.RGBAFormat);
    t.needsUpdate = true; return t;
  }
  U.uLightMap.value = neutral(118, 118, 122);
  U.uProbeMap.value = neutral(124, 122, 120);
  U.uShadowMap.value = neutral(255, 255, 255);

  // filmic curve with a light grade: warm highlights, cool shadows, a little more saturation
  THREE.ShaderChunk.tonemapping_pars_fragment = THREE.ShaderChunk.tonemapping_pars_fragment.replace(
    'vec3 CustomToneMapping( vec3 color ) { return color; }',
    [
      'vec3 CustomToneMapping( vec3 color ) {',
      '  color *= toneMappingExposure;',
      '  color = ( color * ( 2.51 * color + 0.03 ) ) / ( color * ( 2.43 * color + 0.59 ) + 0.14 );',
      '  color = clamp( color, 0.0, 1.0 );',
      '  float l = dot( color, vec3( 0.2126, 0.7152, 0.0722 ) );',
      '  color = mix( vec3( l ), color, 1.1 );',
      '  color *= mix( vec3( 0.95, 0.98, 1.05 ), vec3( 1.04, 1.0, 0.94 ), smoothstep( 0.05, 0.7, l ) );',
      '  return sqrt( clamp( color, 0.0, 1.0 ) );',
      '}',
    ].join('\n'));

  // ---------- GLSL pieces ----------
  const GLSL_COMMON = [
    '#include <packing>',
    'uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSkyTop; uniform vec3 uSkyHorizon; uniform vec3 uGround;',
    'uniform vec3 uFogColor; uniform float uFogDensity;',
    'uniform sampler2D uShadowMap; uniform mat4 uShadowMatrix; uniform vec2 uShadowTexel;',
    'uniform vec3 uFlashPos; uniform vec3 uFlashColor; uniform float uFlashRange;',
    'float shadowTap( vec2 uv, float z ) { return step( z, unpackRGBAToDepth( texture2D( uShadowMap, uv ) ) ); }',
    'float pcf4( vec2 p, float z ) {',
    '  vec2 tc = p / uShadowTexel - 0.5; vec2 f = fract( tc ); vec2 b = ( floor( tc ) + 0.5 ) * uShadowTexel;',
    '  float a = shadowTap( b, z ), c = shadowTap( b + vec2( uShadowTexel.x, 0.0 ), z );',
    '  float d = shadowTap( b + vec2( 0.0, uShadowTexel.y ), z ), e = shadowTap( b + uShadowTexel, z );',
    '  return mix( mix( a, c, f.x ), mix( d, e, f.x ), f.y );',
    '}',
    'float sunShadow( vec3 wp, vec3 n ) {',
    '  vec4 sc = uShadowMatrix * vec4( wp + n * 0.07, 1.0 );',
    '  if ( sc.x < 0.0 || sc.x > 1.0 || sc.y < 0.0 || sc.y > 1.0 ) return 1.0;',
    '  float z = sc.z - 0.0008;',
    '#ifdef PCF9',
    '  vec2 o = uShadowTexel * 0.75;',
    '  return 0.25 * ( pcf4( sc.xy + vec2( -o.x, -o.y ), z ) + pcf4( sc.xy + vec2( o.x, -o.y ), z ) + pcf4( sc.xy + vec2( -o.x, o.y ), z ) + pcf4( sc.xy + o, z ) );',
    '#else',
    '  return pcf4( sc.xy, z );',
    '#endif',
    '}',
    'vec3 skyColor( vec3 d ) {',
    '  float h = d.y;',
    '  vec3 c = mix( uSkyHorizon, uSkyTop, sqrt( max( h, 0.0 ) ) );',
    '  return mix( c, uGround * 0.9, smoothstep( 0.0, -0.25, h ) );',
    '}',
    'vec3 applyFog( vec3 c, vec3 wp ) {',
    '  vec3 d = wp - cameraPosition; float dist = length( d );',
    '  float f = 1.0 - exp( -dist * uFogDensity );',
    '  float s = pow( max( dot( d / max( dist, 0.001 ), uSunDir ), 0.0 ), 8.0 );',
    '  return mix( c, uFogColor + uSunColor * s * 0.1, f );',
    '}',
    'vec3 flashLight( vec3 wp, vec3 n ) {',
    '  vec3 l = uFlashPos - wp; float d = length( l );',
    '  return uFlashColor * max( dot( n, l / max( d, 0.001 ) ), 0.0 ) * max( 0.0, 1.0 - d / uFlashRange );',
    '}',
  ].join('\n');
  Gfx.GLSL_COMMON = GLSL_COMMON;

  // ---------- world (lightmapped) ----------
  const WORLD_VS = [
    'uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uFogColor; uniform float uFogDensity;',
    'attribute vec2 uv2; attribute vec3 tang; attribute vec3 color; attribute vec4 mat;',
    'varying vec3 vUvL; varying vec2 vUv2; varying vec3 vN; varying vec3 vT; varying vec3 vW; varying vec3 vTint; varying vec3 vMat; varying vec4 vFog;',
    'void main() {',
    '  vec4 wp = modelMatrix * vec4( position, 1.0 );',
    '  vW = wp.xyz; vN = normal; vT = tang; vUvL = vec3( uv, mat.x ); vUv2 = uv2; vTint = color; vMat = mat.yzw;',
    // haze per vertex: smooth enough over the town's quads and much cheaper than per pixel
    '  vec3 d = wp.xyz - cameraPosition; float dist = length( d );',
    '  float s = max( dot( d / max( dist, 0.001 ), uSunDir ), 0.0 ); s *= s; s *= s; s *= s;',
    '  vFog = vec4( uFogColor + uSunColor * s * 0.1, 1.0 - exp( -dist * uFogDensity ) );',
    '  gl_Position = projectionMatrix * viewMatrix * wp;',
    '}',
  ].join('\n');
  const WORLD_FS = [
    'precision highp sampler2DArray;',
    GLSL_COMMON,
    'uniform sampler2DArray uAlbedo; uniform float uSharpen;',
    '#ifdef MOVING_SHADOW',
    'uniform mat4 uMovingMatrix; uniform sampler2D uMovingMap; uniform float uMovingTexel;',
    'float movingShadow(vec3 wp){vec3 p=(uMovingMatrix*vec4(wp,1.)).xyz;',
    ' if(max(abs(p.x),abs(p.y))>=.992 || abs(p.z)>1.) return 1.;',
    ' p=p*.5+.5; vec2 t=p.xy/uMovingTexel-.5, f=fract(t), b=(floor(t)+.5)*uMovingTexel;',
    ' vec2 d=vec2(uMovingTexel,0.); float z=p.z-.001;',
    ' return mix(mix(step(z,unpackRGBAToDepth(texture2D(uMovingMap,b))),step(z,unpackRGBAToDepth(texture2D(uMovingMap,b+d.xy))),f.x),',
    ' mix(step(z,unpackRGBAToDepth(texture2D(uMovingMap,b+d.yx))),step(z,unpackRGBAToDepth(texture2D(uMovingMap,b+d.xx))),f.x),f.y);}',
    '#endif',
    '#ifdef LARGE_SURFACES',
    'uniform sampler2DArray uLargeAlbedo; uniform sampler2DArray uLargeNormal;',
    '#endif',
    '#ifdef NORMALMAP',
    'uniform sampler2DArray uNormal;',
    '#endif',
    'uniform sampler2D uLightMap; uniform sampler2D uMacro; uniform float uLMScale; uniform float uIndirect;',
    'varying vec3 vUvL; varying vec2 vUv2; varying vec3 vN; varying vec3 vT; varying vec3 vW; varying vec3 vTint; varying vec3 vMat; varying vec4 vFog;',
    'void main() {',
    '#ifdef LARGE_SURFACES',
    '  vec3 bankUV=vec3(vUvL.xy,vUvL.z-5.);',
    '  vec4 tex=vUvL.z<4.5 ? texture(uLargeAlbedo,vUvL) : texture(uAlbedo,bankUV);',
    '#else',
    '  vec4 tex=texture(uAlbedo,vUvL);',
    '#endif',
    '#ifdef DECAL',
    '  if ( tex.a < 0.02 ) discard;',
    '#endif',
    '#ifdef LOW',
    '  if (uSharpen>0.) {vec3 blur=texture(uAlbedo,vUvL,1.25).rgb; vec3 diff=tex.rgb-blur;',
    '    tex.rgb=clamp(tex.rgb+uSharpen*diff/(1.+4.*abs(diff)),0.,1.);}',
    '#endif',
    '  vec3 alb = tex.rgb * tex.rgb * vTint;',
    '  vec4 mac = texture2D( uMacro, vW.xz * 0.021 + vec2( vW.y * 0.017, 0.0 ) );',
    '  alb *= 0.86 + 0.3 * mac.r;',
    '  vec3 Ng = normalize( vN ); vec3 N = Ng;',
    '#ifdef NORMALMAP',
    '#ifdef LARGE_SURFACES',
    '  vec2 slope=(vUvL.z<4.5 ? texture(uLargeNormal,vUvL).rg : texture(uNormal,bankUV).rg)*2.-1.;',
    '#else',
    '  vec2 slope=texture(uNormal,vUvL).rg*2.-1.;',
    '#endif',
    '  vec3 nm=vec3(slope,sqrt(max(.001,1.-dot(slope,slope))));',
    '  vec3 T = normalize( vT ); vec3 B = cross( Ng, T );',
    '  N = normalize( T * nm.x + B * nm.y + Ng * nm.z );',
    '#endif',
    '  if ( vMat.z > vMat.y ) {',
    '    float hb = vW.y - vMat.y;',
    '    alb *= mix( 0.7, 1.0, smoothstep( 0.0, 0.9 + mac.b * 0.9, hb ) );',
    '#ifndef LOW',
    '    float st = texture2D( uMacro, vec2( ( vW.x + vW.z ) * 0.31, 0.37 ) ).g;',
    '    float top=1.-smoothstep(.15,2.6,vMat.z-vW.y);',
    '    alb = mix(alb,alb*vec3(1.04,1.03,1.015)+.014,top*.65);',
    '    alb *= 1.0 - .29 * st * top;',
    '#endif',
    '  }',
    '  float sh = sunShadow( vW, Ng );',
    '#ifdef MOVING_SHADOW',
    '  sh *= movingShadow(vW + Ng*.02);',
    '#endif',
    '  float ndl = max( dot( N, uSunDir ), 0.0 ) * step( 0.0, dot( Ng, uSunDir ) );',
    '  vec3 ind = texture2D( uLightMap, vUv2 ).rgb; ind = ind * ind * uLMScale * uIndirect;',
    '  vec3 V = normalize( cameraPosition - vW );',
    '  float gloss = mix(0.015, vMat.x, sqrt(tex.a));',
    '  float occ = clamp( dot( ind, vec3( 0.73 ) ), 0.0, 1.0 );',
    '#ifdef SPECULAR',
    '  vec3 c = alb * ( uSunColor * ndl * sh + ind + flashLight( vW, Ng ) );',
    '  float fres = pow( 1.0 - max( dot( N, V ), 0.0 ), 5.0 );',
    '  c += skyColor( reflect( -V, N ) ) * ( 0.055 + 0.75 * fres ) * gloss * occ;',
    '  vec3 H = normalize( V + uSunDir );',
    '  c += uSunColor * pow( max( dot( N, H ), 0.0 ), 10.0 + 160.0 * gloss ) * gloss * 0.9 * sh * ndl;',
    '#else',
    '  vec3 c = alb * ( uSunColor * ndl * sh + ind );',
    '  float f = 1.0 - max( dot( Ng, V ), 0.0 ); f *= f; f *= f;',
    '  c += uSkyHorizon * gloss * ( 0.06 + 0.7 * f ) * occ;',
    '#endif',
    '  c = mix( c, vFog.rgb, vFog.a );',
    '#ifdef DECAL',
    '  gl_FragColor = vec4( c, tex.a );',
    '#else',
    '  gl_FragColor = vec4( c, 1.0 );',
    '#endif',
    '#include <tonemapping_fragment>',
    '#include <encodings_fragment>',
    '}',
  ].join('\n');
  Gfx.worldMaterial = function (tex, preset, decal) {
    const defines = {};
    if (tex.largeAlbedo) defines.LARGE_SURFACES = '';
    if (preset.normals && tex.normal) defines.NORMALMAP = '';
    if (preset.movingShadow) defines.MOVING_SHADOW = '';
    if (preset.spec) defines.SPECULAR = '';
    if (preset.pcf9) defines.PCF9 = '';
    if (preset.key === 'low') defines.LOW = '';
    if (decal) defines.DECAL = '';
    const m = new THREE.ShaderMaterial({
      defines,
      uniforms: Object.assign({ uAlbedo: { value: tex.albedo }, uNormal: { value: tex.normal }, uLargeAlbedo: {value:tex.largeAlbedo}, uLargeNormal: {value:tex.largeNormal}, uMacro: { value: G.Tex.macro() } }, U),
      vertexShader: WORLD_VS, fragmentShader: WORLD_FS,
    });
    if (decal) { m.transparent = true; m.depthWrite = false; m.polygonOffset = true; m.polygonOffsetFactor = -2; m.polygonOffsetUnits = -2; }
    return m;
  };

  // ---------- "lit" material for moving things: soldiers, guns, props ----------
  // Per-vertex attributes: color (linear albedo), rm = (roughness, metalness, fabric, camo)
  const LIT_VS = [
    '#include <common>',
    '#include <skinning_pars_vertex>',
    GLSL_COMMON,
    'attribute vec3 color; attribute vec4 rm;',
    'uniform sampler2D uProbeMap; uniform float uLMScale; uniform float uIndirect; uniform vec3 uAmbient;',
    'varying vec3 vW; varying vec3 vN; varying vec3 vCol; varying vec4 vRM; varying vec3 vObj; varying vec3 vObjN; varying vec3 vAmb; varying vec2 vUv; varying float vSh; varying vec4 vFog;',
    'void main() {',
    '#include <skinbase_vertex>',
    '#include <begin_vertex>',
    '#include <beginnormal_vertex>',
    '#include <skinnormal_vertex>',
    '#include <skinning_vertex>',
    '#ifdef USE_INSTANCING',
    '  vec4 wp = modelMatrix * instanceMatrix * vec4( transformed, 1.0 );',
    '  vN = normalize( mat3( modelMatrix ) * mat3( instanceMatrix ) * objectNormal );',
    '#else',
    '  vec4 wp = modelMatrix * vec4( transformed, 1.0 );',
    '  vN = normalize( mat3( modelMatrix ) * objectNormal );',
    '#endif',
    '  vW = wp.xyz; vCol = color; vRM = rm; vObj = position; vObjN = normal; vUv = uv; vSh = 1.0; vFog = vec4( 0.0 );',
    '#ifdef USE_INSTANCING_COLOR',
    '  vCol *= instanceColor;',
    '#endif',
    '#ifdef VIEWMODEL',
    '  vAmb = uAmbient;',
    '#else',
    '  vec3 p = texture2D( uProbeMap, ( wp.xz + 50.0 ) / 100.0 ).rgb;',
    '  vAmb = p * p * uLMScale * uIndirect;',
    '#ifdef LOW',
    // small, moving objects: the sun shadow per vertex is plenty and much cheaper
    '  vSh = sunShadow( wp.xyz, vN );',
    '#endif',
    '  vec3 d = wp.xyz - cameraPosition; float dist = length( d );',
    '  float s = max( dot( d / max( dist, 0.001 ), uSunDir ), 0.0 ); s *= s; s *= s; s *= s;',
    '  vFog = vec4( uFogColor + uSunColor * s * 0.1, 1.0 - exp( -dist * uFogDensity ) );',
    '#endif',
    '  gl_Position = projectionMatrix * viewMatrix * wp;',
    '}',
  ].join('\n');
  const LIT_FS = [
    GLSL_COMMON,
    'uniform sampler2D uDetail; uniform float uDetailScale; uniform vec3 uCamoA; uniform vec3 uCamoB; uniform float uSunVis;',
    'uniform sampler2D map; uniform float uOpacity;',
    'uniform sampler2D normalMap; uniform vec2 normalScale; uniform sampler2D roughnessMap;',
    'varying vec3 vW; varying vec3 vN; varying vec3 vCol; varying vec4 vRM; varying vec3 vObj; varying vec3 vObjN; varying vec3 vAmb; varying vec2 vUv; varying float vSh; varying vec4 vFog;',
    'void main() {',
    '  vec3 alb = vCol; float rough = vRM.x, metal = vRM.y;',
    '#ifdef USE_MAP',
    '  vec4 mt = texture2D( map, vUv );',
    '  if ( mt.a < 0.5 ) discard;',
    '  alb *= mt.rgb * mt.rgb;',
    '#endif',
    '#ifdef USE_ROUGHNESSMAP',
    '  rough = texture2D( roughnessMap, vUv ).g;',
    '#endif',
    '  vec3 N = normalize( vN );',
    '#ifdef DOUBLE_SIDED',
    '  N *= gl_FrontFacing ? 1.0 : -1.0;',
    '#endif',
    '#ifdef USE_NORMALMAP',
    // tangent frame from screen-space derivatives (no tangent attribute needed)
    '  vec3 mapN = texture2D( normalMap, vUv ).xyz * 2.0 - 1.0; mapN.xy *= normalScale;',
    '  vec3 q0 = dFdx( vW ), q1 = dFdy( vW ); vec2 st0 = dFdx( vUv ), st1 = dFdy( vUv );',
    '  vec3 q1p = cross( q1, N ), q0p = cross( N, q0 );',
    '  vec3 Tn = q1p * st0.x + q0p * st1.x, Bn = q1p * st0.y + q0p * st1.y;',
    '  float tdet = max( dot( Tn, Tn ), dot( Bn, Bn ) );',
    '  if ( tdet > 0.0 ) N = normalize( Tn * ( mapN.x * inversesqrt( tdet ) ) + Bn * ( mapN.y * inversesqrt( tdet ) ) + N * mapN.z );',
    '#endif',
    '  vec3 emit = vec3( 0.0 );',
    '#if defined( CLOTH ) || defined( GUN )',
    '#ifdef LOW',
    // one projection along the dominant axis instead of three blended ones
    '  vec3 an = abs( vObjN );',
    '  vec2 duv = an.x > an.y && an.x > an.z ? vObj.yz : ( an.y > an.z ? vObj.xz : vObj.xy );',
    '  vec4 dt = texture2D( uDetail, duv * uDetailScale );',
    '#else',
    '  vec3 bw = abs( normalize( vObjN ) ); bw /= ( bw.x + bw.y + bw.z );',
    '  vec3 q = vObj * uDetailScale;',
    '  vec4 dt = texture2D( uDetail, q.yz ) * bw.x + texture2D( uDetail, q.xz ) * bw.y + texture2D( uDetail, q.xy ) * bw.z;',
    '#endif',
    '#endif',
    '#ifdef CLOTH',
    // fabric: camouflage pattern, weave and grime (z = fabric, w = camouflage)
    '  alb = mix( alb, mix( alb, mix( uCamoA, uCamoB, step( 0.75, dt.a ) ), step( 0.25, dt.a ) ), vRM.w );',
    '  alb *= 1.0 + ( dt.r - 0.5 ) * 0.4 * vRM.z + ( dt.g - 0.5 ) * 0.28;',
    '  rough = clamp( rough + ( dt.g - 0.5 ) * 0.2, 0.08, 1.0 );',
    '#endif',
    '#ifdef GUN',
    // guns: smudged finish, scratches and worn edges showing bare metal (z = glow, w = wear)
    '  float wear = clamp( smoothstep( 0.62, 0.8, dt.a ) * 0.45 + dt.b * 0.15, 0.0, 1.0 ) * vRM.w;',
    '  alb = mix( alb, vec3( 0.5, 0.5, 0.52 ), wear );',
    '  metal = mix( metal, 1.0, wear );',
    '  rough = clamp( rough + ( dt.r - 0.5 ) * 0.16 + ( dt.g - 0.5 ) * 0.22 - wear * 0.2, 0.05, 1.0 );',
    '  emit = vCol * vRM.z * 4.0;',
    '#endif',
    '#ifdef VIEWMODEL',
    '  float sh = uSunVis;',
    '#elif defined( LOW )',
    '  float sh = vSh;',
    '#else',
    '  float sh = sunShadow( vW, N );',
    '#endif',
    '  vec3 V = normalize( cameraPosition - vW );',
    '  float ndl = max( dot( N, uSunDir ), 0.0 ), nv = max( dot( N, V ), 0.001 );',
    '  vec3 amb = vAmb * ( 0.72 + 0.28 * N.y );',
    '#if defined( LOW ) || defined( VIEWMODEL )',
    '  vec3 c = alb * ( 1.0 - metal ) * ( uSunColor * ndl * sh + amb );',
    '#else',
    '  vec3 c = alb * ( 1.0 - metal ) * ( uSunColor * ndl * sh + amb + flashLight( vW, N ) );',
    '#endif',
    '  vec3 F0 = mix( vec3( 0.04 ), alb, metal );',
    '  vec3 H = normalize( V + uSunDir ); float nh = max( dot( N, H ), 0.0 );',
    '  float a = rough * rough, a2 = a * a, dd = nh * nh * ( a2 - 1.0 ) + 1.0;',
    '  float D = a2 / ( 3.14159 * dd * dd );',
    '  float vh = 1.0 - max( dot( V, H ), 0.0 ), vh2 = vh * vh;',
    '  vec3 F = F0 + ( 1.0 - F0 ) * ( vh2 * vh2 * vh );',
    '  c += uSunColor * D * F * ( 0.25 / max( nv, 0.25 ) ) * ndl * sh;',
    '  vec3 R = reflect( -V, N );',
    '  vec3 env = mix( skyColor( R ), vec3( dot( amb, vec3( 0.333 ) ) ) * 1.1, rough * 0.8 );',
    '  float occ = clamp( dot( vAmb, vec3( 0.333 ) ) * 2.0, 0.12, 1.0 );',
    '  float fv = 1.0 - nv, fv2 = fv * fv;',
    '  vec3 Fe = F0 + ( max( vec3( 1.0 - rough ), F0 ) - F0 ) * ( fv2 * fv2 * fv );',
    '  c += env * Fe * occ * mix( 1.0, 0.7, rough ) + emit;',
    '#ifndef VIEWMODEL',
    '  c = mix( c, vFog.rgb, vFog.a );',
    '#endif',
    '  gl_FragColor = vec4( c, uOpacity );',
    '#include <tonemapping_fragment>',
    '#include <encodings_fragment>',
    '}',
  ].join('\n');
  // opts: skinning, detail ('cloth' | 'gun'), camo: [a, b] colours, map, doubleSide, viewmodel, instancing
  Gfx.litMaterial = function (opts) {
    opts = opts || {};
    const defines = {};
    if (opts.detail === 'gun') defines.GUN = ''; else if (opts.detail) defines.CLOTH = '';
    if (opts.viewmodel) defines.VIEWMODEL = '';
    if (opts.map) defines.USE_MAP = '';
    if (opts.normalMap) defines.USE_NORMALMAP = '';
    if (opts.roughnessMap) defines.USE_ROUGHNESSMAP = '';
    if (Gfx.preset && Gfx.preset.pcf9) defines.PCF9 = '';
    if (Gfx.preset && Gfx.preset.key === 'low') defines.LOW = '';
    const det = opts.detail === 'gun' ? G.Tex.gunDetail() : G.Tex.detail();
    const camo = opts.camo || [[0.3, 0.27, 0.2], [0.18, 0.17, 0.13]];
    const m = new THREE.ShaderMaterial({
      defines,
      uniforms: Object.assign({
        uDetail: { value: det }, uDetailScale: { value: opts.detailScale || (opts.detail === 'gun' ? 6 : 3.2) },
        uCamoA: { value: new THREE.Color().fromArray(camo[0]) }, uCamoB: { value: new THREE.Color().fromArray(camo[1]) },
        uSunVis: { value: 1 }, uAmbient: { value: new THREE.Color(0.5, 0.5, 0.52) },
        map: { value: opts.map || null }, uOpacity: { value: 1 },
        normalMap: { value: opts.normalMap || null }, normalScale: { value: new THREE.Vector2(1, opts.normalFlipY ? -1 : 1) },
        roughnessMap: { value: opts.roughnessMap || null },
      }, U),
      vertexShader: LIT_VS, fragmentShader: LIT_FS,
      side: opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide,
      skinning: !!opts.skinning,
    });
    if (opts.transparent) { m.transparent = true; m.depthWrite = false; }
    return m;
  };
  // geometry helper: fill the colour / rm attributes for a whole geometry
  Gfx.paint = function (geo, rgb, rough, metal, fabric, camo) {
    const n = geo.attributes.position.count, c = new Float32Array(n * 3), rm = new Float32Array(n * 4);
    for (let i = 0; i < n; i++) {
      c[i * 3] = rgb[0]; c[i * 3 + 1] = rgb[1]; c[i * 3 + 2] = rgb[2];
      rm[i * 4] = rough; rm[i * 4 + 1] = metal; rm[i * 4 + 2] = fabric || 0; rm[i * 4 + 3] = camo || 0;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    geo.setAttribute('rm', new THREE.BufferAttribute(rm, 4));
    return geo;
  };
  // merges non-indexed / indexed geometries that share the same attribute set
  Gfx.merge = function (geos) {
    const names = Object.keys(geos[0].attributes);
    let vcount = 0, icount = 0;
    const list = geos.map((g) => { const ng = g.index ? g : g; vcount += ng.attributes.position.count; icount += ng.index ? ng.index.count : ng.attributes.position.count; return ng; });
    const out = new THREE.BufferGeometry();
    names.forEach((nm) => {
      const size = geos[0].attributes[nm].itemSize, arr = new Float32Array(vcount * size);
      let o = 0;
      list.forEach((g) => { const a = g.attributes[nm]; if (!a) throw new Error('merge: missing ' + nm); arr.set(a.array.subarray ? a.array : Float32Array.from(a.array), o); o += a.count * size; });
      out.setAttribute(nm, new THREE.BufferAttribute(arr, size));
    });
    const idx = vcount > 65535 ? new Uint32Array(icount) : new Uint16Array(icount);
    let io = 0, vo = 0;
    list.forEach((g) => {
      if (g.index) { const a = g.index.array; for (let i = 0; i < a.length; i++) idx[io++] = a[i] + vo; }
      else for (let i = 0; i < g.attributes.position.count; i++) idx[io++] = i + vo;
      vo += g.attributes.position.count;
    });
    out.setIndex(new THREE.BufferAttribute(idx, 1));
    out.computeBoundingSphere();
    return out;
  };

  // ---------- sky ----------
  Gfx.makeSky = function (scene) {
    const N = 256, n = new Uint8Array(N * N * 4);
    // soft cumulus noise
    const vn = (cells, seed) => {
      const rr = G.seeded(seed), l = new Float32Array(cells * cells);
      for (let i = 0; i < l.length; i++) l[i] = rr();
      return (x, y) => {
        const gx = x * cells, gy = y * cells, ix = Math.floor(gx), iy = Math.floor(gy);
        let fx = gx - ix, fy = gy - iy; fx = fx * fx * (3 - 2 * fx); fy = fy * fy * (3 - 2 * fy);
        const x0 = ((ix % cells) + cells) % cells, x1 = (x0 + 1) % cells, y0 = ((iy % cells) + cells) % cells, y1 = (y0 + 1) % cells;
        const A = l[y0 * cells + x0] + (l[y0 * cells + x1] - l[y0 * cells + x0]) * fx, B = l[y1 * cells + x0] + (l[y1 * cells + x1] - l[y1 * cells + x0]) * fx;
        return A + (B - A) * fy;
      };
    };
    const oct = [vn(4, 502), vn(8, 503), vn(16, 504), vn(32, 505), vn(64, 506)];
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
      let v = 0, amp = 1, tot = 0;
      for (const f of oct) { v += f(x / N, y / N) * amp; tot += amp; amp *= 0.5; }
      v /= tot;
      const i = (y * N + x) * 4; n[i] = n[i + 1] = n[i + 2] = Math.round(255 * v); n[i + 3] = 255;
    }
    const ct = new THREE.DataTexture(n, N, N, THREE.RGBAFormat);
    ct.wrapS = ct.wrapT = THREE.RepeatWrapping; ct.magFilter = THREE.LinearFilter; ct.minFilter = THREE.LinearMipmapLinearFilter; ct.generateMipmaps = true; ct.needsUpdate = true;
    const mat = new THREE.ShaderMaterial({
      uniforms: Object.assign({ uClouds: { value: ct } }, U),
      defines: Gfx.preset && Gfx.preset.movingShadow ? { CLOUD2: '' } : {},
      side: THREE.BackSide, depthWrite: false,
      // the smooth gradient is worked out per vertex; only the sun and the clouds per pixel
      vertexShader: [
        'uniform vec3 uSkyTop; uniform vec3 uSkyHorizon; uniform vec3 uGround; uniform vec3 uFogColor;',
        'varying vec3 vDir; varying vec3 vBase;',
        'void main() {',
        '  vDir = position; vec3 d = normalize( position ); float h = d.y;',
        '  vec3 c = mix( uSkyHorizon, uSkyTop, pow( max( h, 0.0 ), 0.42 ) );',
        '  c = mix( c, uFogColor, smoothstep( 0.18, 0.0, h ) * 0.55 );',
        '  vBase = mix( c, uGround * 0.8, smoothstep( 0.0, -0.06, h ) );',
        '  vec4 p = projectionMatrix * vec4(mat3(viewMatrix) * position, 1.0);',
        '  gl_Position = vec4( p.xy, p.w * 0.99999, p.w );',
        '}',
      ].join('\n'),
      fragmentShader: [
        'uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uSkyHorizon;',
        'uniform sampler2D uClouds; uniform float uTime; varying vec3 vDir; varying vec3 vBase;',
        'void main() {',
        '  vec3 d = normalize( vDir ); float h = d.y;',
        '  vec3 c = vBase;',
        '  float s = max( dot( d, uSunDir ), 0.0 );',
        '  float s8 = s * s; s8 *= s8; s8 *= s8;',
        '  c += uSunColor * ( smoothstep(.99979,.99990,s)*12.0 + pow(s,550.0)*0.48 + pow( s8, 11.0 ) * 0.18 + s8 * 0.07 );',
        '  if ( h > 0.0 ) {',
        '    vec2 cuv = d.xz / ( h + 0.12 ) * 0.11 + vec2( uTime * 0.0015, uTime * 0.0006 );',
        '#ifdef CLOUD2',
        '    float cl = texture2D( uClouds, cuv ).r * 0.65 + texture2D( uClouds, cuv * 2.7 + 0.3 ).r * 0.35;',
        '#else',
        '    float cl = texture2D( uClouds, cuv ).r;',
        '#endif',
        '    cl = smoothstep( 0.5, 0.78, cl ) * smoothstep( 0.0, 0.3, h );',
        '    vec3 cc = mix( uSkyHorizon * 1.08, vec3( 1.0, 0.97, 0.92 ), 0.6 ) + uSunColor * s8 * 0.25;',
        '    c = mix( c, cc, cl * 0.85 );',
        '  }',
        '  gl_FragColor = vec4( c, 1.0 );',
        '#include <tonemapping_fragment>',
        '#include <encodings_fragment>',
        '}',
      ].join('\n'),
    });
    const sky = new THREE.Mesh(new THREE.SphereGeometry(450, 32, 16), mat);
    sky.frustumCulled = false; sky.renderOrder = 10;   // drawn after the opaque town: most of it is hidden
    scene.add(sky);
    return sky;
  };

  // ---------- static sun shadow map ----------
  // Rendered once from the sun into a depth texture covering the whole town (layers: 2 = solid
  // casters, 3 = alpha-tested foliage). Moving objects never cast into it; they get soft blobs.
  Gfx.buildShadow = function (renderer, scene, size, foliageMap) {
    const sd = U.uSunDir.value;
    const cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 2);
    cam.position.copy(sd).multiplyScalar(200); cam.up.set(0, 1, 0); cam.lookAt(0, 0, 0); cam.updateMatrixWorld();
    const inv = cam.matrixWorldInverse, v = new THREE.Vector3();
    let x0 = 1e9, x1 = -1e9, y0 = 1e9, y1 = -1e9, z0 = 1e9, z1 = -1e9;
    for (const X of [-53, 53]) for (const Y of [-1, 13]) for (const Z of [-53, 53]) {
      v.set(X, Y, Z).applyMatrix4(inv);
      x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x); y0 = Math.min(y0, v.y); y1 = Math.max(y1, v.y); z0 = Math.min(z0, v.z); z1 = Math.max(z1, v.z);
    }
    Object.assign(cam, { left: x0, right: x1, bottom: y0, top: y1, near: -z1 - 2, far: -z0 + 2 });
    cam.updateProjectionMatrix();
    const rt = new THREE.WebGLRenderTarget(size, size, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, depthBuffer: true, stencilBuffer: false });
    const solid = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.BackSide });
    const leafy = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking, side: THREE.DoubleSide, map: foliageMap || null, alphaTest: 0.5 });
    const prevClear = renderer.getClearColor(new THREE.Color()), prevAlpha = renderer.getClearAlpha(), prevAuto = renderer.autoClear;
    const prevOverride = scene.overrideMaterial, bg = scene.background;
    scene.background = null;
    renderer.setRenderTarget(rt);
    renderer.setClearColor(0xffffff, 1); renderer.clear();
    renderer.autoClear = false;
    cam.layers.set(2); scene.overrideMaterial = solid; renderer.render(scene, cam);
    cam.layers.set(3); scene.overrideMaterial = leafy; renderer.render(scene, cam);
    scene.overrideMaterial = prevOverride; scene.background = bg;
    // keep only the colour (packed depth): copy into a target without a depth buffer
    const out = new THREE.WebGLRenderTarget(size, size, { minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter, generateMipmaps: false, depthBuffer: false, stencilBuffer: false });
    const copy = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), new THREE.ShaderMaterial({
      uniforms: { t: { value: rt.texture } }, depthTest: false, depthWrite: false,
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
      fragmentShader: 'uniform sampler2D t; varying vec2 vUv; void main(){ gl_FragColor = texture2D( t, vUv ); }',
    }));
    copy.frustumCulled = false;
    const cs = new THREE.Scene(); cs.add(copy);
    renderer.setRenderTarget(out); renderer.render(cs, new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1));
    cam.layers.set(0);
    renderer.setRenderTarget(null);
    renderer.setClearColor(prevClear, prevAlpha); renderer.autoClear = prevAuto;
    rt.dispose(); copy.geometry.dispose(); copy.material.dispose(); solid.dispose(); leafy.dispose();
    const bias = new THREE.Matrix4().set(0.5, 0, 0, 0.5, 0, 0.5, 0, 0.5, 0, 0, 0.5, 0.5, 0, 0, 0, 1);
    U.uShadowMatrix.value.copy(bias).multiply(cam.projectionMatrix).multiply(cam.matrixWorldInverse);
    U.uShadowMap.value = out.texture;
    U.uShadowTexel.value.set(1 / size, 1 / size);
    Gfx.shadowCam = cam; Gfx.shadowTarget = out;
    return out;
  };

  // Layer four contains visible soldier bodies, held weapons and dropped guns. Snap the light
  // centre in its own XY plane so slow camera motion cannot crawl across texels.
  let moving, depth, shadowCam;
  const centre = new THREE.Vector3(), lightRight = new THREE.Vector3(), lightUp = new THREE.Vector3();
  const savedClear = new THREE.Color();
  Gfx.initMovingShadow = function (size) {
    if (!size) return;
    shadowCam = new THREE.OrthographicCamera(-18,18,18,-18,.2,72);
    shadowCam.position.copy(U.uSunDir.value).multiplyScalar(36);
    shadowCam.lookAt(0,0,0); shadowCam.updateMatrixWorld(); shadowCam.layers.set(4);
    lightRight.setFromMatrixColumn(shadowCam.matrixWorld,0);
    lightUp.setFromMatrixColumn(shadowCam.matrixWorld,1);
    moving = new THREE.WebGLRenderTarget(size,size,{minFilter:THREE.NearestFilter,magFilter:THREE.NearestFilter,stencilBuffer:false});
    depth = new THREE.MeshDepthMaterial({depthPacking:THREE.RGBADepthPacking,skinning:true});
    U.uMovingMap.value = moving.texture; U.uMovingTexel.value = 1/size;
  };
  Gfx.drawMovingShadow = function (r, scene, camera) {
    if (!moving) return;
    const texel = 36 / moving.width;
    camera.getWorldDirection(centre).multiplyScalar(7).add(camera.position);
    const x = centre.dot(lightRight), y = centre.dot(lightUp);
    centre.addScaledVector(lightRight,Math.round(x/texel)*texel-x);
    centre.addScaledVector(lightUp,Math.round(y/texel)*texel-y);
    shadowCam.position.copy(centre).addScaledVector(U.uSunDir.value,36);
    shadowCam.updateMatrixWorld(); U.uMovingMatrix.value.multiplyMatrices(shadowCam.projectionMatrix,shadowCam.matrixWorldInverse);
    for (const d of G.Weapons.drops) d.mesh.layers.enable(4);
    const prev = scene.overrideMaterial, alpha = r.getClearAlpha();
    r.getClearColor(savedClear); r.setRenderTarget(moving); r.setClearColor(0xffffff,1); r.clear();
    scene.overrideMaterial = depth; r.render(scene,shadowCam); scene.overrideMaterial = prev;
    r.setClearColor(savedClear,alpha); r.setRenderTarget(null);
  };

  // ---------- baked light assets ----------
  Gfx.loadLightmaps = function (geo) {
    const load = (url) => new Promise((res) => {
      const img = new Image();
      img.onload = () => res(img); img.onerror = () => res(null);
      img.src = url;
    });
    const tex = (img, filter) => {
      const t = new THREE.Texture(img);
      t.flipY = false; t.generateMipmaps = false; t.minFilter = filter; t.magFilter = THREE.LinearFilter;
      t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping; t.needsUpdate = true;
      return t;
    };
    const timeout = new Promise((res) => setTimeout(() => res('timeout'), 12000));
    const meta = fetch('assets/lightmap.json', { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    return Promise.race([Promise.all([meta, load('assets/lightmap.png'), load('assets/probes.png')]), timeout]).then((res) => {
      if (res === 'timeout' || !res[1]) { Gfx.lightmapStatus = 'missing'; return false; }
      const [m, lm, pr] = res;
      if (m && (m.checksum !== geo.checksum || m.w !== geo.atlasW || m.h !== geo.atlasH)) { Gfx.lightmapStatus = 'stale'; console.warn('lightmap does not match the map geometry'); }
      else Gfx.lightmapStatus = 'ok';
      if (m && m.emax) U.uLMScale.value = m.emax;
      U.uLightMap.value = tex(lm, THREE.LinearFilter);
      if (pr) U.uProbeMap.value = tex(pr, THREE.LinearFilter);
      return true;
    });
  };
  // ambient probe on the CPU (for the first-person weapon and the sun-visibility tests)
  let probeData = null;
  Gfx.probeAt = function (x, z, out) {
    out = out || new THREE.Color();
    const img = U.uProbeMap.value && U.uProbeMap.value.image;
    if (!probeData && img && img.width > 1) {
      try {
        const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
        const g = c.getContext('2d'); g.drawImage(img, 0, 0);
        probeData = { w: img.width, h: img.height, d: g.getImageData(0, 0, img.width, img.height).data };
      } catch (e) { probeData = { w: 0 }; }
    }
    if (!probeData || !probeData.w) return out.setRGB(0.5, 0.5, 0.52);
    const u = G.clamp((x + 50) / 100, 0, 0.9999), v = G.clamp((z + 50) / 100, 0, 0.9999);
    const i = (Math.floor(v * probeData.h) * probeData.w + Math.floor(u * probeData.w)) * 4, k = U.uLMScale.value / 65025;
    const d = probeData.d;
    return out.setRGB(d[i] * d[i] * k, d[i + 1] * d[i + 1] * k, d[i + 2] * d[i + 2] * k);
  };
})(window.G);
