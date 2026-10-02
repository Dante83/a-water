//── WaterfallSplashHull ─────────────────────────────────────────────────────
//
//The proxy volumes the waterfall's SPLASH BURSTS are raymarched in (waterfall-splash.glsl), and
//the model both share. Pure math, no THREE. For every few strands of a traced nappe
//(ARestlessOcean.WaterfallNappe) and every touchdown of each (each ledge, and the plunge), it
//builds a BLOB: a sphere at the landing, inside which the shader draws a burst of spray thrown
//up off the water, rising against drag, falling back, and firing again.
//
//THE MODEL. The shape is what a Gaussian IMPACT throws up, with drag:
//  what lands   across a blob's footprint the arriving water is a Gaussian in the distance xi from
//               the middle: mass m(xi) = exp(-xi^2 / b^2). The pressure that throws spray back up
//               is that mass flux times the arrival speed, and launch speed goes as the square root
//               of pressure: v0(xi) = v0c exp(-xi^2 / 2 b^2), v0c = launchFraction x the normal
//               speed lost. The middle is the heaviest AND the fastest; the sides thin and slow.
//  the flight   drops under gravity and quadratic air drag, terminal speed vt. Closed form, with
//               phi0 = atan(v0 / vt):
//                 rising  (s <= sUp = (vt / g) phi0):  z = (vt^2 / g) ln(cos(phi0 - g s / vt) / cos(phi0))
//                 apex    H = (vt^2 / 2 g) ln(1 + v0^2 / vt^2)
//                 falling (s' = s - sUp):              z = H - (vt^2 / g) ln(cosh(g s' / vt))
//                 landed  T = sUp + (vt / g) acosh(sqrt(1 + v0^2 / vt^2))
//  the shape    the top of a burst is that flight evaluated with v0(xi). At the apex it is
//               H(xi) = (vt^2 / 2 g) ln(1 + (v0c^2 / vt^2) exp(-xi^2 / b^2)): for a gentle splash
//               exactly the exp(-xi^2 / b^2) bell, for a hard one the same bell with its top
//               flattened by drag. The sides have a shorter T: they are back down first, and the
//               burst shrinks to its middle before it is gone.
//  the pulse    one burst alone would fire again once it had fallen back: P = T(middle) x (1 + rest),
//               about a second. A real foot fires several times a second, so its bursts overlap in the
//               air and it never clears: the shader draws the standing column of their apexes, with the
//               launch speed pulsing (uPulseRate and harmonics) and scattered by 2D noise. P is still
//               exported (splashA.y) but the shader does not use it.
//  the vanish   a fall tall enough has broken up into rain before it lands, already at terminal
//               speed, with nothing left to throw. The trace carries Horeni's breakup length per
//               strand (Lb = 6 q^0.32, where the jet's core is gone); the splash fades out between
//               mistLo and mistHi of those lengths of fall.
//
//Returns {position, center, splashA, splashB, splashC, index, vertexCount, blobs, ranges}:
//  position  proxy vertex (world): an icosahedron whose inscribed sphere is the blob's
//  center  = (the blob's origin xyz: the landing, on the water's surface; R: its radius)
//  splashA = (v0c m/s, P s (unused by the shader), b m, seed)
//  splashB = (the burst's up axis xyz, strength)
//  splashC = (level: nothing is drawn below this height; vt m/s; fan: the radial spread; fallReach: the falling skirt's)
//
//FUDGE: launchFraction, terminalVelocity (a drop size), rest, fan, lean, the widths and
//mistLo / mistHi are look choices on top of the physical forms above; all are options.
ARestlessOcean.WaterfallSplashHull = ARestlessOcean.WaterfallSplashHull || {};
(function(H){
  const G = 9.81;
  H.DEFAULTS = {
    strandStride: 4,        //a blob for every this-many strands (and always the last), at least. 1 -> 4 (2 m) on 2026-10-02: a pixel near a fall marched ~13 overlapping blobs; each blob now carries its whole gap's water (densityRefGap), so the look does not depend on this
    maxBlobs: 48,           //...and for a wider fall the stride grows so no more than about this many are built per touchdown line
    widthPerGap: 0.9,       //b, the impact's Gaussian width, as a multiple of the distance between neighbouring blobs (they overlap into one line of splash)...
    widthMin: 1.8,          //...and at least this, m (in practice THE impact width b: the gap term only wins for a very wide stride)
    launchFraction: 0.857,  //v0c as a fraction of the normal speed the water loses at the landing (0.35 -> 0.7 with vt 4 -> 8: x4 the height; then x sqrt(1.5) both: x1.5, Dante 2026-10-02)
    terminalVelocity: 9.8,  //m/s: the spray's terminal speed (big drops). Lower: a finer, lower, quicker spray. Scaling it and launchFraction both by s scales the apex by exactly s^2
    rest: 0.15,             //the pause between a burst landing and the next firing, as a fraction of its life
    fan: 0.6,               //RADIAL spread: the splash opens 1 + fan wide by its top, its drops flying out along rays from a focus under the water
    fallReach: 0.5,         //THE FALL: the water leaving the top of the column comes down this much further out again (the skirt is the column's bell 1 + fallReach wide; 0: no skirt)
    lean: 0.25,             //how far the burst's up axis leans along the water's bounce off the surface it lands on (0: straight up)
    densityRefGap: 0.5,     //m: the gap between blobs the shader's density was tuned at; a blob's strength is scaled by its own gap over this (it carries the water of its whole gap)
    cutoff: 2.0,            //the blob reaches this many b from its middle (the Gaussian is at exp(-4) there)
    topSoft: 0.6,           //m of soft edge above the burst's top that the blob must hold
    margin: 1.15,           //the blob's radius over the burst's reach (the shader fades to zero on the sphere)
    mistLo: 3.0,            //the splash starts to fade once the water has fallen this many breakup lengths...
    mistHi: 8.0,            //...and is gone by this many
    minImpactSpeed: 2.0,    //m/s of normal speed lost: gentler touchdowns throw nothing
    minStrength: 0.02
  };
  const opt = function(o, k){ return (o && o[k] !== undefined) ? o[k] : H.DEFAULTS[k]; };

  //The flight (see the header). waterfall-splash.glsl has the same three functions: keep in step.
  H.apex = function(v0, vt){ return vt * vt / (2.0 * G) * Math.log(1.0 + v0 * v0 / (vt * vt)); };
  H.life = function(v0, vt){ return vt / G * (Math.atan(v0 / vt) + Math.acosh(Math.sqrt(1.0 + v0 * v0 / (vt * vt)))); };
  H.flight = function(v0, vt, s){
    const phi0 = Math.atan(v0 / vt), sUp = vt / G * phi0;
    if(s <= sUp) return vt * vt / G * Math.log(Math.cos(phi0 - G * s / vt) / Math.cos(phi0));
    return H.apex(v0, vt) - vt * vt / G * Math.log(Math.cosh(G * (s - sUp) / vt));
  };
  //The launch speed a distance xi from the middle of an impact of width b.
  H.launch = function(v0c, b, xi){ return v0c * Math.exp(-xi * xi / (2.0 * b * b)); };
  //How much of the splash is left after a fall of height h, for a jet of breakup length Lb.
  H.coherent = function(h, Lb, o){
    const lo = opt(o, 'mistLo') * Lb, hi = Math.max(opt(o, 'mistHi') * Lb, lo + 1e-3);
    const x = Math.min(Math.max((h - lo) / (hi - lo), 0.0), 1.0);
    return 1.0 - x * x * (3.0 - 2.0 * x);
  };

  //A unit icosahedron, scaled so its INSCRIBED sphere is the unit sphere (the proxy must hold the blob).
  const ICO = (function(){
    const p = (1.0 + Math.sqrt(5.0)) / 2.0, l = Math.hypot(1.0, p);
    const raw = [[-1, p, 0], [1, p, 0], [-1, -p, 0], [1, -p, 0], [0, -1, p], [0, 1, p], [0, -1, -p], [0, 1, -p], [p, 0, -1], [p, 0, 1], [-p, 0, -1], [-p, 0, 1]];
    const f = [0, 11, 5, 0, 5, 1, 0, 1, 7, 0, 7, 10, 0, 10, 11, 1, 5, 9, 5, 11, 4, 11, 10, 2, 10, 7, 6, 7, 1, 8,
               3, 9, 4, 3, 4, 2, 3, 2, 6, 3, 6, 8, 3, 8, 9, 4, 9, 5, 2, 4, 11, 6, 2, 10, 8, 6, 7, 9, 8, 1];
    //Inradius of the unit-circumradius icosahedron: the distance of a face's centroid from the middle.
    const a = raw[0], b = raw[11], c = raw[5];
    const inr = Math.hypot(a[0] + b[0] + c[0], a[1] + b[1] + c[1], a[2] + b[2] + c[2]) / (3.0 * l);
    return {v: raw.map(function(q){ return [q[0] / (l * inr), q[1] / (l * inr), q[2] / (l * inr)]; }), f: f};
  })();
  H.PROXY_SCALE = Math.hypot(ICO.v[0][0], ICO.v[0][1], ICO.v[0][2]);

  //env (optional): {waterAt(x, z) -> {depth, level} | null}, so a burst off a bed under running
  //water starts on the water's surface, not under it.
  H.build = function(nappe, o, env){
    if(!nappe || !nappe.strands || !nappe.strands.length) return null;
    const S = nappe.strands, nS = S.length;
    const stride = Math.max(opt(o, 'strandStride') | 0, 1);
    const stride2 = Math.max(stride, Math.ceil(nS / Math.max(opt(o, 'maxBlobs') | 0, 1)));
    const gap = stride2 * Math.max(nappe.spacing || 0.0, 0.0);
    const b = Math.max(opt(o, 'widthPerGap') * gap, opt(o, 'widthMin'));
    const vt = opt(o, 'terminalVelocity'), fan = opt(o, 'fan'), cutoff = opt(o, 'cutoff');
    const share = gap > 0.0 ? gap / Math.max(opt(o, 'densityRefGap'), 1e-3) : 1.0;

    const pos = [], cen = [], sA = [], sB = [], sC = [], idx = [];
    const ranges = [];
    let blobs = 0, vBase = 0;
    for(let j = 0; j < nS; ++j){
      const st = S[j];
      if(!st || !st.impacts || !(j % stride2 === 0 || j === nS - 1)) continue;
      for(let i = 0; i < st.impacts.length; ++i){
        const im = st.impacts[i];
        if(!(im.vn >= opt(o, 'minImpactSpeed'))) continue;
        const speed = Math.hypot(im.vx, im.vy, im.vz);
        const w = im.w !== undefined ? im.w : 1.0;
        const coherent = H.coherent(speed * speed / (2.0 * G), st.Lb > 0.0 ? st.Lb : 1e9, o);
        //The energy law the spray particles use (OceanSplash._emitFalls): 1 at a 10 m/s landing.
        const strength = Math.min(Math.max(Math.pow(im.vn / 10.0, 1.5), 0.02), 3.0) * w * coherent * share;
        if(!(strength >= opt(o, 'minStrength'))) continue;
        const v0c = opt(o, 'launchFraction') * im.vn;
        const T = H.life(v0c, vt), P = T * (1.0 + opt(o, 'rest'));
        //On the water's surface.
        let y0 = im.y;
        if(env && typeof env.waterAt === 'function'){
          const wa = env.waterAt(im.x, im.z);
          if(wa && wa.depth > 0.02 && wa.level > y0) y0 = wa.level;
        }
        //Up axis: straight up, leaning along the horizontal part of the water's bounce off the surface.
        const vd = im.vx * im.nx + im.vy * im.ny + im.vz * im.nz;
        let rx = im.vx - 2.0 * vd * im.nx, rz = im.vz - 2.0 * vd * im.nz;
        const rl = Math.max(speed, 1e-3);
        rx *= opt(o, 'lean') / rl; rz *= opt(o, 'lean') / rl;
        const al = Math.hypot(rx, 1.0, rz);
        const ax = rx / al, ay = 1.0 / al, az = rz / al;
        //The blob's radius: the furthest the burst reaches from its origin over its life (each launch
        //ring at its own apex, spread out as far as it gets), with the soft top and a margin.
        const wide = (1.0 + fan) * (1.0 + Math.max(opt(o, 'fallReach'), 0.0));   //the falling skirt reaches furthest out
        let reach = cutoff * b * wide + 0.3 * b;
        for(let k = 0; k <= 16; ++k){
          const xi = cutoff * b * k / 16;
          reach = Math.max(reach, Math.hypot(xi * wide + 0.3 * b, H.apex(H.launch(v0c, b, xi), vt) + opt(o, 'topSoft')));
        }
        const R = reach * opt(o, 'margin');
        const seed = (blobs * 0.6180339887) % 1.0;
        const firstV = vBase;
        for(let k = 0; k < ICO.v.length; ++k){
          const q = ICO.v[k];
          pos.push(im.x + q[0] * R, y0 + q[1] * R, im.z + q[2] * R);
          cen.push(im.x, y0, im.z, R);
          sA.push(v0c, P, b, seed);
          sB.push(ax, ay, az, strength);
          sC.push(y0, vt, fan, Math.max(opt(o, 'fallReach'), 0.0));
          ++vBase;
        }
        //Wound outward (signed volume about the blob's own middle, flipped as a whole if not).
        let vol = 0.0;
        for(let t = 0; t < ICO.f.length; t += 3){
          const a = ICO.v[ICO.f[t]], bb = ICO.v[ICO.f[t + 1]], c = ICO.v[ICO.f[t + 2]];
          vol += a[0] * (bb[1] * c[2] - bb[2] * c[1]) - a[1] * (bb[0] * c[2] - bb[2] * c[0]) + a[2] * (bb[0] * c[1] - bb[1] * c[0]);
        }
        for(let t = 0; t < ICO.f.length; t += 3){
          if(vol >= 0.0) idx.push(firstV + ICO.f[t], firstV + ICO.f[t + 1], firstV + ICO.f[t + 2]);
          else idx.push(firstV + ICO.f[t], firstV + ICO.f[t + 2], firstV + ICO.f[t + 1]);
        }
        ranges.push({v0: firstV, v1: vBase, strand: j, x: im.x, y: y0, z: im.z, radius: R, width: b, launch: v0c, life: T, period: P,
                     apex: H.apex(v0c, vt), strength: strength, coherent: coherent, vn: im.vn, plunge: im === st.plunge});
        ++blobs;
      }
    }
    if(!blobs) return null;
    return {position: new Float32Array(pos), center: new Float32Array(cen), splashA: new Float32Array(sA), splashB: new Float32Array(sB),
            splashC: new Float32Array(sC), index: new Uint32Array(idx), vertexCount: vBase, blobs: blobs, ranges: ranges};
  };
})(ARestlessOcean.WaterfallSplashHull);
