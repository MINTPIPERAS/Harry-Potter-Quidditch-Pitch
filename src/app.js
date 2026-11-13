/* ============================================================================
   THE HOGWARTS QUIDDITCH PITCH — a 3D diorama
   Three.js r128 (inlined). The scene renders at full device resolution with
   MSAA, mipmapped textures and soft shadows on a free orbit camera.
   ========================================================================== */
(function () {
  'use strict';

  /* --------------------------------------------------------------- helpers */
  var PI = Math.PI, TAU = PI * 2;
  var clamp = function (v, a, b) { return v < a ? a : (v > b ? b : v); };
  var lerp = function (a, b, t) { return a + (b - a) * t; };
  var smoothstep = function (a, b, x) {
    var t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
  };
  var D = function (deg) { return deg * PI / 180; };

  var seed = 1337;
  function rand() {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  }
  function rr(a, b) { return a + (b - a) * rand(); }
  function ri(a, b) { return Math.floor(rr(a, b + 1)); }
  function pick(arr) { return arr[Math.min(arr.length - 1, Math.floor(rand() * arr.length))]; }

  /* ---------------------------------------------------------------- palette */
  var C = {
    bg: 0xf5f1e7,
    cream: 0xdfcdad,
    creamHi: 0xeee0c5,
    creamLo: 0xc8b38f,
    creamDeep: 0xbda681,
    gold: 0xc99b43,
    goldHi: 0xefc766,
    goldLo: 0x9c7230,
    slate: 0x344a50,
    slateDeep: 0x24373d,
    slateSoft: 0x546a70,
    grass: 0x47664f,
    grassHi: 0x527259,
    grassLo: 0x3c5946,
    terr1: 0x455a43,
    terr2: 0x50644a,
    terr3: 0x5c7054,
    stone: 0x9a917d,
    stoneHi: 0xb2a88f,
    stoneLo: 0x7d7565,
    stoneDark: 0x6e6759,
    wood: 0x8a6544,
    woodLo: 0x6a4c34,
    skin: 0xe6b68c,
    hair: 0x4a3327,
    gryf: 0x992a2b,
    gryfDark: 0x6f1e20,
    gryfGold: 0xd9a83e,
    slyth: 0x285941,
    slythDark: 0x1b3f2d,
    slythSilver: 0xc8d2c6,
    raven: 0x31476d,
    ravenDark: 0x23324d,
    ravenBronze: 0xb0804a,
    huff: 0xd6b03c,
    huffDark: 0x37332a,
    window: 0xf2c36c,
    windowSoft: 0xd9a95a,
    snitch: 0xf6c84d,
    iron: 0x3e4548,
    quaffle: 0x8f412c
  };

  var matCache = {};
  function mat(color, opts) {
    var o = Object.assign({ roughness: 0.94, metalness: 0.0, flatShading: true }, opts || {});
    var key = color + '|' + JSON.stringify(o);
    if (!matCache[key]) matCache[key] = new THREE.MeshStandardMaterial(Object.assign({ color: color }, o));
    return matCache[key];
  }

  /* ------------------------------------------------------------ renderer */
  var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setClearColor(C.bg, 1);
  renderer.domElement.id = 'scene';
  document.getElementById('stage').appendChild(renderer.domElement);

  var MAX_ANISO = renderer.capabilities.getMaxAnisotropy();
  function smoothTex(tex) {
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.generateMipmaps = true;
    tex.anisotropy = MAX_ANISO;
    return tex;
  }

  /* ---------------------------------------------------------------- scene */
  var scene = new THREE.Scene();
  scene.background = new THREE.Color(C.bg);

  /* --------------------------------------------------------- orbit rig */
  // The diorama is framed from a spherical orbit: azimuth / polar angle / zoom.
  // Two cameras share the same rig so the projection can be swapped at runtime.
  var FIT_H = 62, FIT_W = 82;
  var PERSP_FOV = 20;
  var camTarget = new THREE.Vector3(0, 12.4, -1.6);
  var camDist = 108;
  var persp = new THREE.PerspectiveCamera(PERSP_FOV, 1, 1, 900);
  var ortho = new THREE.OrthographicCamera(-1, 1, 1, -1, 1, 900);
  var activeCamera = persp;
  var view = { az: PI / 4, polar: D(45), zoom: 1 };
  var goal = { az: view.az, polar: view.polar, zoom: 1 };
  var ctrl = {
    dragging: false, azVel: 0, polarVel: 0,
    lastX: 0, lastY: 0, lastT: 0,
    pinchOn: false, pinch: 0,
    idle: 999, auto: true, autoSpeed: 0.058
  };
  var pointers = {};
  var camDir = new THREE.Vector3();
  var POLAR_MIN = D(35), POLAR_MAX = D(80);
  var ZOOM_MIN = 0.62, ZOOM_MAX = 2.5;
  // The castle is the tallest thing in the diorama; when it swings into the
  // foreground the camera eases back a touch so it never grazes the frame edge.
  var fitCorners = null, fitZoom = 1, fitGoal = 1;

  function fitCameras() {
    var aspect = Math.max(0.2, window.innerWidth / Math.max(1, window.innerHeight));
    var halfH = Math.max(FIT_H / 2, FIT_W / (2 * aspect));
    // Orthographic projection has no depth shrink, so the far towers read taller
    // than they do in perspective; a small pad keeps both modes framed alike.
    var orthoH = halfH * 1.06;
    camDist = halfH / Math.tan(PERSP_FOV * PI / 360);
    ortho.left = -orthoH * aspect;
    ortho.right = orthoH * aspect;
    ortho.top = orthoH;
    ortho.bottom = -orthoH;
    ortho.zoom = view.zoom;
    ortho.updateProjectionMatrix();
    persp.aspect = aspect;
    persp.zoom = view.zoom;
    persp.updateProjectionMatrix();
  }

  function resize() {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(window.innerWidth, window.innerHeight);
    fitCameras();
  }
  window.addEventListener('resize', resize);

  function applyCamera() {
    var sp = Math.sin(view.polar), cp = Math.cos(view.polar);
    camDir.set(Math.sin(view.az) * sp, cp, Math.cos(view.az) * sp);
    activeCamera.position.copy(camTarget).addScaledVector(camDir, camDist);
    activeCamera.lookAt(camTarget);
  }

  function updateCamera(dt) {
    if (!ctrl.dragging) {
      if (ctrl.auto && ctrl.idle > 2.4 && Math.abs(ctrl.azVel) < 0.02 && Math.abs(ctrl.polarVel) < 0.02) {
        goal.az += ctrl.autoSpeed * dt;
      }
      goal.az += ctrl.azVel * dt;
      goal.polar += ctrl.polarVel * dt;
      var damp = Math.exp(-dt * 3.6);
      ctrl.azVel *= damp;
      ctrl.polarVel *= damp;
    }
    goal.polar = clamp(goal.polar, POLAR_MIN, POLAR_MAX);

    var k = 1 - Math.exp(-dt * 10);
    view.az += (goal.az - view.az) * k;
    view.polar += (goal.polar - view.polar) * k;
    view.zoom += (goal.zoom - view.zoom) * (1 - Math.exp(-dt * 12));

    ctrl.idle += dt;
    applyCamera();

    if (fitCorners) {
      activeCamera.updateMatrixWorld(true);
      var prevZoom = activeCamera.zoom;
      activeCamera.zoom = 1;
      activeCamera.updateProjectionMatrix();
      var need = 1;
      for (var ci = 0; ci < fitCorners.length; ci++) {
        var q = fitCorners[ci].clone().project(activeCamera);
        var ay = Math.abs(q.y), ax = Math.abs(q.x);
        if (ay > 0.90) need = Math.min(need, 0.90 / ay);
        if (ax > 0.94) need = Math.min(need, 0.94 / ax);
      }
      activeCamera.zoom = prevZoom;
      fitGoal = clamp(need, 0.8, 1);
      fitZoom += (fitGoal - fitZoom) * (1 - Math.exp(-dt * 3));
    }

    var z = view.zoom * fitZoom;
    ortho.zoom = z;
    persp.zoom = z;
    ortho.updateProjectionMatrix();
    persp.updateProjectionMatrix();
  }

  function pinchDistance() {
    var ids = Object.keys(pointers);
    if (ids.length < 2) return 0;
    var a = pointers[ids[0]], b = pointers[ids[1]];
    return Math.sqrt((a.x - b.x) * (a.x - b.x) + (a.y - b.y) * (a.y - b.y));
  }

  var el = renderer.domElement;
  el.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
    if (el.setPointerCapture) el.setPointerCapture(e.pointerId);
    ctrl.idle = 0;
    ctrl.azVel = 0;
    ctrl.polarVel = 0;
    if (Object.keys(pointers).length === 1) {
      ctrl.dragging = true;
      ctrl.lastX = e.clientX;
      ctrl.lastY = e.clientY;
      ctrl.lastT = performance.now();
      el.classList.add('grabbing');
    } else {
      ctrl.dragging = false;
      ctrl.pinchOn = true;
      ctrl.pinch = pinchDistance();
    }
  });

  el.addEventListener('pointermove', function (e) {
    var p = pointers[e.pointerId];
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    ctrl.idle = 0;

    if (Object.keys(pointers).length >= 2) {
      var d = pinchDistance();
      if (ctrl.pinchOn && ctrl.pinch > 0) {
        goal.zoom = clamp(goal.zoom * (d / ctrl.pinch), ZOOM_MIN, ZOOM_MAX);
      }
      ctrl.pinch = d;
      return;
    }
    if (!ctrl.dragging) return;

    var dx = e.clientX - ctrl.lastX;
    var dy = e.clientY - ctrl.lastY;
    var now = performance.now();
    var dtm = Math.max(0.008, (now - ctrl.lastT) / 1000);
    ctrl.lastX = e.clientX;
    ctrl.lastY = e.clientY;
    ctrl.lastT = now;

    goal.az -= dx * 0.0062;
    goal.polar = clamp(goal.polar - dy * 0.005, POLAR_MIN, POLAR_MAX);
    ctrl.azVel = clamp(-dx * 0.0062 / dtm * 0.22, -1.3, 1.3);
    ctrl.polarVel = clamp(-dy * 0.005 / dtm * 0.22, -0.9, 0.9);
  });

  function endPointer(e) {
    if (pointers[e.pointerId]) delete pointers[e.pointerId];
    var left = Object.keys(pointers);
    if (left.length < 2) ctrl.pinchOn = false;
    if (left.length === 1 && !ctrl.dragging) {
      // one finger of a pinch stayed down: keep orbiting with it
      var rest = pointers[left[0]];
      ctrl.dragging = true;
      ctrl.lastX = rest.x;
      ctrl.lastY = rest.y;
      ctrl.lastT = performance.now();
      el.classList.add('grabbing');
    }
    if (left.length === 0) {
      if (ctrl.dragging) {
        ctrl.dragging = false;
        el.classList.remove('grabbing');
        ctrl.azVel = clamp(ctrl.azVel * 0.7, -1.1, 1.1);
        ctrl.polarVel = clamp(ctrl.polarVel * 0.7, -0.8, 0.8);
      }
      ctrl.idle = 0;
    }
  }
  el.addEventListener('pointerup', endPointer);
  el.addEventListener('pointercancel', endPointer);

  el.addEventListener('wheel', function (e) {
    e.preventDefault();
    ctrl.idle = 0;
    goal.zoom = clamp(goal.zoom * Math.exp(-e.deltaY * 0.0012), ZOOM_MIN, ZOOM_MAX);
  }, { passive: false });

  function resetView() {
    goal.az = view.az + Math.atan2(Math.sin(PI / 4 - view.az), Math.cos(PI / 4 - view.az));
    goal.polar = D(45);
    goal.zoom = 1;
    ctrl.azVel = 0;
    ctrl.polarVel = 0;
    ctrl.idle = 0;
  }
  el.addEventListener('dblclick', resetView);

  function setProjection(mode) {
    activeCamera = (mode === 'ortho') ? ortho : persp;
    fitCameras();
    applyCamera();
    if (window.__diorama) window.__diorama.camera = activeCamera;
  }

  /* ------------------------------------------------------------- hud */
  var hudProj = document.getElementById('btn-proj');
  var hudAuto = document.getElementById('btn-auto');
  var hudReset = document.getElementById('btn-reset');
  var hint = document.getElementById('hint');
  if (hudProj) {
    hudProj.addEventListener('click', function () {
      var toOrtho = activeCamera !== ortho;
      setProjection(toOrtho ? 'ortho' : 'persp');
      hudProj.textContent = toOrtho ? 'Perspective' : 'Orthographic';
      ctrl.idle = 0;
    });
  }
  if (hudAuto) {
    hudAuto.addEventListener('click', function () {
      ctrl.auto = !ctrl.auto;
      hudAuto.classList.toggle('on', ctrl.auto);
      ctrl.idle = 0;
    });
  }
  if (hudReset) hudReset.addEventListener('click', resetView);
  if (hint) setTimeout(function () { hint.classList.add('hide'); }, 9000);
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    ctrl.auto = false;
    if (hudAuto) hudAuto.classList.remove('on');
  }

  fitCameras();
  applyCamera();

  /* --------------------------------------------------------------- lights */
  var hemi = new THREE.HemisphereLight(0xfff3dc, 0x657463, 0.30);
  scene.add(hemi);

  var sun = new THREE.DirectionalLight(0xffeecb, 1.04);
  sun.position.set(-31, 46, 27);
  sun.target.position.set(-2, 0, -4);
  scene.add(sun.target);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  sun.shadow.camera.left = -38;
  sun.shadow.camera.right = 38;
  sun.shadow.camera.top = 38;
  sun.shadow.camera.bottom = -38;
  sun.shadow.camera.near = 8;
  sun.shadow.camera.far = 150;
  sun.shadow.bias = -0.0006;
  sun.shadow.normalBias = 0.035;
  scene.add(sun);

  var fill = new THREE.DirectionalLight(0xc6d9e2, 0.28);
  fill.position.set(36, 24, 17);
  scene.add(fill);

  var rim = new THREE.DirectionalLight(0xfff4d8, 0.10);
  rim.position.set(4, 20, -42);
  scene.add(rim);

  /* --------------------------------------------------------------- world */
  var world = new THREE.Group();
  scene.add(world);
  var updaters = [];

  function shadowify(obj, cast, receive) {
    obj.castShadow = cast !== false;
    obj.receiveShadow = receive !== false;
    return obj;
  }

  var table = new THREE.Mesh(new THREE.PlaneGeometry(320, 260), new THREE.MeshBasicMaterial({ color: C.bg }));
  table.rotation.x = -PI / 2;
  table.position.set(0, -3.35, -14);
  world.add(table);

  var shadowPlate = new THREE.Mesh(
    new THREE.PlaneGeometry(150, 140),
    new THREE.ShadowMaterial({ color: 0x334036, opacity: 0.11 })
  );
  shadowPlate.rotation.x = -PI / 2;
  shadowPlate.position.set(0, -3.33, -4);
  shadowPlate.receiveShadow = true;
  world.add(shadowPlate);

  /* --------------------------------------------------------------- plinth */
  function roundedRectShape(w, d, r) {
    var s = new THREE.Shape();
    var x = -w / 2, y = -d / 2;
    s.moveTo(x + r, y);
    s.lineTo(x + w - r, y);
    s.quadraticCurveTo(x + w, y, x + w, y + r);
    s.lineTo(x + w, y + d - r);
    s.quadraticCurveTo(x + w, y + d, x + w - r, y + d);
    s.lineTo(x + r, y + d);
    s.quadraticCurveTo(x, y + d, x, y + d - r);
    s.lineTo(x, y + r);
    s.quadraticCurveTo(x, y, x + r, y);
    return s;
  }
  function slabGeometry(w, d, h, r, bevel) {
    var geo = new THREE.ExtrudeGeometry(roundedRectShape(w, d, r), {
      depth: h, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel,
      bevelSegments: 2, curveSegments: 7, steps: 1
    });
    geo.rotateX(-PI / 2);
    return geo;
  }

  var baseGroup = new THREE.Group();
  world.add(baseGroup);

  var plinthLow = new THREE.Mesh(slabGeometry(50, 42, 1.4, 3.6, 0.25), mat(C.creamLo));
  plinthLow.position.y = -3.1;
  shadowify(plinthLow);
  baseGroup.add(plinthLow);

  var plinthTop = new THREE.Mesh(slabGeometry(47.6, 39.6, 0.85, 3.3, 0.18), mat(C.cream));
  plinthTop.position.y = -1.26;
  shadowify(plinthTop);
  baseGroup.add(plinthTop);

  var goldLineShape = roundedRectShape(49.4, 41.4, 3.5);
  goldLineShape.holes.push(roundedRectShape(49.22, 41.22, 3.4));
  var goldLine = new THREE.Mesh(
    new THREE.ExtrudeGeometry(goldLineShape, { depth: 0.075, bevelEnabled: false, steps: 1, curveSegments: 8 }),
    mat(C.gold, { roughness: 0.38, metalness: 0.5 })
  );
  goldLine.rotation.x = -PI / 2;
  goldLine.position.y = -1.4;
  baseGroup.add(goldLine);

  var rimOuter = roundedRectShape(47.4, 39.4, 3.2);
  rimOuter.holes.push(roundedRectShape(45.0, 37.0, 2.6));
  var rim = new THREE.Mesh(
    new THREE.ExtrudeGeometry(rimOuter, {
      depth: 0.5, bevelEnabled: true, bevelThickness: 0.09, bevelSize: 0.09,
      bevelSegments: 1, curveSegments: 8, steps: 1
    }),
    mat(C.cream)
  );
  rim.rotation.x = -PI / 2;
  rim.position.y = -0.12;
  shadowify(rim, true);
  baseGroup.add(rim);

  var plaque = new THREE.Group();
  var plaqueRim = new THREE.Mesh(new THREE.BoxGeometry(4.5, 1.04, 0.06), mat(C.gold, { roughness: 0.35, metalness: 0.45 }));
  plaque.add(plaqueRim);
  var plaquePlate = new THREE.Mesh(new THREE.BoxGeometry(4.26, 0.86, 0.1), mat(C.slateDeep, { roughness: 0.6 }));
  plaquePlate.position.z = 0.06;
  plaque.add(plaquePlate);
  var snitchBadge = new THREE.Group();
  var badgeBall = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), mat(C.goldHi, { metalness: 0.55, roughness: 0.3 }));
  snitchBadge.add(badgeBall);
  var badgeWingGeo = new THREE.BufferGeometry();
  badgeWingGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, 0.44, 0.16, 0.0, 0.15, -0.05, 0.0
  ], 3));
  badgeWingGeo.computeVertexNormals();
  var badgeWingMat = mat(C.creamHi, { side: THREE.DoubleSide });
  var bw1 = new THREE.Mesh(badgeWingGeo, badgeWingMat); bw1.position.set(0.1, 0.06, 0.08);
  var bw2 = new THREE.Mesh(badgeWingGeo, badgeWingMat); bw2.rotation.y = PI; bw2.position.set(-0.1, 0.06, 0.08);
  snitchBadge.add(bw1, bw2);
  snitchBadge.position.set(0, 0, 0.14);
  plaque.add(snitchBadge);
  plaque.position.set(0, -2.25, 21.02);
  baseGroup.add(plaque);

  /* -------------------------------------------------------------- terrain */
  var TERRAIN_W = 46.2, TERRAIN_D = 38.2;
  var PITCH_Z = 4.0;

  function groundHeight(x, z) {
    var ex = x / 21.5, ez = (z - PITCH_Z) / 16.4;
    var e = Math.sqrt(ex * ex + ez * ez);
    var outside = smoothstep(0.985, 1.22, e);

    var h = 0;
    var back = smoothstep(-11.5, -19.6, z);
    h = 6.2 * back * back;

    var cd = Math.sqrt(((x + 9.6) * (x + 9.6)) / (11.6 * 11.6) + ((z + 16.9) * (z + 16.9)) / (5.3 * 5.3));
    var plate = 1 - smoothstep(0.52, 1.0, cd);
    h = lerp(h, 5.85, plate);

    h += 1.25 * smoothstep(15, 23, Math.abs(x)) * smoothstep(-3, -13, z);
    h += 0.18 * Math.sin(x * 1.15 + z * 0.7) * outside;

    h *= outside;
    h += 0.55 * Math.max(0, 1 - Math.abs(z + 9.5) / 6.0) * smoothstep(1.0, 1.15, e);
    return Math.max(0, h);
  }

  var terrainGeo = new THREE.PlaneGeometry(TERRAIN_W, TERRAIN_D, 120, 100);
  terrainGeo.rotateX(-PI / 2);
  var tp = terrainGeo.attributes.position;
  var tcols = new Float32Array(tp.count * 3);
  var cLo = new THREE.Color(C.terr1), cMid = new THREE.Color(C.terr2), cHi = new THREE.Color(C.terr3);
  var cStone = new THREE.Color(0x837c6c), cStoneHi = new THREE.Color(0x938b78);
  var cc = new THREE.Color();
  for (var ti = 0; ti < tp.count; ti++) {
    var vx = tp.getX(ti), vz = tp.getZ(ti);
    var vy = groundHeight(vx, vz);
    tp.setY(ti, vy);
    var n1 = 0.5 + 0.5 * Math.sin(vx * 1.9 + vz * 1.3) * Math.cos(vx * 0.7 - vz * 1.9);
    var n2 = 0.5 + 0.5 * Math.sin(vx * 5.3 - vz * 2.7) * Math.cos(vx * 2.2 + vz * 3.1);
    cc.copy(cLo).lerp(cMid, clamp(0.3 + n1 * 0.55, 0, 1));
    if (vy > 1.0) cc.lerp(cHi, smoothstep(1.0, 4.4, vy) * 0.4);
    if (vy > 4.6) cc.lerp(cStone, smoothstep(4.6, 6.1, vy) * 0.42);
    cc.lerp(cStoneHi, smoothstep(5.6, 6.3, vy) * 0.16 * n2);
    cc.multiplyScalar(0.94 + n2 * 0.10);
    tcols[ti * 3] = cc.r; tcols[ti * 3 + 1] = cc.g; tcols[ti * 3 + 2] = cc.b;
  }
  terrainGeo.setAttribute('color', new THREE.BufferAttribute(tcols, 3));
  terrainGeo.computeVertexNormals();
  var terrain = new THREE.Mesh(terrainGeo, mat(0xffffff, { vertexColors: true, roughness: 1.0, flatShading: false }));
  terrain.position.y = 0.02;
  shadowify(terrain, false, true);
  world.add(terrain);

  /* ---------------------------------------------------------------- pitch */
  function makePitchTexture() {
    var W = 1024, H = 680, S = 2;
    var cv = document.createElement('canvas');
    cv.width = W * S; cv.height = H * S;
    var g = cv.getContext('2d');
    g.scale(S, S);
    g.fillStyle = '#3a5542';
    g.fillRect(0, 0, W, H);
    var bands = 24;
    for (var b = 0; b < bands; b++) {
      g.fillStyle = (b % 2 === 0) ? '#405f4a' : '#35503e';
      g.fillRect(Math.floor(b * W / bands), 0, Math.ceil(W / bands) + 1, H);
    }
    seed = 5511;
    for (var i = 0; i < 12000; i++) {
      var px = Math.floor(rand() * W), py = Math.floor(rand() * H);
      g.fillStyle = rand() < 0.5 ? 'rgba(30,54,40,0.11)' : 'rgba(150,182,148,0.07)';
      g.fillRect(px, py, 1, 1);
    }
    var grd = g.createRadialGradient(W * 0.4, H * 0.32, 30, W * 0.4, H * 0.32, W * 0.7);
    grd.addColorStop(0, 'rgba(197,216,180,0.10)');
    grd.addColorStop(1, 'rgba(197,216,180,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, W, H);

    function ell(rx, rz, w, col) {
      g.strokeStyle = col; g.lineWidth = w;
      g.beginPath(); g.ellipse(W / 2, H / 2, rx, rz, 0, 0, TAU); g.stroke();
    }
    ell(W * 0.456, H * 0.445, 7, 'rgba(238,232,213,0.9)');
    ell(W * 0.446, H * 0.430, 3, 'rgba(238,232,213,0.45)');
    g.strokeStyle = 'rgba(238,232,213,0.85)';
    g.lineWidth = 6;
    g.beginPath(); g.moveTo(W / 2, H / 2 - H * 0.43); g.lineTo(W / 2, H / 2 + H * 0.43); g.stroke();
    ell(W * 0.106, H * 0.19, 6, 'rgba(238,232,213,0.9)');
    ell(W * 0.017, H * 0.032, 5, 'rgba(238,232,213,0.9)');
    g.fillStyle = 'rgba(214,168,78,0.95)';
    g.beginPath(); g.ellipse(W / 2, H / 2, 9, 16, 0, 0, TAU); g.fill();
    g.fillStyle = 'rgba(250,242,225,0.9)';
    g.beginPath(); g.ellipse(W / 2, H / 2, 4, 9, 0, 0, TAU); g.fill();
    [0.068, 0.932].forEach(function (fx) {
      g.strokeStyle = 'rgba(238,232,213,0.82)';
      g.lineWidth = 6;
      g.beginPath(); g.ellipse(W * fx, H / 2, W * 0.082, H * 0.295, 0, 0, TAU); g.stroke();
      g.fillStyle = 'rgba(238,232,213,0.82)';
      g.fillRect(W * fx - 4, H / 2 - H * 0.295, 8, 22);
      g.fillRect(W * fx - 4, H / 2 + H * 0.295 - 22, 8, 22);
    });
    return smoothTex(new THREE.CanvasTexture(cv));
  }

  var PITCH_RX = 12.5, PITCH_RZ = 7.9;

  function ellipseGeometry(rx, rz, seg) {
    var s = new THREE.Shape();
    s.absellipse(0, 0, rx, rz, 0, TAU, false, 0);
    var geo = new THREE.ShapeGeometry(s, seg || 96);
    geo.rotateX(-PI / 2);
    var p = geo.attributes.position;
    var uv = new Float32Array(p.count * 2);
    for (var i = 0; i < p.count; i++) {
      uv[i * 2] = (p.getX(i) + rx) / (2 * rx);
      uv[i * 2 + 1] = 1.0 - (p.getZ(i) + rz) / (2 * rz);
    }
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return geo;
  }

  var pitchGroup = new THREE.Group();
  pitchGroup.position.set(0, 0, PITCH_Z);
  world.add(pitchGroup);

  var apronEdge = new THREE.Mesh(ellipseGeometry(PITCH_RX + 1.95, PITCH_RZ + 1.85, 96), mat(0xc2ad8a, { roughness: 1.0 }));
  apronEdge.position.y = 0.045;
  apronEdge.receiveShadow = true;
  pitchGroup.add(apronEdge);

  var apron = new THREE.Mesh(ellipseGeometry(PITCH_RX + 1.72, PITCH_RZ + 1.62, 96), mat(0xd8c8a7, { roughness: 1.0 }));
  apron.position.y = 0.058;
  apron.receiveShadow = true;
  pitchGroup.add(apron);

  var pitch = new THREE.Mesh(ellipseGeometry(PITCH_RX, PITCH_RZ, 128), new THREE.MeshStandardMaterial({
    map: makePitchTexture(), roughness: 0.99, metalness: 0, color: 0xffffff
  }));
  pitch.position.y = 0.075;
  pitch.receiveShadow = true;
  pitchGroup.add(pitch);

  /* ----------------------------------------------------- curved geometries */
  function stripGeometry(rx, rz, dr, y, a0, a1, seg) {
    var pos = [];
    function P(rad, ang, yy) { return [(rx + rad) * Math.cos(ang), yy, (rz + rad) * Math.sin(ang)]; }
    for (var i = 0; i < seg; i++) {
      var a = a0 + (a1 - a0) * i / seg, b = a0 + (a1 - a0) * (i + 1) / seg;
      var i0 = P(0, a, y), o0 = P(dr, a, y), i1 = P(0, b, y), o1 = P(dr, b, y);
      pos.push(i0[0], i0[1], i0[2], o0[0], o0[1], o0[2], o1[0], o1[1], o1[2]);
      pos.push(i0[0], i0[1], i0[2], o1[0], o1[1], o1[2], i1[0], i1[1], i1[2]);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    return geo;
  }

  function wallGeometry(rx, rz, off, y0, y1, a0, a1, seg) {
    var pos = [];
    function P(ang, yy) { return [(rx + off) * Math.cos(ang), yy, (rz + off) * Math.sin(ang)]; }
    for (var i = 0; i < seg; i++) {
      var a = a0 + (a1 - a0) * i / seg, b = a0 + (a1 - a0) * (i + 1) / seg;
      var p0 = P(a, y0), p1 = P(a, y1), p2 = P(b, y0), p3 = P(b, y1);
      pos.push(p0[0], p0[1], p0[2], p3[0], p3[1], p3[2], p2[0], p2[1], p2[2]);
      pos.push(p0[0], p0[1], p0[2], p1[0], p1[1], p1[2], p3[0], p3[1], p3[2]);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    return geo;
  }

  function stepGeometry(rx, rz, depth, yTop, riser, a0, a1, seg) {
    var pos = [];
    function P(rad, ang, yy) { return [(rx + rad) * Math.cos(ang), yy, (rz + rad) * Math.sin(ang)]; }
    for (var i = 0; i < seg; i++) {
      var a = a0 + (a1 - a0) * i / seg, b = a0 + (a1 - a0) * (i + 1) / seg;
      var t0 = P(0, a, yTop), t1 = P(depth, a, yTop), t2 = P(depth, b, yTop), t3 = P(0, b, yTop);
      pos.push(t0[0], t0[1], t0[2], t1[0], t1[1], t1[2], t2[0], t2[1], t2[2]);
      pos.push(t0[0], t0[1], t0[2], t2[0], t2[1], t2[2], t3[0], t3[1], t3[2]);
      var r0 = P(0, a, yTop - riser), r1 = P(0, a, yTop), r2 = P(0, b, yTop - riser), r3 = P(0, b, yTop);
      pos.push(r0[0], r0[1], r0[2], r1[0], r1[1], r1[2], r3[0], r3[1], r3[2]);
      pos.push(r0[0], r0[1], r0[2], r3[0], r3[1], r3[2], r2[0], r2[1], r2[2]);
    }
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    return geo;
  }

  /* -------------------------------------------------------------- stadium */
  var stadium = new THREE.Group();
  world.add(stadium);

  var standCX = 0, standCZ = PITCH_Z;
  var RIM_RX = 15.9, RIM_RZ = 11.0;
  var TIER_D = 1.2;
  var ARC_MAIN = [D(196), D(344)];
  var ARC_LEFT = [D(152), D(196)];
  var ARC_RIGHT = [D(344), D(388)];

  var seatColors = [0xbfab87, 0xc9b591, 0xb7a37e, 0xc3ae8a];
  var crowdBodies = [];
  var crowdHeads = [];
  var cheerFlags = [];
  var houseOrder = ['gryf', 'raven', 'slyth', 'huff'];

  function houseColor(house, accent) {
    switch (house) {
      case 'gryf': return accent ? C.gryfGold : C.gryf;
      case 'slyth': return accent ? C.slythSilver : C.slyth;
      case 'raven': return accent ? C.ravenBronze : C.raven;
      case 'huff': return accent ? C.huffDark : C.huff;
    }
    return C.cream;
  }

  function sectionForAngle(deg) {
    var d = ((deg % 360) + 360) % 360;
    if (d >= 196 && d < 233) return 'gryf';
    if (d >= 233 && d < 270) return 'raven';
    if (d >= 270 && d < 307) return 'slyth';
    if (d >= 307 && d < 344) return 'huff';
    if (d >= 344 || d < 28) return 'gryf';
    if (d >= 152 && d < 196) return 'raven';
    return null;
  }

  function buildStand(a0, a1, tiers) {
    var seg = Math.max(12, Math.floor((a1 - a0) * 18));
    for (var t = 0; t < tiers; t++) {
      var rx = RIM_RX + TIER_D * t;
      var rz = RIM_RZ + TIER_D * t;
      var yTop = 0.5 + t * 0.78;
      var step = new THREE.Mesh(stepGeometry(rx, rz, TIER_D + 0.02, yTop, 0.84, a0, a1, seg),
        new THREE.MeshStandardMaterial({ color: seatColors[t % seatColors.length], roughness: 0.96, metalness: 0, flatShading: true, side: THREE.DoubleSide }));
      step.receiveShadow = true;
      step.castShadow = true;
      stadium.add(step);

      var rail = new THREE.Mesh(wallGeometry(rx, rz, 0.02, yTop + 0.01, yTop + 0.24, a0, a1, seg),
        new THREE.MeshStandardMaterial({ color: 0x4d635f, roughness: 0.82, side: THREE.DoubleSide, flatShading: true }));
      rail.castShadow = false;
      rail.receiveShadow = false;
      stadium.add(rail);

      var arcLen = (a1 - a0) * (rx + rz) * 0.5;
      for (var row = 0; row < 2; row++) {
        var count = Math.floor(arcLen / 0.335);
        for (var i = 0; i < count; i++) {
          var frac = (i + 0.5 + row * 0.5) / count;
          var ang = a0 + (a1 - a0) * frac + rr(-0.005, 0.005);
          var rad = (row === 0 ? 0.3 : 0.86) + rr(-0.17, 0.17);
          var deg = ang * 180 / PI;
          var house = sectionForAngle(deg);
          var col = [0xd8ccb2, 0xb9a98c, 0x6e7065, 0xded5c3];
          if (house && rand() < 0.86) {
            col = [houseColor(house, false), houseColor(house, true), houseColor(house, false), houseColor(house, true)];
          } else if (rand() < 0.22 && house) {
            var other = pick(houseOrder);
            col = [houseColor(other, false), houseColor(other, true)];
          }
          var cB = new THREE.Color(col[ri(0, col.length - 1)]);
          cB.offsetHSL(0, rr(-0.02, 0.03), rr(-0.06, 0.05));
          var x = standCX + (rx + rad) * Math.cos(ang);
          var z = standCZ + (rz + rad) * Math.sin(ang);
          var hy = yTop + 0.14;
          crowdBodies.push({ x: x, z: z, y: hy, ry: Math.atan2(standCX - x, standCZ - z), c: cB, s: rr(0.86, 1.08) });
          crowdHeads.push({
            x: x, z: z, y: hy + 0.22,
            c: new THREE.Color(pick([0xe2b184, 0xc99a70, 0x8d6248, 0x6b4633, 0x3f2c22]))
          });
          if (rand() < 0.045) {
            cheerFlags.push({
              x: x, y: hy + 0.38, z: z,
              n: Math.atan2(-x, PITCH_Z - z) + PI / 2,
              c: new THREE.Color(house ? houseColor(house, rand() < 0.55) : C.creamHi),
              ph: rand() * TAU
            });
          }
        }
      }
    }

    var outerR = TIER_D * tiers;
    var backWall = new THREE.Mesh(
      wallGeometry(RIM_RX + outerR - 0.04, RIM_RZ + outerR - 0.04, 0, 0, 0.45 + (tiers - 1) * 0.78, a0, a1, seg),
      new THREE.MeshStandardMaterial({ color: C.creamLo, roughness: 0.98, side: THREE.DoubleSide, flatShading: true })
    );
    backWall.receiveShadow = true;
    backWall.castShadow = true;
    stadium.add(backWall);
  }

  buildStand(ARC_MAIN[0], ARC_MAIN[1], 4);
  buildStand(ARC_LEFT[0], ARC_LEFT[1], 3);
  buildStand(ARC_RIGHT[0], ARC_RIGHT[1], 3);

  var dummy = new THREE.Object3D();
  var bodyGeo = new THREE.BoxGeometry(0.23, 0.3, 0.16);
  bodyGeo.translate(0, 0.15, 0);
  var bodyMesh = new THREE.InstancedMesh(bodyGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), crowdBodies.length);
  var headGeo = new THREE.IcosahedronGeometry(0.088, 0);
  var headMesh = new THREE.InstancedMesh(headGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true }), crowdHeads.length);
  for (var ci = 0; ci < crowdBodies.length; ci++) {
    var cb = crowdBodies[ci];
    dummy.position.set(cb.x, cb.y, cb.z);
    dummy.rotation.set(0, cb.ry, 0);
    dummy.scale.setScalar(cb.s);
    dummy.updateMatrix();
    bodyMesh.setMatrixAt(ci, dummy.matrix);
    bodyMesh.setColorAt(ci, cb.c);
  }
  for (var hi = 0; hi < crowdHeads.length; hi++) {
    var hh = crowdHeads[hi];
    dummy.position.set(hh.x, hh.y, hh.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.setScalar(1);
    dummy.updateMatrix();
    headMesh.setMatrixAt(hi, dummy.matrix);
    headMesh.setColorAt(hi, hh.c);
  }
  bodyMesh.instanceMatrix.needsUpdate = true;
  headMesh.instanceMatrix.needsUpdate = true;
  if (bodyMesh.instanceColor) bodyMesh.instanceColor.needsUpdate = true;
  if (headMesh.instanceColor) headMesh.instanceColor.needsUpdate = true;
  bodyMesh.receiveShadow = true;
  bodyMesh.castShadow = false;
  stadium.add(bodyMesh, headMesh);

  var flagGeo = new THREE.BufferGeometry();
  flagGeo.setAttribute('position', new THREE.Float32BufferAttribute([
    0, 0, 0, 0.28, 0.08, 0, 0.28, -0.1, 0
  ], 3));
  flagGeo.computeVertexNormals();
  var cheerMesh = new THREE.InstancedMesh(
    flagGeo,
    new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.9, side: THREE.DoubleSide, flatShading: true }),
    cheerFlags.length
  );
  for (var fi = 0; fi < cheerFlags.length; fi++) {
    var cf = cheerFlags[fi];
    cf.base = new THREE.Object3D();
    cf.base.position.set(cf.x, cf.y, cf.z);
    cf.base.rotation.set(0, cf.n + rr(-1.0, 1.0), rr(-0.2, 0.2));
    cf.base.updateMatrix();
    cheerMesh.setMatrixAt(fi, cf.base.matrix);
    cheerMesh.setColorAt(fi, cf.c);
  }
  cheerMesh.instanceMatrix.needsUpdate = true;
  if (cheerMesh.instanceColor) cheerMesh.instanceColor.needsUpdate = true;
  stadium.add(cheerMesh);
  updaters.push(function (t) {
    for (var i = 0; i < cheerFlags.length; i++) {
      var cf = cheerFlags[i];
      var o = cf.base;
      o.rotation.z = Math.sin(t * 5.0 + cf.ph) * 0.35;
      o.rotation.y = cf.n + Math.sin(t * 2.1 + cf.ph) * 0.25;
      o.updateMatrix();
      cheerMesh.setMatrixAt(i, o.matrix);
    }
    cheerMesh.instanceMatrix.needsUpdate = true;
  });

  var underWall = new THREE.Mesh(wallGeometry(RIM_RX, RIM_RZ, 0, 0, 0.5, D(152), D(388), 140),
    new THREE.MeshStandardMaterial({ color: C.stone, roughness: 1.0, side: THREE.DoubleSide, flatShading: true }));
  underWall.receiveShadow = true;
  stadium.add(underWall);

  /* ------------------------------------- open-air grandstand colonnade */
  var grandstand = new THREE.Group();
  stadium.add(grandstand);
  var beamOuterX = RIM_RX + 4 * TIER_D + 0.24;
  var beamOuterZ = RIM_RZ + 4 * TIER_D + 0.24;
  var beamY = 4.15;

  for (var pi = 0; pi < 9; pi++) {
    var pa = ARC_MAIN[0] + (ARC_MAIN[1] - ARC_MAIN[0]) * (pi / 8);
    var px = beamOuterX * Math.cos(pa);
    var pz = PITCH_Z + beamOuterZ * Math.sin(pa);
    var post = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.12, beamY, 6), mat(C.creamHi));
    post.position.set(px, beamY / 2, pz);
    post.castShadow = true;
    post.receiveShadow = true;
    grandstand.add(post);
    var cap = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.28, 6), mat(C.slateDeep));
    cap.position.set(px, beamY + 0.22, pz);
    cap.castShadow = true;
    grandstand.add(cap);
  }
  var architrave = new THREE.Mesh(
    wallGeometry(beamOuterX, beamOuterZ, 0, beamY, beamY + 0.22, ARC_MAIN[0], ARC_MAIN[1], 46),
    new THREE.MeshStandardMaterial({ color: C.creamHi, roughness: 0.9, side: THREE.DoubleSide, flatShading: true })
  );
  architrave.castShadow = true;
  grandstand.add(architrave);
  var archGold = new THREE.Mesh(
    wallGeometry(beamOuterX, beamOuterZ, 0.03, beamY + 0.22, beamY + 0.3, ARC_MAIN[0], ARC_MAIN[1], 46),
    mat(C.gold, { roughness: 0.5, metalness: 0.35, side: THREE.DoubleSide })
  );
  grandstand.add(archGold);
  var archTop = new THREE.Mesh(
    stripGeometry(beamOuterX, beamOuterZ, 0.34, beamY + 0.3, ARC_MAIN[0], ARC_MAIN[1], 46),
    mat(C.creamLo, { roughness: 0.95, side: THREE.DoubleSide })
  );
  grandstand.add(archTop);

  /* --------------------------------------------------- house banners */
  function drawShield(g, cx, cy, w, h, field, metal, house) {
    g.save();
    g.beginPath();
    g.moveTo(cx - w / 2, cy - h / 2);
    g.lineTo(cx + w / 2, cy - h / 2);
    g.lineTo(cx + w / 2, cy + h * 0.12);
    g.quadraticCurveTo(cx + w * 0.38, cy + h * 0.34, cx, cy + h / 2);
    g.quadraticCurveTo(cx - w * 0.38, cy + h * 0.34, cx - w / 2, cy + h * 0.12);
    g.closePath();
    g.fillStyle = metal;
    g.fill();
    g.beginPath();
    var inset = w * 0.06;
    g.moveTo(cx - w / 2 + inset, cy - h / 2 + inset);
    g.lineTo(cx + w / 2 - inset, cy - h / 2 + inset);
    g.lineTo(cx + w / 2 - inset, cy + h * 0.1);
    g.quadraticCurveTo(cx + w * 0.36, cy + h * 0.31, cx, cy + h / 2 - inset);
    g.quadraticCurveTo(cx - w * 0.36, cy + h * 0.31, cx - w / 2 + inset, cy + h * 0.1);
    g.closePath();
    g.fillStyle = field;
    g.fill();
    g.strokeStyle = metal;
    g.lineWidth = w * 0.025;
    g.stroke();

    g.save();
    g.translate(cx, cy + h * 0.03);
    g.fillStyle = metal;
    if (house === 'gryf') {
      g.beginPath(); g.arc(0, -h * 0.04, w * 0.17, 0, TAU); g.fill();
      for (var m = 0; m < 10; m++) {
        var an = m / 10 * TAU;
        g.beginPath();
        g.moveTo(Math.cos(an) * w * 0.17, -h * 0.04 + Math.sin(an) * w * 0.17);
        g.lineTo(Math.cos(an + 0.35) * w * 0.28, -h * 0.04 + Math.sin(an + 0.35) * w * 0.28);
        g.lineTo(Math.cos(an + 0.7) * w * 0.17, -h * 0.04 + Math.sin(an + 0.7) * w * 0.17);
        g.fill();
      }
      g.beginPath(); g.ellipse(w * 0.02, h * 0.13, w * 0.22, h * 0.15, -0.25, 0, TAU); g.fill();
      g.fillRect(w * 0.18, h * 0.1, w * 0.17, h * 0.05);
      g.beginPath(); g.arc(w * 0.34, h * 0.07, w * 0.05, 0, TAU); g.fill();
      g.fillStyle = field;
      g.beginPath(); g.arc(-w * 0.04, -h * 0.05, w * 0.025, 0, TAU); g.fill();
      g.beginPath(); g.arc(w * 0.04, -h * 0.05, w * 0.025, 0, TAU); g.fill();
    } else if (house === 'slyth') {
      g.lineWidth = w * 0.11;
      g.strokeStyle = metal;
      g.lineCap = 'round';
      g.beginPath();
      g.moveTo(-w * 0.25, h * 0.25);
      g.bezierCurveTo(w * 0.2, h * 0.28, -w * 0.25, -h * 0.22, w * 0.18, -h * 0.24);
      g.stroke();
      g.beginPath();
      g.moveTo(w * 0.1, -h * 0.3); g.lineTo(w * 0.33, -h * 0.2); g.lineTo(w * 0.1, -h * 0.12);
      g.closePath(); g.fill();
    } else if (house === 'raven') {
      g.beginPath();
      g.moveTo(0, -h * 0.04);
      g.lineTo(-w * 0.34, -h * 0.2); g.lineTo(-w * 0.22, h * 0.02); g.lineTo(-w * 0.34, h * 0.08);
      g.lineTo(0, h * 0.2);
      g.lineTo(w * 0.34, h * 0.08); g.lineTo(w * 0.22, h * 0.02); g.lineTo(w * 0.34, -h * 0.2);
      g.closePath(); g.fill();
      g.beginPath(); g.ellipse(0, h * 0.02, w * 0.07, h * 0.17, 0, 0, TAU); g.fill();
      g.beginPath(); g.arc(0, -h * 0.13, w * 0.065, 0, TAU); g.fill();
    } else {
      g.beginPath(); g.ellipse(0, 0, w * 0.23, h * 0.19, 0, 0, TAU); g.fill();
      g.beginPath();
      g.moveTo(-w * 0.17, h * 0.08); g.lineTo(-w * 0.23, h * 0.27); g.lineTo(-w * 0.06, h * 0.17);
      g.moveTo(w * 0.17, h * 0.08); g.lineTo(w * 0.23, h * 0.27); g.lineTo(w * 0.06, h * 0.17);
      g.fill();
      g.fillStyle = field;
      g.beginPath(); g.ellipse(0, h * 0.09, w * 0.09, h * 0.06, 0, 0, TAU); g.fill();
      g.fillStyle = '#2c2922';
      g.beginPath(); g.arc(-w * 0.07, -h * 0.02, w * 0.025, 0, TAU); g.fill();
      g.beginPath(); g.arc(w * 0.07, -h * 0.02, w * 0.025, 0, TAU); g.fill();
    }
    g.restore();
    g.restore();
  }

  function makeBannerTexture(house) {
    var W = 192, H = 288, S = 2;
    var cv = document.createElement('canvas');
    cv.width = W * S; cv.height = H * S;
    var g = cv.getContext('2d');
    g.scale(S, S);
    var field, metal, dark;
    if (house === 'gryf') { field = '#a52c2f'; metal = '#efc35a'; dark = '#6e1d20'; }
    else if (house === 'slyth') { field = '#2f6b4d'; metal = '#dfe6dc'; dark = '#1c4232'; }
    else if (house === 'raven') { field = '#3c588a'; metal = '#c99658'; dark = '#25375a'; }
    else { field = '#e0b93e'; metal = '#332f27'; dark = '#b18f22'; }

    g.clearRect(0, 0, W, H);
    g.beginPath();
    g.moveTo(3, 0); g.lineTo(W - 3, 0); g.lineTo(W - 3, H - 4);
    g.lineTo(W * 0.5, H - 48); g.lineTo(3, H - 4);
    g.closePath();
    g.fillStyle = field;
    g.fill();
    g.save();
    g.clip();
    for (var x = 0; x < W; x += 8) {
      g.fillStyle = (x / 8) % 2 === 0 ? 'rgba(0,0,0,0.05)' : 'rgba(255,255,255,0.035)';
      g.fillRect(x, 0, 8, H);
    }
    g.fillStyle = dark;
    g.fillRect(0, 0, W, 28);
    g.fillStyle = metal;
    for (var d = 10; d < W; d += 18) g.fillRect(d, 12, 6, 3);
    g.strokeStyle = metal;
    g.lineWidth = 7;
    g.strokeRect(8, 2, W - 16, H - 14);
    g.lineWidth = 2;
    g.strokeStyle = 'rgba(246,240,224,0.6)';
    g.strokeRect(14, 8, W - 28, H - 24);
    drawShield(g, W / 2, H * 0.42, W * 0.56, H * 0.4, field, metal, house);
    g.fillStyle = metal;
    g.fillRect(W * 0.32, H * 0.72, W * 0.36, 3);
    g.fillRect(W * 0.4, H * 0.76, W * 0.2, 2);
    for (var s = 0; s < 5; s++) {
      g.beginPath(); g.arc(W * (0.2 + s * 0.15), H * 0.83, 2.2, 0, TAU); g.fill();
    }
    g.restore();

    return smoothTex(new THREE.CanvasTexture(cv));
  }

  function makeFlagTexture(house) {
    var W = 192, H = 112, S = 2;
    var cv = document.createElement('canvas');
    cv.width = W * S; cv.height = H * S;
    var g = cv.getContext('2d');
    g.scale(S, S);
    var field, metal, dark;
    if (house === 'gryf') { field = '#a52c2f'; metal = '#efc35a'; dark = '#6e1d20'; }
    else if (house === 'slyth') { field = '#2f6b4d'; metal = '#dfe6dc'; dark = '#1c4232'; }
    else if (house === 'raven') { field = '#3c588a'; metal = '#c99658'; dark = '#25375a'; }
    else { field = '#e0b93e'; metal = '#332f27'; dark = '#b18f22'; }
    g.fillStyle = field;
    g.fillRect(0, 0, W, H);
    g.fillStyle = dark;
    g.fillRect(0, 0, W, 16);
    g.fillRect(0, H - 16, W, 16);
    g.fillStyle = metal;
    g.fillRect(0, 16, W, 4);
    g.fillRect(0, H - 20, W, 4);
    drawShield(g, W / 2, H / 2, W * 0.3, H * 0.6, field, metal, house);
    for (var i = 0; i < 4; i++) {
      g.fillStyle = i % 2 ? metal : 'rgba(255,255,255,0.25)';
      g.fillRect(8 + i * 10, H / 2 - 2, 5, 5);
      g.fillRect(W - 18 - i * 10, H / 2 - 2, 5, 5);
    }
    return smoothTex(new THREE.CanvasTexture(cv));
  }

  var cloths = [];
  function makeCloth(geo, texture, opts) {
    var m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({
      map: texture, transparent: true, alphaTest: 0.35,
      side: THREE.DoubleSide, roughness: 0.92, metalness: 0,
      emissive: 0xffffff, emissiveMap: texture, emissiveIntensity: 0.22
    }));
    m.castShadow = true;
    m.receiveShadow = true;
    cloths.push({
      mesh: m, base: geo.attributes.position.array.slice(0),
      phase: rr(0, TAU), amp: (opts && opts.amp) || 0.055,
      speed: (opts && opts.speed) || 1.6, maxHang: (opts && opts.maxHang) || 2.2
    });
    return m;
  }

  function addBanner(house, angleDeg) {
    var ang = D(angleDeg);
    var g = new THREE.Group();
    var px = (RIM_RX + 4 * TIER_D + 0.3) * Math.cos(ang);
    var pz = PITCH_Z + (RIM_RZ + 4 * TIER_D + 0.3) * Math.sin(ang);
    g.position.set(px, 0, pz);
    var poleH = 6.5;
    var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, poleH, 6), mat(C.creamHi, { roughness: 0.75 }));
    pole.position.y = poleH / 2;
    pole.castShadow = true;
    g.add(pole);
    var finial = new THREE.Mesh(new THREE.SphereGeometry(0.12, 6, 4), mat(C.goldHi, { metalness: 0.5, roughness: 0.3 }));
    finial.position.y = poleH + 0.08;
    g.add(finial);
    var geo = new THREE.PlaneGeometry(1.8, 2.7, 7, 12);
    geo.translate(0, -1.35, 0);
    var cloth = makeCloth(geo, makeBannerTexture(house), { amp: 0.05, speed: 1.2, maxHang: 2.7 });
    cloth.position.set(0.05, poleH - 0.15, 0.03);
    cloth.rotation.y = PI / 4 + 0.06;     // face the open side of the stand
    g.add(cloth);
    var rod = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 1.95, 6), mat(C.gold, { metalness: 0.5, roughness: 0.4 }));
    rod.rotation.z = PI / 2;
    rod.rotation.y = PI / 4;
    rod.position.set(0.05, poleH - 0.13, 0.03);
    g.add(rod);
    grandstand.add(g);
  }
  addBanner('gryf', 207);
  addBanner('raven', 248);
  addBanner('slyth', 292);
  addBanner('huff', 333);

  /* --------------------------------------------------------- stand towers */
  function addStandTower(angleDeg, h, r, house) {
    var a = D(angleDeg);
    var x = 21.2 * Math.cos(a);
    var z = PITCH_Z + 16.4 * Math.sin(a);
    var g = new THREE.Group();
    g.position.set(x, 0, z);
    var body = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.92, r, h, 8), mat(C.stoneHi));
    body.position.y = h / 2; body.castShadow = true; body.receiveShadow = true;
    g.add(body);
    var band1 = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.03, r + 0.03, 0.14, 8), mat(C.creamHi));
    band1.position.y = h * 0.55; g.add(band1);
    var band2 = new THREE.Mesh(new THREE.CylinderGeometry(r + 0.08, r + 0.1, 0.2, 8), mat(C.creamLo));
    band2.position.y = h; g.add(band2);
    var roofCone = new THREE.Mesh(new THREE.ConeGeometry(r + 0.22, 2.4, 8), mat(C.slate));
    roofCone.position.y = h + 1.27; roofCone.castShadow = true; g.add(roofCone);
    var fin = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 4), mat(C.gold, { metalness: 0.45, roughness: 0.4 }));
    fin.position.y = h + 2.7; g.add(fin);
    var ball = new THREE.Mesh(new THREE.SphereGeometry(0.08, 6, 4), mat(C.goldHi, { metalness: 0.5, roughness: 0.3 }));
    ball.position.y = h + 3.0; g.add(ball);
    var bannerGeo = new THREE.PlaneGeometry(0.62, 1.1);
    bannerGeo.translate(0, -0.55, 0);
    var ban = new THREE.Mesh(bannerGeo, new THREE.MeshStandardMaterial({ map: makeFlagTexture(house), side: THREE.DoubleSide, roughness: 0.9 }));
    ban.position.set(0, h - 0.25, r + 0.06);
    ban.rotation.x = -0.05;
    g.add(ban);
    for (var wy = 0; wy < 3; wy++) {
      for (var wi = 0; wi < 2; wi++) {
        var wa = (wi === 0 ? -0.5 : 0.5);
        var wgeo = new THREE.BoxGeometry(0.22, 0.34, 0.05);
        var wm = new THREE.Mesh(wgeo, mat(wy === 1 ? C.window : C.creamHi, wy === 1 ? { emissive: C.windowSoft, emissiveIntensity: 0.35 } : {}));
        wm.position.set(Math.sin(wa) * (r * 0.96), h * 0.22 + wy * h * 0.24, Math.cos(wa) * (r * 0.96));
        wm.rotation.y = wa;
        g.add(wm);
      }
    }
    stadium.add(g);
  }
  addStandTower(194, 7.4, 0.95, 'gryf');
  addStandTower(346, 7.9, 0.95, 'slyth');

  /* --------------------------------------------------- near balustrade */
  var balustrade = new THREE.Group();
  stadium.add(balustrade);

  function addBalustradeArc(a0, a1) {
    var seg = 22;
    var w = new THREE.Mesh(
      wallGeometry(RIM_RX, RIM_RZ, 0, 0, 0.5, a0, a1, seg),
      new THREE.MeshStandardMaterial({ color: C.stoneHi, roughness: 0.98, side: THREE.DoubleSide, flatShading: true })
    );
    w.castShadow = true; w.receiveShadow = true;
    balustrade.add(w);
    var cap = new THREE.Mesh(stripGeometry(RIM_RX, RIM_RZ, 0.22, 0.55, a0, a1, seg), mat(C.creamHi));
    cap.castShadow = true;
    balustrade.add(cap);
    var inner = new THREE.Mesh(
      wallGeometry(RIM_RX, RIM_RZ, 0.22, 0.3, 0.56, a0, a1, seg),
      new THREE.MeshStandardMaterial({ color: C.creamLo, roughness: 1.0, side: THREE.DoubleSide, flatShading: true })
    );
    balustrade.add(inner);
  }
  addBalustradeArc(D(390), D(436));
  addBalustradeArc(D(464), D(510));

  function addPillar(angleDeg) {
    var a = D(angleDeg);
    var x = RIM_RX * Math.cos(a), z = PITCH_Z + RIM_RZ * Math.sin(a);
    var g = new THREE.Group();
    g.position.set(x, 0, z);
    var p = new THREE.Mesh(new THREE.BoxGeometry(0.55, 2.0, 0.55), mat(C.creamHi));
    p.position.y = 1.0; p.castShadow = true; p.receiveShadow = true;
    g.add(p);
    var cap = new THREE.Mesh(new THREE.BoxGeometry(0.75, 0.16, 0.75), mat(C.creamLo));
    cap.position.y = 2.08; g.add(cap);
    var ball = new THREE.Mesh(new THREE.SphereGeometry(0.18, 6, 4), mat(C.gold, { metalness: 0.5, roughness: 0.4 }));
    ball.position.y = 2.32; g.add(ball);
    balustrade.add(g);
  }
  addPillar(436); addPillar(464); addPillar(390); addPillar(510);

  /* ----------------------------------------------------- path to the pitch */
  var path = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 4.1), mat(0xd6c5a2, { roughness: 1.0 }));
  path.rotation.x = -PI / 2;
  path.position.set(0, 0.04, 16.6);
  path.receiveShadow = true;
  world.add(path);
  var pathLine = new THREE.Mesh(new THREE.PlaneGeometry(0.08, 4.0), mat(C.creamHi, { roughness: 1.0 }));
  pathLine.rotation.x = -PI / 2;
  pathLine.position.set(0, 0.05, 16.6);
  world.add(pathLine);

  function addHedge(x, z, w, d, h, color) {
    var m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat(color));
    m.position.set(x, h / 2 + 0.03, z);
    m.castShadow = true; m.receiveShadow = true;
    world.add(m);
    return m;
  }
  addHedge(-3.4, 16.0, 0.55, 2.6, 0.4, 0x53684e);
  addHedge(3.4, 16.0, 0.55, 2.6, 0.4, 0x53684e);

  function addTeamTent(sign, team) {
    var isG = team === 'gryf';
    var accent = isG ? C.gryfGold : C.slythSilver;
    var body = isG ? C.gryf : C.slyth;
    var dark = isG ? C.gryfDark : C.slythDark;
    var g = new THREE.Group();
    g.position.set(sign * 6.6, 0, 14.75);
    g.rotation.y = sign > 0 ? -0.12 : 0.12;
    // platform
    var plat = new THREE.Mesh(new THREE.BoxGeometry(3.2, 0.16, 2.3), mat(C.creamLo));
    plat.position.y = 0.08; plat.receiveShadow = true; plat.castShadow = true;
    g.add(plat);
    // posts
    for (var sx = -1; sx <= 1; sx += 2) {
      for (var sz = -1; sz <= 1; sz += 2) {
        var post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.06, 1.5, 5), mat(C.wood));
        post.position.set(sx * 1.3, 0.9, sz * 0.85);
        post.castShadow = true;
        g.add(post);
      }
    }
    // counter
    var counter = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.7, 0.5), mat(C.wood));
    counter.position.set(0, 0.5, 0.75);
    counter.castShadow = true; counter.receiveShadow = true;
    g.add(counter);
    var cloth = new THREE.Mesh(new THREE.BoxGeometry(2.9, 0.08, 0.56), mat(C.creamHi));
    cloth.position.set(0, 0.86, 0.75);
    g.add(cloth);
    // striped canvas roof, pyramid-ish gable
    var roofShape = new THREE.BufferGeometry();
    var rw = 1.75, rd = 1.25, rh = 0.85, ry = 1.56;
    var verts = [
      -rw, ry, -rd, rw, ry, -rd, rw, ry, rd, -rw, ry, rd, 0, ry + rh, 0
    ];
    var faces = [
      verts[0], verts[1], verts[4], verts[1], verts[2], verts[4],
      verts[2], verts[3], verts[4], verts[3], verts[0], verts[4]
    ];
    roofShape.setAttribute('position', new THREE.Float32BufferAttribute(faces, 3));
    roofShape.computeVertexNormals();
    var roof = new THREE.Mesh(roofShape, new THREE.MeshStandardMaterial({ color: body, roughness: 0.9, flatShading: true }));
    roof.castShadow = true; roof.receiveShadow = true;
    g.add(roof);
    // canvas stripes
    for (var st = -2; st <= 2; st++) {
      var stripe = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.035, 2.4), mat(accent));
      stripe.position.set(st * 0.52, ry + 0.3 - Math.abs(st) * 0.08, 0);
      stripe.rotation.z = -st * 0.12;
      stripe.rotation.x = 0.0;
      g.add(stripe);
    }
    // little pennant
    var fp = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 1.0, 4), mat(C.gold));
    fp.position.set(1.2, 2.4, -0.7);
    g.add(fp);
    var fg2 = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.3, 4, 2), new THREE.MeshStandardMaterial({ map: makeFlagTexture(team), side: THREE.DoubleSide, roughness: 0.9 }));
    fg2.position.set(1.45, 2.72, -0.7);
    fg2.rotation.y = PI / 4;
    g.add(fg2);
    // crates & a loose quaffle
    var crate = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.45), mat(C.wood));
    crate.position.set(-1.55, 0.33, 0.55); crate.castShadow = true;
    g.add(crate);
    var ball = new THREE.Mesh(new THREE.SphereGeometry(0.13, 7, 5), mat(C.quaffle));
    ball.position.set(-1.45, 0.72, 0.55);
    g.add(ball);
    var lean = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.05, 1.8, 5), mat(0xa17a4e));
    lean.position.set(1.45, 0.95, 0.55);
    lean.rotation.z = 0.22; lean.rotation.x = -0.1;
    lean.castShadow = true;
    g.add(lean);
    g.traverse(function (o) { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    world.add(g);
  }
  addTeamTent(-1, 'gryf');
  addTeamTent(1, 'slyth');

  /* ------------------------------------------------------------- goal hoops */
  function addGoals(sign) {
    var g = new THREE.Group();
    g.position.set(sign * 12.1, 0, PITCH_Z);
    var ringY = [3.25, 4.3, 5.35];
    var zOff = [-2.45, 0, 2.45];
    for (var i = 0; i < 3; i++) {
      var zz = zOff[i];
      var plinth = new THREE.Mesh(new THREE.CylinderGeometry(0.4, 0.5, 0.28, 8), mat(C.creamLo));
      plinth.position.set(0, 0.14, zz);
      plinth.castShadow = true; plinth.receiveShadow = true;
      g.add(plinth);
      var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.09, 0.13, ringY[i] - 0.55, 7), mat(C.gold, { metalness: 0.5, roughness: 0.36 }));
      pole.position.set(0, (ringY[i] - 0.55) / 2 + 0.28, zz);
      pole.castShadow = true;
      g.add(pole);
      var ring = new THREE.Mesh(new THREE.TorusGeometry(0.98, 0.12, 6, 22), mat(C.goldHi, {
        metalness: 0.5, roughness: 0.32, emissive: 0x8a5a0d, emissiveIntensity: 0.32
      }));
      ring.rotation.y = PI / 2;
      ring.position.set(0, ringY[i], zz);
      ring.castShadow = true;
      g.add(ring);
      var knob = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 4), mat(C.goldHi, { metalness: 0.6, roughness: 0.3 }));
      knob.position.set(0, ringY[i] + 1.07, zz);
      g.add(knob);
      var tick = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.22, 4), mat(C.gryfGold));
      tick.position.set(0, ringY[i] + 1.19, zz);
      tick.castShadow = true;
      g.add(tick);
    }
    var rail = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.16, 5.1), mat(C.creamHi));
    rail.position.set(0, 0.32, 0);
    rail.castShadow = true;
    g.add(rail);
    world.add(g);
  }
  addGoals(1);
  addGoals(-1);

  /* ------------------------------------------------ team pennants at goals */
  function makePennantTexture(house) {
    var W = 192, H = 64, S = 2;
    var cv = document.createElement('canvas');
    cv.width = W * S; cv.height = H * S;
    var g = cv.getContext('2d');
    g.scale(S, S);
    var a, b, c;
    if (house === 'gryf') { a = '#8f2529'; b = '#e0b44a'; c = '#631a1c'; }
    else if (house === 'slyth') { a = '#23543d'; b = '#cfd8cc'; c = '#153426'; }
    else if (house === 'raven') { a = '#2e456b'; b = '#c0874a'; c = '#1d2c46'; }
    else { a = '#d4ae3a'; b = '#2f2b24'; c = '#a8861f'; }
    g.fillStyle = a; g.fillRect(0, 0, W, H);
    g.fillStyle = b; g.fillRect(0, 0, W, 9); g.fillRect(0, H - 9, W, 9);
    g.fillStyle = c; g.fillRect(0, 9, W, 4); g.fillRect(0, H - 13, W, 4);
    for (var i = 0; i < 7; i++) {
      g.fillStyle = i % 2 ? b : 'rgba(255,255,255,0.22)';
      g.beginPath();
      g.moveTo(18 + i * 24, H / 2 - 7);
      g.lineTo(30 + i * 24, H / 2);
      g.lineTo(18 + i * 24, H / 2 + 7);
      g.closePath(); g.fill();
    }
    return smoothTex(new THREE.CanvasTexture(cv));
  }

  function addBigFlag(sign, house) {
    var g = new THREE.Group();
    g.position.set(sign * 14.8, 0, PITCH_Z + 0.3);
    var poleH = 7.5;
    var pole = new THREE.Mesh(new THREE.CylinderGeometry(0.055, 0.085, poleH, 6), mat(C.creamHi, { roughness: 0.7 }));
    pole.position.y = poleH / 2;
    pole.castShadow = true;
    g.add(pole);
    var ball = new THREE.Mesh(new THREE.SphereGeometry(0.13, 6, 4), mat(C.goldHi, { metalness: 0.5, roughness: 0.3 }));
    ball.position.y = poleH + 0.1;
    g.add(ball);
    // long team pennant, clear of the golden hoops
    var pennantGeo = new THREE.BufferGeometry();
    var segs = 10, len = 2.6;
    var verts = [];
    for (var i = 0; i < segs; i++) {
      var x0 = len * i / segs, x1 = len * (i + 1) / segs;
      var h0 = 0.46 * (1 - 0.85 * (i / segs));
      var h1 = 0.46 * (1 - 0.85 * ((i + 1) / segs));
      verts.push(x0, h0 / 2, 0, x1, h1 / 2, 0, x1, -h1 / 2, 0);
      verts.push(x0, h0 / 2, 0, x1, -h1 / 2, 0, x0, -h0 / 2, 0);
    }
    pennantGeo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
    pennantGeo.setAttribute('uv', new THREE.Float32BufferAttribute((function () {
      var u = [];
      for (var i = 0; i < segs; i++) {
        var x0 = i / segs, x1 = (i + 1) / segs;
        u.push(x0, 1, x1, 1, x1, 0, x0, 1, x1, 0, x0, 0);
      }
      return u;
    })(), 2));
    pennantGeo.computeVertexNormals();
    var pennant = makeCloth(pennantGeo, makePennantTexture(house), { amp: 0.22, speed: 2.6, maxHang: 0.5 });
    pennant.position.set(0.02, poleH - 0.28, 0);
    pennant.rotation.y = sign > 0 ? PI : 0;
    g.add(pennant);
    // little ribbon at the tip
    var tip = new THREE.Mesh(new THREE.SphereGeometry(0.06, 5, 3), mat(C.goldHi, { metalness: 0.5, roughness: 0.35 }));
    tip.position.set(sign > 0 ? -len : len, poleH - 0.28, 0);
    g.add(tip);
    world.add(g);
  }
  addBigFlag(-1, 'gryf');
  addBigFlag(1, 'slyth');

  /* ---------------------------------------------------------- castle */
  var castle = new THREE.Group();
  var CASTLE_X = -9.6, CASTLE_Z = -16.9, CASTLE_Y = 5.85;
  castle.position.set(CASTLE_X, CASTLE_Y, CASTLE_Z);
  castle.rotation.y = 0.055;
  castle.scale.setScalar(1.08);
  world.add(castle);

  var stoneMat = mat(C.stone, { roughness: 0.98 });
  var stoneLight = mat(C.stoneHi, { roughness: 0.96 });
  var stoneDark = mat(C.stoneLo, { roughness: 1.0 });
  var roofMat = mat(C.slate, { roughness: 0.94 });
  var roofMat2 = mat(0x4a6167, { roughness: 0.94 });
  var trimMat = mat(C.creamHi, { roughness: 0.9 });

  var merlons = [];
  var litWindows = [];
  var dimWindows = [];
  var castleFlags = [];

  function cbox(w, h, d, x, y, z, m, opts) {
    var b = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    b.position.set(x, y + h / 2, z);
    b.castShadow = !(opts && opts.noCast);
    b.receiveShadow = true;
    if (opts && opts.ry) b.rotation.y = opts.ry;
    castle.add(b);
    return b;
  }

  function merlonRow(x0, z0, x1, z1, y, step) {
    var dx = x1 - x0, dz = z1 - z0;
    var len = Math.sqrt(dx * dx + dz * dz);
    var n = Math.max(2, Math.floor(len / step));
    var angle = Math.atan2(dx, dz);
    for (var i = 0; i < n; i++) {
      var t = (i + 0.5) / n;
      merlons.push({ x: x0 + dx * t, y: y, z: z0 + dz * t, ry: angle + PI / 2, s: [0.3, 0.42, 0.28] });
    }
  }

  function merlonRing(cx, cz, r, y, n) {
    for (var i = 0; i < n; i++) {
      var a = i / n * TAU;
      merlons.push({ x: cx + Math.cos(a) * r, y: y, z: cz + Math.sin(a) * r, ry: -a + PI / 2, s: [0.24, 0.36, 0.22] });
    }
  }

  function addWindows(x, y, z, ry, cols, rows, spacingX, spacingY, offsetZ, litChance) {
    for (var c = 0; c < cols; c++) {
      for (var r = 0; r < rows; r++) {
        var lx = (c - (cols - 1) / 2) * spacingX;
        var wx = x + Math.cos(ry) * lx + Math.sin(ry) * offsetZ;
        var wz = z - Math.sin(ry) * lx + Math.cos(ry) * offsetZ;
        (rand() < litChance ? litWindows : dimWindows).push({ x: wx, y: y + r * spacingY, z: wz, ry: ry });
      }
    }
  }

  function addTower(x, z, radius, height, roofH, opts) {
    opts = opts || {};
    var seg = opts.seg || 9;
    var body = new THREE.Mesh(new THREE.CylinderGeometry(radius * 0.96, radius, height, seg), opts.mat || stoneMat);
    body.position.set(x, height / 2, z);
    body.castShadow = true; body.receiveShadow = true;
    castle.add(body);
    var bands = opts.bands || 2;
    for (var b = 1; b <= bands; b++) {
      var band = new THREE.Mesh(new THREE.CylinderGeometry(radius * (1.0 + 0.015 * b), radius * (1.0 + 0.02 * b), 0.09, seg), trimMat);
      band.position.set(x, height * b / (bands + 1), z);
      castle.add(band);
    }
    var eave = new THREE.Mesh(new THREE.CylinderGeometry(radius + 0.16, radius + 0.1, 0.18, seg), trimMat);
    eave.position.set(x, height, z);
    eave.castShadow = true;
    castle.add(eave);
    if (roofH > 0) {
      var roofCone = new THREE.Mesh(new THREE.ConeGeometry(radius + 0.28, roofH, seg), opts.roof || roofMat);
      roofCone.position.set(x, height + roofH / 2 + 0.1, z);
      roofCone.castShadow = true;
      castle.add(roofCone);
      var fin = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.55, 4), mat(C.gold, { metalness: 0.4, roughness: 0.5 }));
      fin.position.set(x, height + roofH + 0.38, z);
      castle.add(fin);
      if (opts.flag) {
        var fg = new THREE.Group();
        fg.position.set(x, height + roofH + 0.58, z);
        var fgeo = new THREE.PlaneGeometry(1.15, 0.62, 5, 3);
        fgeo.translate(0.57, 0, 0);
        var fm = new THREE.Mesh(fgeo, new THREE.MeshStandardMaterial({ map: makeFlagTexture(opts.flag), side: THREE.DoubleSide, roughness: 0.9 }));
        fm.rotation.y = PI / 4;
        fg.add(fm);
        castle.add(fg);
        castleFlags.push({ g: fg, mesh: fm, ph: rr(0, TAU) });
      }
    } else {
      merlonRing(x, z, radius - 0.04, height + 0.34, Math.max(6, Math.round(radius * 18)));
    }
    if (opts.windows !== false) {
      for (var l = 0; l < (opts.winLevels || 3); l++) {
        var wy = height * (0.28 + l * 0.2);
        for (var w = 0; w < (opts.winCount || 3); w++) {
          var ang = opts.frontAngle !== undefined ? opts.frontAngle + (w - 1) * 0.34 : (w / (opts.winCount || 3)) * TAU;
          var wx = x + Math.sin(ang) * (radius + 0.01);
          var wz = z + Math.cos(ang) * (radius + 0.01);
          (rand() < 0.6 ? litWindows : dimWindows).push({ x: wx, y: wy, z: wz, ry: ang });
        }
      }
    }
    return body;
  }

  /* Great Hall */
  var hallX = -6.3, hallZ = 0.9, hallW = 7.6, hallD = 2.7, hallH = 3.1;
  cbox(hallW, hallH, hallD, hallX, 0, hallZ, stoneMat);
  (function () {
    var w = hallW + 0.5, d = hallD + 0.5, h = 2.0;
    var v = [
      -w / 2, 0, -d / 2, w / 2, 0, -d / 2, w / 2, 0, d / 2, -w / 2, 0, d / 2,
      -w / 2, h, 0, w / 2, h, 0
    ];
    var pos = [
      v[3], v[2], v[7], v[3], v[7], v[6],
      v[1], v[0], v[4], v[1], v[4], v[5],
      v[0], v[3], v[6], v[0], v[6], v[4],
      v[2], v[1], v[5], v[2], v[5], v[7]
    ];
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    var uvs = [];
    for (var vi = 0; vi < geo.attributes.position.count; vi++) {
      uvs.push((geo.attributes.position.getX(vi) + w / 2) / w * 3.2, geo.attributes.position.getY(vi) / h * 2.2);
    }
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
    var roofCanvas = document.createElement('canvas');
    roofCanvas.width = 64; roofCanvas.height = 64;
    var rg = roofCanvas.getContext('2d');
    rg.fillStyle = '#526d75'; rg.fillRect(0, 0, 64, 64);
    for (var row = 0; row < 8; row++) {
      rg.fillStyle = row % 2 ? 'rgba(255,255,255,0.10)' : 'rgba(0,0,0,0.10)';
      rg.fillRect(0, row * 8, 64, 3);
      rg.fillStyle = 'rgba(20,32,36,0.35)';
      rg.fillRect(0, row * 8 + 7, 64, 1);
      for (var col = 0; col < 4; col++) {
        rg.fillStyle = 'rgba(20,32,36,0.28)';
        rg.fillRect(((col + (row % 2) * 0.5) * 16) % 64, row * 8, 1, 8);
      }
    }
    var roofTex = new THREE.CanvasTexture(roofCanvas);
    roofTex.minFilter = THREE.NearestFilter;
    roofTex.magFilter = THREE.NearestFilter;
    roofTex.wrapS = roofTex.wrapT = THREE.RepeatWrapping;
    geo.clearGroups();
    geo.addGroup(0, 12, 0);   // two slate slopes
    geo.addGroup(12, 12, 1);  // stone gable ends
    var slateMat = new THREE.MeshStandardMaterial({ color: 0x6b858c, roughness: 0.88, flatShading: true, side: THREE.DoubleSide, emissive: 0x334b52, emissiveIntensity: 0.55 });
    var gableMat = new THREE.MeshStandardMaterial({ color: 0xb2a88f, roughness: 0.95, flatShading: true, side: THREE.DoubleSide });
    var roofHall = new THREE.Mesh(geo, [slateMat, gableMat]);
    roofHall.position.set(hallX, hallH, hallZ);
    roofHall.castShadow = true; roofHall.receiveShadow = true;
    castle.add(roofHall);
    var ridge = new THREE.Mesh(new THREE.BoxGeometry(w + 0.25, 0.14, 0.2), mat(C.slateDeep));
    ridge.position.set(hallX, hallH + h + 0.03, hallZ);
    castle.add(ridge);
    // cream bargeboards framing the gable ends
    var slopeLen = Math.sqrt((d / 2) * (d / 2) + h * h);
    var slopeAng = Math.atan2(h, d / 2);
    [-1, 1].forEach(function (sx) {
      [-1, 1].forEach(function (sz) {
        var board = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.11, slopeLen + 0.15), mat(C.creamHi));
        board.position.set(hallX + sx * (w / 2 + 0.02), hallH + h / 2 + 0.02, hallZ + sz * d / 4);
        board.rotation.x = sz * slopeAng;
        castle.add(board);
      });
      var fin = new THREE.Mesh(new THREE.SphereGeometry(0.15, 6, 4), mat(C.goldHi, { metalness: 0.5, roughness: 0.35 }));
      fin.position.set(hallX + sx * (w / 2 + 0.03), hallH + h + 0.16, hallZ);
      castle.add(fin);
    });
    // rose window in the great hall's east gable
    var rose = new THREE.Mesh(new THREE.CylinderGeometry(0.52, 0.52, 0.08, 14), mat(0x4a4338, { roughness: 0.8 }));
    rose.rotation.z = PI / 2;
    rose.position.set(hallX + w / 2 + 0.04, hallH + 0.8, hallZ);
    castle.add(rose);
    var roseRim = new THREE.Mesh(new THREE.TorusGeometry(0.53, 0.055, 5, 16), mat(C.gold, { metalness: 0.45, roughness: 0.4 }));
    roseRim.rotation.y = PI / 2;
    roseRim.position.set(hallX + w / 2 + 0.09, hallH + 0.8, hallZ);
    castle.add(roseRim);
    for (var rs = 0; rs < 4; rs++) {
      var spoke = new THREE.Mesh(new THREE.BoxGeometry(0.035, 0.95, 0.03), mat(C.creamHi));
      spoke.position.set(hallX + w / 2 + 0.1, hallH + 0.8, hallZ);
      spoke.rotation.x = rs * PI / 4;
      castle.add(spoke);
    }
    for (var c = 0; c < 3; c++) {
      var ch = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.8, 0.32), stoneDark);
      ch.position.set(hallX - 2.4 + c * 2.2, hallH + h - 0.2, hallZ - 0.4);
      ch.castShadow = true;
      castle.add(ch);
    }
    for (var dd = 0; dd < 3; dd++) {
      var dx = hallX - 2.2 + dd * 2.2;
      var body = new THREE.Mesh(new THREE.BoxGeometry(0.55, 0.5, 0.35), stoneLight);
      body.position.set(dx, hallH + 0.6, hallZ + hallD / 2 + 0.18);
      castle.add(body);
      var dr = new THREE.Mesh(new THREE.ConeGeometry(0.38, 0.5, 4), roofMat2);
      dr.rotation.y = PI / 4;
      dr.position.set(dx, hallH + 1.05, hallZ + hallD / 2 + 0.18);
      castle.add(dr);
    }
  })();

  for (var bx = 0; bx < 6; bx++) {
    var xx = hallX - 3.1 + bx * 1.26;
    var bt = new THREE.Mesh(new THREE.BoxGeometry(0.26, 2.8, 0.46), stoneLight);
    bt.position.set(xx, 1.4, hallZ + hallD / 2 + 0.18);
    bt.castShadow = true;
    castle.add(bt);
    var pin = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.65, 4), roofMat2);
    pin.position.set(xx, 3.08, hallZ + hallD / 2 + 0.18);
    pin.castShadow = true;
    castle.add(pin);
  }
  addWindows(hallX, 1.25, hallZ + hallD / 2 + 0.02, 0, 6, 1, 1.18, 0.4, 0.02, 0.75);
  addWindows(hallX, 2.4, hallZ + hallD / 2 + 0.02, 0, 5, 1, 1.3, 0.4, 0.02, 0.55);
  // rear elevations stay dressed for the 360 degree orbit
  addWindows(hallX, 1.25, hallZ - hallD / 2 - 0.02, PI, 6, 1, 1.18, 0.4, 0.02, 0.6);
  addWindows(hallX, 2.4, hallZ - hallD / 2 - 0.02, PI, 5, 1, 1.3, 0.4, 0.02, 0.45);

  /* keep */
  var keepX = 1.0, keepZ = -0.7;
  cbox(4.3, 5.4, 3.5, keepX, 0, keepZ, stoneMat);
  merlonRow(keepX - 2.15, keepZ + 1.75, keepX + 2.15, keepZ + 1.75, 5.4, 0.5);
  merlonRow(keepX - 2.15, keepZ - 1.75, keepX + 2.15, keepZ - 1.75, 5.4, 0.5);
  merlonRow(keepX - 2.15, keepZ - 1.75, keepX - 2.15, keepZ + 1.75, 5.4, 0.5);
  merlonRow(keepX + 2.15, keepZ - 1.75, keepX + 2.15, keepZ + 1.75, 5.4, 0.5);
  addWindows(keepX, 1.2, keepZ + 1.77, 0, 3, 3, 1.25, 1.1, 0.02, 0.6);
  addWindows(keepX, 1.2, keepZ - 1.77, PI, 3, 3, 1.25, 1.1, 0.02, 0.5);
  addWindows(keepX + 2.17, 1.2, keepZ, PI / 2, 3, 3, 1.25, 1.1, 0.02, 0.5);
  addWindows(keepX - 2.17, 1.2, keepZ, -PI / 2, 3, 3, 1.25, 1.1, 0.02, 0.5);
  [[-1.9, 1.4], [1.9, 1.4], [-1.9, -1.4], [1.9, -1.4]].forEach(function (p, i) {
    addTower(keepX + p[0], keepZ + p[1], 0.46, 5.9 + (i === 0 ? 0.8 : 0), 1.75, {
      seg: 7, bands: 1, mat: stoneLight, winLevels: 2, winCount: 1,
      flag: i === 1 ? 'gryf' : null
    });
  });
  addTower(keepX + 0.4, keepZ - 0.6, 1.05, 9.2, 3.2, { seg: 10, bands: 3, winLevels: 4, winCount: 3, flag: 'gryf' });

  /* clock tower */
  var clockX = 4.4, clockZ = 1.1, clockH = 8.3, clockR = 1.12;
  addTower(clockX, clockZ, clockR, clockH, 3.0, { seg: 10, bands: 3, winLevels: 3, winCount: 3, flag: 'raven' });
  var clockFace = new THREE.Mesh(new THREE.CylinderGeometry(0.65, 0.65, 0.09, 16), mat(C.creamHi, { roughness: 0.7 }));
  clockFace.rotation.x = PI / 2;
  clockFace.position.set(clockX, 6.65, clockZ + clockR + 0.01);
  castle.add(clockFace);
  var clockRim = new THREE.Mesh(new THREE.TorusGeometry(0.66, 0.055, 5, 16), mat(C.gold, { metalness: 0.5, roughness: 0.4 }));
  clockRim.position.set(clockX, 6.65, clockZ + clockR + 0.07);
  castle.add(clockRim);
  var hand1 = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.38, 0.03), mat(C.slateDeep));
  hand1.position.set(clockX, 6.8, clockZ + clockR + 0.08);
  castle.add(hand1);
  var hand2 = new THREE.Mesh(new THREE.BoxGeometry(0.28, 0.045, 0.03), mat(C.slateDeep));
  hand2.position.set(clockX + 0.12, 6.65, clockZ + clockR + 0.08);
  castle.add(hand2);

  /* astronomy tower */
  addTower(-11.3, -1.0, 1.05, 10.6, 3.7, { seg: 10, bands: 4, winLevels: 4, winCount: 3, flag: 'huff' });
  var balc = new THREE.Mesh(new THREE.CylinderGeometry(1.5, 1.5, 0.12, 12), trimMat);
  balc.position.set(-11.3, 7.0, -1.0);
  balc.castShadow = true;
  castle.add(balc);
  for (var mb = 0; mb < 12; mb++) {
    var ma = mb / 12 * TAU;
    merlons.push({ x: -11.3 + Math.cos(ma) * 1.42, y: 7.12, z: -1.0 + Math.sin(ma) * 1.42, ry: -ma + PI / 2, s: [0.18, 0.3, 0.16] });
  }

  addTower(-3.0, -2.6, 0.9, 8.3, 2.8, { seg: 9, bands: 2, winLevels: 3, winCount: 2, roof: roofMat2 });
  addTower(5.6, -2.2, 0.86, 9.0, 3.1, { seg: 9, bands: 2, winLevels: 3, winCount: 2 });
  addTower(1.9, -3.0, 0.7, 7.2, 2.3, { seg: 8, bands: 2, winLevels: 2, winCount: 2, roof: roofMat2 });
  addTower(-8.2, -2.3, 0.68, 7.6, 2.5, { seg: 8, bands: 2, winLevels: 2, winCount: 2 });

  addTower(-2.9, 2.25, 0.66, 5.0, 1.9, { seg: 8, bands: 1, winLevels: 2, winCount: 2, flag: 'huff' });
  addTower(7.2, 2.4, 0.62, 4.6, 1.7, { seg: 8, bands: 1, winLevels: 2, winCount: 2, flag: 'slyth' });

  cbox(3.0, 2.0, 0.7, -2.4, 0, 1.55, stoneLight);
  merlonRow(-3.9, 1.55, -0.9, 1.55, 2.0, 0.45);
  cbox(2.4, 2.3, 0.7, 3.2, 0, 1.9, stoneLight);
  merlonRow(2.0, 1.9, 4.4, 1.9, 2.3, 0.45);
  cbox(2.0, 2.1, 0.7, 6.4, 0, 1.6, stoneLight);
  merlonRow(5.4, 1.6, 7.4, 1.6, 2.1, 0.45);

  cbox(1.8, 2.9, 1.6, -4.3, 0, 2.65, stoneMat);
  var gateArch = new THREE.Mesh(new THREE.BoxGeometry(0.85, 1.5, 0.12), mat(0x2b2a24, { roughness: 1.0 }));
  gateArch.position.set(-4.3, 0.75, 3.47);
  castle.add(gateArch);
  var gateTop = new THREE.Mesh(new THREE.CylinderGeometry(0.43, 0.43, 0.12, 10, 1, false, 0, PI), mat(0x2b2a24));
  gateTop.rotation.x = PI / 2;
  gateTop.rotation.z = PI;
  gateTop.position.set(-4.3, 1.5, 3.47);
  castle.add(gateTop);
  var gateRoof = new THREE.Mesh(new THREE.ConeGeometry(1.25, 1.4, 4), roofMat);
  gateRoof.rotation.y = PI / 4;
  gateRoof.position.set(-4.3, 3.6, 2.65);
  gateRoof.castShadow = true;
  castle.add(gateRoof);
  for (var st = 0; st < 4; st++) {
    var step = new THREE.Mesh(new THREE.BoxGeometry(1.6 + st * 0.35, 0.16, 0.4), stoneLight);
    step.position.set(-4.3, -0.08 - st * 0.16, 3.65 + st * 0.3);
    step.castShadow = true; step.receiveShadow = true;
    castle.add(step);
  }

  var terrace = new THREE.Mesh(new THREE.BoxGeometry(8.0, 0.35, 2.2), stoneMat);
  terrace.position.set(-0.3, 0.02, 2.9);
  terrace.castShadow = true; terrace.receiveShadow = true;
  castle.add(terrace);
  merlonRow(-4.3, 4.0, 3.7, 4.0, 0.55, 0.5);

  /* viaduct bridge */
  (function () {
    var span = 5.0, deckY = 1.15, deckW = 1.35, archR = 0.5, piers = 4;
    var shape = new THREE.Shape();
    shape.moveTo(0, 0);
    shape.lineTo(0, deckY + 0.25);
    shape.lineTo(span, deckY + 0.25);
    shape.lineTo(span, 0);
    shape.lineTo(0, 0);
    for (var i = 0; i < piers; i++) {
      var cx0 = (i + 0.5) * span / piers;
      var hole = new THREE.Path();
      hole.absarc(cx0, 0.05, archR, 0, PI, false);
      hole.lineTo(cx0 + archR, 0);
      hole.lineTo(cx0 - archR, 0);
      shape.holes.push(hole);
    }
    var geo = new THREE.ExtrudeGeometry(shape, { depth: deckW, bevelEnabled: false, steps: 1, curveSegments: 8 });
    var bridge = new THREE.Mesh(geo, stoneMat);
    bridge.position.set(6.9, 0, -0.2);
    bridge.castShadow = true; bridge.receiveShadow = true;
    castle.add(bridge);
    var deck = new THREE.Mesh(new THREE.BoxGeometry(span + 0.3, 0.16, deckW + 0.35), stoneLight);
    deck.position.set(6.9 + span / 2, deckY + 0.3, -0.2 + deckW / 2);
    deck.castShadow = true;
    castle.add(deck);
    merlonRow(6.9, -0.2 + deckW + 0.12, 6.9 + span, -0.2 + deckW + 0.12, deckY + 0.4, 0.55);
    addTower(12.35, 0.4, 0.8, 5.6, 2.4, { seg: 8, bands: 2, winLevels: 2, winCount: 2, flag: 'slyth' });
  })();

  /* instanced merlons */
  var merlonGeo = new THREE.BoxGeometry(1, 1, 1);
  merlonGeo.translate(0, 0.5, 0);
  var merlonMesh = new THREE.InstancedMesh(merlonGeo, mat(C.stoneHi), merlons.length);
  for (var mi = 0; mi < merlons.length; mi++) {
    var mm = merlons[mi];
    dummy.position.set(mm.x, mm.y, mm.z);
    dummy.rotation.set(0, mm.ry, 0);
    dummy.scale.set(mm.s[0], mm.s[1], mm.s[2]);
    dummy.updateMatrix();
    merlonMesh.setMatrixAt(mi, dummy.matrix);
  }
  merlonMesh.instanceMatrix.needsUpdate = true;
  merlonMesh.castShadow = true;
  merlonMesh.receiveShadow = true;
  castle.add(merlonMesh);

  function buildWindowMesh(list, lit) {
    if (!list.length) return;
    var geo = new THREE.BoxGeometry(1, 1, 1);
    var m = lit ? new THREE.MeshStandardMaterial({
      color: C.window, emissive: C.windowSoft, emissiveIntensity: 0.55, roughness: 0.65
    }) : new THREE.MeshStandardMaterial({ color: 0x55584e, roughness: 0.9 });
    var mesh = new THREE.InstancedMesh(geo, m, list.length);
    for (var i = 0; i < list.length; i++) {
      var w = list[i];
      dummy.position.set(w.x, w.y, w.z);
      dummy.rotation.set(0, w.ry, 0);
      dummy.scale.set(w.scale ? 0.24 * w.scale : 0.24, w.scale ? 0.5 * w.scale : 0.5, 0.06);
      dummy.updateMatrix();
      mesh.setMatrixAt(i, dummy.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    castle.add(mesh);
  }
  buildWindowMesh(litWindows, true);
  buildWindowMesh(dimWindows, false);

  updaters.push(function (t) {
    for (var i = 0; i < castleFlags.length; i++) {
      var cf = castleFlags[i];
      cf.mesh.rotation.z = 0.08 + Math.sin(t * 2.6 + cf.ph) * 0.12;
      cf.g.rotation.y = 0.3 + Math.sin(t * 1.4 + cf.ph) * 0.2;
    }
  });

  /* ------------------------------------------------------- rocks & forest */
  seed = 4242;
  var rockGroup = new THREE.Group();
  world.add(rockGroup);
  var rockGeo = new THREE.DodecahedronGeometry(1, 0);
  for (var rk = 0; rk < 40; rk++) {
    var rx = rr(-20, 1.5);
    var rz = rr(-17.5, -11.5);
    var rh = groundHeight(rx, rz);
    if (rh < 2.5) continue;
    var rock = new THREE.Mesh(rockGeo, mat(pick([0x989382, 0x8c8778, 0xa29d8b])));
    var sc = rr(0.55, 1.5);
    rock.position.set(rx, rh + sc * 0.15, rz);
    rock.scale.set(sc * rr(0.8, 1.4), sc * rr(0.6, 1.0), sc * rr(0.8, 1.4));
    rock.rotation.set(rr(0, PI), rr(0, PI), rr(0, PI));
    rock.castShadow = true;
    rock.receiveShadow = true;
    rockGroup.add(rock);
  }

  var cliffSpots = [[-19.6, -12.6, 1.8], [-16.3, -12.1, 1.5], [-12.7, -12.5, 2.0], [-7.8, -11.9, 1.7], [-3.2, -12.2, 1.6], [-0.8, -13.0, 1.2]];
  cliffSpots.forEach(function (cs) {
    var cy6 = groundHeight(cs[0], cs[1]);
    var cr = new THREE.Mesh(rockGeo, mat(pick([0x7c7869, 0x8b8575, 0x6f6b5e])));
    cr.position.set(cs[0], cy6 + cs[2] * 0.25, cs[1]);
    cr.scale.set(cs[2] * 1.3, cs[2] * 0.9, cs[2] * 1.1);
    cr.rotation.set(rr(0, 1), rr(0, PI), rr(0, 1));
    cr.castShadow = true; cr.receiveShadow = true;
    world.add(cr);
  });

  var pines = [];
  var broadleaf = [];
  seed = 9876;
  for (var pn = 0; pn < 130; pn++) {
    var px = rr(-22, 19);
    var pz = rr(-20.3, -7.5);
    var ph = groundHeight(px, pz);
    if (ph < 0.4) continue;
    var cd2 = Math.sqrt(((px + 9.6) * (px + 9.6)) / (10.8 * 10.8) + ((pz + 16.9) * (pz + 16.9)) / (5.1 * 5.1));
    if (cd2 < 0.7) continue;
    if (px > 5.0 && pz > -11.0) continue;
    pines.push({ x: px, z: pz, y: ph, s: rr(0.55, 1.55), c: pick([0x3f5c4b, 0x476752, 0x53725a, 0x3a5343]), rot: rand() * TAU });
  }
  for (var pb = 0; pb < 48; pb++) {
    var bx = rr(-23, 20);
    var bz = rr(-20.6, -18.0);
    pines.push({ x: bx, z: bz, y: groundHeight(bx, bz), s: rr(0.5, 1.1), c: pick([0x3f5c4b, 0x4b6a55, 0x55745c]), rot: rand() * TAU });
  }
  // a dense ring of firs around the castle plateau
  for (var pc = 0; pc < 70; pc++) {
    var cx4 = rr(-22.5, 2.0);
    var cz4 = rr(-21.0, -10.8);
    var cy4 = groundHeight(cx4, cz4);
    if (cy4 < 0.7) continue;
    var cd4 = Math.sqrt(((cx4 + 9.6) * (cx4 + 9.6)) / (11.0 * 11.0) + ((cz4 + 16.9) * (cz4 + 16.9)) / (4.6 * 4.6));
    if (cd4 < 0.8) continue;
    pines.push({ x: cx4, z: cz4, y: cy4, s: rr(0.65, 1.8), c: pick([0x35503f, 0x3d5947, 0x46634e, 0x2f4939]), rot: rand() * TAU });
  }
  seed = 3131;
  for (var bl = 0; bl < 18; bl++) {
    var bx2 = rr(-21, 20);
    var bz2 = rr(-18, -9);
    var by = groundHeight(bx2, bz2);
    var cd3 = Math.sqrt(((bx2 + 9.6) * (bx2 + 9.6)) / (11.2 * 11.2) + ((bz2 + 16.9) * (bz2 + 16.9)) / (5.2 * 5.2));
    if (cd3 < 0.9) continue;
    broadleaf.push({ x: bx2, z: bz2, y: by, s: rr(0.5, 1.0), c: pick([0x5c7359, 0x677e60, 0x536b53]), rot: rand() * TAU });
  }

  function mergedPineGeometry() {
    var parts = [];
    var cone1 = new THREE.ConeGeometry(0.42, 1.1, 6); cone1.translate(0, 0.7, 0);
    var cone2 = new THREE.ConeGeometry(0.34, 0.9, 6); cone2.translate(0, 1.3, 0);
    var cone3 = new THREE.ConeGeometry(0.24, 0.7, 6); cone3.translate(0, 1.85, 0);
    parts.push(cone1.toNonIndexed(), cone2.toNonIndexed(), cone3.toNonIndexed());
    var total = 0;
    parts.forEach(function (g) { total += g.attributes.position.count; });
    var pos = new Float32Array(total * 3);
    var nor = new Float32Array(total * 3);
    var off = 0;
    parts.forEach(function (g) {
      pos.set(g.attributes.position.array, off * 3);
      nor.set(g.attributes.normal.array, off * 3);
      off += g.attributes.position.count;
    });
    var geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    return geo;
  }

  var pineMesh = new THREE.InstancedMesh(mergedPineGeometry(), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0, flatShading: true }), pines.length);
  for (var pj = 0; pj < pines.length; pj++) {
    var pp = pines[pj];
    dummy.position.set(pp.x, pp.y - 0.06, pp.z);
    dummy.rotation.set(0, pp.rot, 0);
    dummy.scale.set(pp.s, pp.s * rr(0.9, 1.2), pp.s);
    dummy.updateMatrix();
    pineMesh.setMatrixAt(pj, dummy.matrix);
    pineMesh.setColorAt(pj, new THREE.Color(pp.c));
  }
  pineMesh.instanceMatrix.needsUpdate = true;
  if (pineMesh.instanceColor) pineMesh.instanceColor.needsUpdate = true;
  pineMesh.castShadow = true;
  pineMesh.receiveShadow = true;
  world.add(pineMesh);

  var trunkGeo = new THREE.CylinderGeometry(0.055, 0.08, 0.6, 5);
  trunkGeo.translate(0, 0.3, 0);
  var trunkMesh = new THREE.InstancedMesh(trunkGeo, mat(C.woodLo), pines.length);
  for (var tj = 0; tj < pines.length; tj++) {
    var tpp = pines[tj];
    dummy.position.set(tpp.x, tpp.y - 0.05, tpp.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(tpp.s, tpp.s, tpp.s);
    dummy.updateMatrix();
    trunkMesh.setMatrixAt(tj, dummy.matrix);
  }
  trunkMesh.instanceMatrix.needsUpdate = true;
  trunkMesh.castShadow = true;
  world.add(trunkMesh);

  var blobGeo = new THREE.IcosahedronGeometry(0.7, 0);
  var blobMesh = new THREE.InstancedMesh(blobGeo, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0, flatShading: true }), broadleaf.length);
  var blobTrunkMesh = new THREE.InstancedMesh(trunkGeo, mat(C.woodLo), broadleaf.length);
  for (var bj = 0; bj < broadleaf.length; bj++) {
    var bp = broadleaf[bj];
    dummy.position.set(bp.x, bp.y + 0.75 * bp.s, bp.z);
    dummy.rotation.set(rr(0, 1), bp.rot, 0);
    dummy.scale.set(bp.s, bp.s * 0.85, bp.s);
    dummy.updateMatrix();
    blobMesh.setMatrixAt(bj, dummy.matrix);
    blobMesh.setColorAt(bj, new THREE.Color(bp.c));
    dummy.position.set(bp.x, bp.y - 0.05, bp.z);
    dummy.rotation.set(0, 0, 0);
    dummy.scale.set(bp.s, bp.s * 1.4, bp.s);
    dummy.updateMatrix();
    blobTrunkMesh.setMatrixAt(bj, dummy.matrix);
  }
  blobMesh.instanceMatrix.needsUpdate = true;
  if (blobMesh.instanceColor) blobMesh.instanceColor.needsUpdate = true;
  blobMesh.castShadow = true;
  blobMesh.receiveShadow = true;
  blobTrunkMesh.instanceMatrix.needsUpdate = true;
  blobTrunkMesh.castShadow = true;
  world.add(blobMesh, blobTrunkMesh);

  function addHeroPine(x, z, s) {
    var y = groundHeight(x, z);
    var g = new THREE.Group();
    g.position.set(x, y, z);
    var trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.09 * s, 0.14 * s, 0.9 * s, 6), mat(C.woodLo));
    trunk.position.y = 0.45 * s;
    trunk.castShadow = true;
    g.add(trunk);
    var cols = [0x3f5a45, 0x49664f, 0x557258];
    for (var i = 0; i < 3; i++) {
      var cone = new THREE.Mesh(new THREE.ConeGeometry((0.9 - i * 0.22) * s, (1.6 - i * 0.2) * s, 7), mat(cols[i]));
      cone.position.y = (1.15 + i * 0.7) * s;
      cone.castShadow = true; cone.receiveShadow = true;
      g.add(cone);
    }
    world.add(g);
  }
  // perimeter firs framing the castle
  var castlePineSpots = [
    [-21.0, -14.5, 1.6], [-20.0, -19.2, 1.9], [-17.0, -21.0, 2.0], [-12.0, -21.6, 1.5],
    [-6.0, -21.3, 1.8], [-1.2, -20.4, 1.6], [-0.7, -12.1, 1.45], [-4.8, -11.2, 1.35],
    [-12.5, -11.4, 1.7], [-16.0, -11.9, 1.5], [-19.6, -11.2, 1.4], [-8.4, -21.8, 1.25]
  ];
  castlePineSpots.forEach(function (cps) {
    var cy5 = groundHeight(cps[0], cps[1]);
    var cg = new THREE.Group();
    cg.position.set(cps[0], cy5, cps[1]);
    var ct = new THREE.Mesh(new THREE.CylinderGeometry(0.06 * cps[2], 0.1 * cps[2], 0.7 * cps[2], 5), mat(C.woodLo));
    ct.position.y = 0.35 * cps[2];
    ct.castShadow = true;
    cg.add(ct);
    for (var cz = 0; cz < 3; cz++) {
      var cc2 = new THREE.Mesh(new THREE.ConeGeometry((0.85 - cz * 0.2) * cps[2], (1.5 - cz * 0.2) * cps[2], 6), mat([0x304a3a, 0x3a5844, 0x45634d][cz]));
      cc2.position.y = (1.0 + cz * 0.62) * cps[2];
      cc2.rotation.y = rand() * PI;
      cc2.castShadow = true;
      cg.add(cc2);
    }
    world.add(cg);
  });

  addHeroPine(-20.1, 12.2, 1.25);
  addHeroPine(-21.3, 8.0, 0.9);
  addHeroPine(20.6, 7.4, 1.15);

  /* -------------------------------------------------------- distant ridges */
  // Ridge, haze and mist planes are billboarded onto the orbit's azimuth at
  // render time, so the far horizon stays behind the diorama from every angle.
  var backdrop = new THREE.Group();
  world.add(backdrop);

  function makeMountainTexture() {
    var W = 1024, H = 256, S = 2;
    var cv = document.createElement('canvas');
    cv.width = W * S; cv.height = H * S;
    var g = cv.getContext('2d');
    g.scale(S, S);
    g.clearRect(0, 0, W, H);
    seed = 4127;
    var layers = [
      { baseY: 208, hgt: 104, top: '#d8e4d9', bot: '#c3d4c6', peaks: 7, alpha: 1.0 },
      { baseY: 228, hgt: 88, top: '#cddccf', bot: '#b5c9b8', peaks: 6, alpha: 1.0 },
      { baseY: 246, hgt: 72, top: '#c1d3c4', bot: '#a6bbaa', peaks: 5, alpha: 1.0 }
    ];
    layers.forEach(function (L, li) {
      var peakDefs = [];
      for (var k = 0; k < L.peaks; k++) {
        peakDefs.push({ at: rr(0.03, 0.97), w: rr(0.07, 0.16), h: rr(0.48, 1.0) });
      }
      var pts = [];
      var minY = H;
      for (var x = 0; x <= W; x += 4) {
        var t = x / W;
        var env = Math.pow(Math.sin(t * PI), 0.22);
        var h = 0;
        for (var pi2 = 0; pi2 < peakDefs.length; pi2++) {
          var pk2 = peakDefs[pi2];
          var f = 1 - Math.abs(t - pk2.at) / pk2.w;
          if (f > 0) h = Math.max(h, Math.pow(f, 1.2) * pk2.h);
        }
        h += 0.035 * Math.sin(t * 67 + li * 3.1) + 0.025 * Math.sin(t * 23 + li * 1.7);
        var y = L.baseY - Math.max(0, h) * env * L.hgt;
        pts.push([x, y]);
        if (y < minY) minY = y;
      }
      g.beginPath();
      g.moveTo(0, H);
      for (var pj2 = 0; pj2 < pts.length; pj2++) g.lineTo(pts[pj2][0], pts[pj2][1]);
      g.lineTo(W, H);
      g.closePath();
      var grd = g.createLinearGradient(0, minY, 0, H);
      grd.addColorStop(0, L.top);
      grd.addColorStop(1, L.bot);
      g.fillStyle = grd;
      g.globalAlpha = L.alpha;
      g.fill();
      g.globalAlpha = 1;

    });
    var mist = g.createLinearGradient(0, 150, 0, H);
    mist.addColorStop(0, 'rgba(245,241,231,0)');
    mist.addColorStop(0.45, 'rgba(245,241,231,0.30)');
    mist.addColorStop(0.78, 'rgba(245,241,231,0.7)');
    mist.addColorStop(1, 'rgba(245,241,231,0.98)');
    g.fillStyle = mist;
    g.fillRect(0, 150, W, H - 150);
    seed = 992;
    for (var tr = 0; tr < 80; tr++) {
      var tx = rr(0, W);
      var th = rr(7, 18);
      var ty2 = 250 + rr(-4, 3);
      g.fillStyle = 'rgba(101,128,105,' + rr(0.3, 0.55).toFixed(2) + ')';
      g.beginPath();
      g.moveTo(tx - th * 0.34, ty2);
      g.lineTo(tx, ty2 - th);
      g.lineTo(tx + th * 0.34, ty2);
      g.closePath();
      g.fill();
    }
    seed = 731;
    for (var cw = 0; cw < 20; cw++) {
      var cx2 = rr(0, W), cy2 = rr(60, 150);
      g.fillStyle = 'rgba(250,247,238,' + rr(0.03, 0.10).toFixed(2) + ')';
      g.beginPath();
      g.ellipse(cx2, cy2, rr(20, 80), rr(3, 9), 0, 0, TAU);
      g.fill();
    }
    return smoothTex(new THREE.CanvasTexture(cv));
  }

  var mountainPlane = new THREE.Mesh(new THREE.PlaneGeometry(112, 30), new THREE.MeshBasicMaterial({
    map: makeMountainTexture(), transparent: true, depthWrite: false, side: THREE.DoubleSide
  }));
  mountainPlane.rotation.y = PI / 4;
  mountainPlane.position.set(-32 * 0.70710678, 7.0, -32 * 0.70710678);
  mountainPlane.renderOrder = 0;
  backdrop.add(mountainPlane);

  /* ------------------------------------------------------------- mist & birds */
  function makeMistTexture() {
    var S = 2;
    var cv = document.createElement('canvas');
    cv.width = 128 * S; cv.height = 64 * S;
    var g = cv.getContext('2d');
    g.scale(S, S);
    var grd = g.createLinearGradient(0, 0, 0, 64);
    grd.addColorStop(0, 'rgba(255,252,243,0)');
    grd.addColorStop(0.4, 'rgba(255,252,243,0.55)');
    grd.addColorStop(0.68, 'rgba(255,252,243,0.38)');
    grd.addColorStop(1, 'rgba(255,252,243,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 128, 64);
    for (var i = 0; i < 200; i++) {
      g.fillStyle = 'rgba(255,252,243,' + rr(0.05, 0.18).toFixed(2) + ')';
      g.beginPath();
      g.ellipse(rand() * 128, rand() * 64, rr(4, 20), rr(2, 8), 0, 0, TAU);
      g.fill();
    }
    var fadeM = g.createLinearGradient(0, 0, 128, 0);
    fadeM.addColorStop(0, 'rgba(0,0,0,0)');
    fadeM.addColorStop(0.22, 'rgba(0,0,0,1)');
    fadeM.addColorStop(0.78, 'rgba(0,0,0,1)');
    fadeM.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = fadeM;
    g.fillRect(0, 0, 128, 64);
    g.globalCompositeOperation = 'source-over';
    return smoothTex(new THREE.CanvasTexture(cv));
  }
  var mistTex = makeMistTexture();
  var mistPlanes = [];
  [[14, 2.6, 28, 3.0, 0.20], [21, 3.3, 36, 3.6, 0.24], [27, 4.2, 46, 4.2, 0.20], [33, 1.8, 58, 3.4, 0.13]].forEach(function (mp, i) {
    var depth = mp[0];
    var plane = new THREE.Mesh(new THREE.PlaneGeometry(mp[2], mp[3]), new THREE.MeshBasicMaterial({
      map: mistTex, transparent: true, opacity: mp[4], depthWrite: false, side: THREE.DoubleSide
    }));
    plane.position.set(-depth * 0.70710678, mp[1], -depth * 0.70710678);
    plane.rotation.y = PI / 4;
    plane.renderOrder = 3;
    backdrop.add(plane);
    mistPlanes.push({ mesh: plane, baseX: plane.position.x, baseOpacity: mp[4], ph: i * 1.7 });
  });
  updaters.push(function (t) {
    for (var i = 0; i < mistPlanes.length; i++) {
      var mp = mistPlanes[i];
      mp.mesh.position.x = mp.baseX + Math.sin(t * 0.08 + mp.ph) * 1.8;
      mp.mesh.material.opacity = mp.baseOpacity * (0.8 + Math.sin(t * 0.12 + mp.ph) * 0.2);
    }
  });

  function makeHazeTexture() {
    var S = 2;
    var cv = document.createElement('canvas');
    cv.width = 256 * S; cv.height = 128 * S;
    var g = cv.getContext('2d');
    g.scale(S, S);
    var grd = g.createLinearGradient(0, 0, 0, 128);
    grd.addColorStop(0, 'rgba(246,241,228,0)');
    grd.addColorStop(0.45, 'rgba(246,241,228,0.10)');
    grd.addColorStop(0.72, 'rgba(246,241,228,0.55)');
    grd.addColorStop(0.9, 'rgba(246,241,228,0.92)');
    grd.addColorStop(1, 'rgba(246,241,228,1)');
    g.fillStyle = grd;
    g.fillRect(0, 0, 256, 128);
    for (var hi2 = 0; hi2 < 90; hi2++) {
      g.fillStyle = 'rgba(250,246,235,' + rr(0.03, 0.12).toFixed(2) + ')';
      g.beginPath();
      g.ellipse(rand() * 256, rr(40, 120), rr(18, 60), rr(4, 14), 0, 0, TAU);
      g.fill();
    }
    var fadeH = g.createLinearGradient(0, 0, 256, 0);
    fadeH.addColorStop(0, 'rgba(0,0,0,0)');
    fadeH.addColorStop(0.2, 'rgba(0,0,0,1)');
    fadeH.addColorStop(0.8, 'rgba(0,0,0,1)');
    fadeH.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalCompositeOperation = 'destination-in';
    g.fillStyle = fadeH;
    g.fillRect(0, 0, 256, 128);
    g.globalCompositeOperation = 'source-over';
    return smoothTex(new THREE.CanvasTexture(cv));
  }
  var hazeTex = makeHazeTexture();
  var hazeBanks = [];
  [[18.8, -0.4, 100, 8, 0.20], [23.0, 0.2, 115, 9, 0.14], [28.0, -0.6, 128, 8, 0.08]].forEach(function (hb, idx) {
    var hplane = new THREE.Mesh(new THREE.PlaneGeometry(hb[2], hb[3]), new THREE.MeshBasicMaterial({
      map: hazeTex, transparent: true, opacity: hb[4], depthWrite: false, side: THREE.DoubleSide
    }));
    hplane.position.set(-hb[0] * 0.70710678, hb[1], -hb[0] * 0.70710678);
    hplane.rotation.y = PI / 4;
    hplane.renderOrder = 2;
    backdrop.add(hplane);
    hazeBanks.push({ mesh: hplane, baseX: hplane.position.x, ph: idx * 2.1, op: hb[4] });
  });
  updaters.push(function (t) {
    for (var i2 = 0; i2 < hazeBanks.length; i2++) {
      var hb2 = hazeBanks[i2];
      hb2.mesh.position.x = hb2.baseX + Math.sin(t * 0.045 + hb2.ph) * 2.5;
      hb2.mesh.material.opacity = hb2.op * (0.9 + Math.sin(t * 0.07 + hb2.ph) * 0.1);
    }
  });

  var birds = [];
  var birdGroup = new THREE.Group();
  world.add(birdGroup);
  function createBird(scale) {
    var g = new THREE.Group();
    var body = new THREE.Mesh(new THREE.BoxGeometry(0.14 * scale, 0.06 * scale, 0.34 * scale), mat(0x45565a));
    body.castShadow = false;
    g.add(body);
    var wingGeo = new THREE.BufferGeometry();
    wingGeo.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0.5, 0.02, -0.1, 0.14, 0, 0.16], 3));
    wingGeo.computeVertexNormals();
    var wm = new THREE.MeshStandardMaterial({ color: 0x45565a, side: THREE.DoubleSide, roughness: 1.0 });
    var wl = new THREE.Mesh(wingGeo, wm);
    var wr = new THREE.Mesh(wingGeo, wm);
    wr.scale.x = -1;
    g.add(wl, wr);
    birdGroup.add(g);
    return { g: g, wl: wl, wr: wr, ph: rr(0, TAU) };
  }
  for (var bi = 0; bi < 7; bi++) {
    var b = createBird(rr(0.75, 1.25));
    b.cx = rr(-8, 12);
    b.cz = rr(-19, -2);
    b.cy = rr(14, 18);
    b.rad = rr(2.5, 6.0);
    b.speed = rr(0.06, 0.13) * (rand() < 0.5 ? 1 : -1);
    b.phase = rr(0, TAU);
    birds.push(b);
  }
  updaters.push(function (t) {
    for (var i = 0; i < birds.length; i++) {
      var b = birds[i];
      var a = t * b.speed + b.phase;
      b.g.position.set(b.cx + Math.cos(a) * b.rad, b.cy + Math.sin(t * 0.5 + b.ph) * 0.4, b.cz + Math.sin(a) * b.rad);
      b.g.rotation.y = -a + (b.speed > 0 ? PI / 2 : -PI / 2);
      b.g.rotation.z = Math.sin(t * 1.1 + b.ph) * 0.08;
      var flap = Math.sin(t * 6.5 + b.ph) * 0.65;
      b.wl.rotation.z = flap;
      b.wr.rotation.z = -flap;
    }
  });

  // higher gliders that show against the clean sky
  for (var hb = 0; hb < 5; hb++) {
    var hbBird = createBird(rr(1.6, 2.1));
    hbBird.cx = [-24, 22, -7, 12, -17][hb];
    hbBird.cz = [-5, -8, 4, 3, 6][hb];
    hbBird.cy = [21, 23, 20, 22, 19][hb];
    hbBird.rad = rr(2.6, 4.6);
    hbBird.speed = rr(0.04, 0.075) * (hb === 1 ? -1 : 1);
    hbBird.phase = rr(0, TAU);
    birds.push(hbBird);
  }

  for (var fb = 0; fb < 5; fb++) {
    var vg = new THREE.Group();
    var vm = new THREE.MeshBasicMaterial({ color: 0x8c9a92 });
    var w1 = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.02, 0.03), vm);
    var w2 = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.02, 0.03), vm);
    w1.position.x = -0.16; w1.rotation.z = 0.4;
    w2.position.x = 0.16; w2.rotation.z = -0.4;
    vg.add(w1, w2);
    vg.position.set(rr(-26, 28), rr(12, 20), rr(-30, -22));
    vg.rotation.y = PI / 4;
    world.add(vg);
  }

  var haze = new THREE.Mesh(new THREE.PlaneGeometry(78, 26), new THREE.MeshBasicMaterial({
    color: 0xfaf6ec, transparent: true, opacity: 0.10, depthWrite: false
  }));
  haze.position.set(-21.2, 3.5, -21.2);
  haze.rotation.y = PI / 4;
  haze.renderOrder = 1;
  backdrop.add(haze);

  /* ============================================================ QUIDDITCH */
  var teamsGroup = new THREE.Group();
  world.add(teamsGroup);

  var FWD = new THREE.Vector3(0, 0, 1);
  var UP = new THREE.Vector3(0, 1, 0);
  var vA = new THREE.Vector3(), vB = new THREE.Vector3(), vC = new THREE.Vector3(), vD = new THREE.Vector3();
  var qA = new THREE.Quaternion(), qB = new THREE.Quaternion();
  var mA = new THREE.Matrix4(), axX = new THREE.Vector3(), axY = new THREE.Vector3();
  var flyers = [];
  var seekers = [];

  function curveFrom(pts) {
    var vs = [];
    for (var i = 0; i < pts.length; i++) vs.push(new THREE.Vector3(pts[i][0], pts[i][1], pts[i][2]));
    return new THREE.CatmullRomCurve3(vs, true, 'catmullrom', 0.42);
  }

  var skinTones = [0xe7bb92, 0xdcae84, 0xc99a70, 0x9c6d4b, 0x7a5236, 0x5e402c];
  var hairTones = [0x3f2c21, 0x54382a, 0x2c211b, 0x8a6238, 0xd8c590, 0x6b4a2f];

  function createRider(team, role, opts) {
    opts = opts || {};
    var root = new THREE.Group();
    var rig = new THREE.Group();
    root.add(rig);
    var isG = team === 'gryf';
    var robe = opts.robe !== undefined ? opts.robe : (isG ? C.gryf : C.slyth);
    var robeDark = isG ? C.gryfDark : C.slythDark;
    var accent = isG ? C.gryfGold : C.slythSilver;
    var skin = opts.skin || pick(skinTones);
    var hair = opts.hair || pick(hairTones);

    var shaftGeo = new THREE.CylinderGeometry(0.05, 0.065, 2.05, 6);
    var shaft = new THREE.Mesh(shaftGeo, mat(0xa17a4e, { roughness: 0.8 }));
    shaft.rotation.x = PI / 2;
    shaft.position.set(0, 0.02, 0);
    shaft.castShadow = false;
    rig.add(shaft);
    var tip = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.045, 0.18, 5), mat(C.gold, { metalness: 0.45, roughness: 0.4 }));
    tip.rotation.x = PI / 2;
    tip.position.set(0, 0.02, 1.06);
    rig.add(tip);
    var band = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.062, 0.075, 6), mat(C.goldHi, { metalness: 0.5, roughness: 0.35 }));
    band.rotation.x = PI / 2;
    band.position.set(0, 0.02, -0.83);
    rig.add(band);
    var bristle = new THREE.Mesh(new THREE.ConeGeometry(0.17, 0.58, 7), mat(0xb29566, { roughness: 1.0 }));
    bristle.rotation.x = PI / 2;
    bristle.position.set(0, 0.01, -1.12);
    bristle.castShadow = false;
    rig.add(bristle);
    var bristleDark = new THREE.Mesh(new THREE.ConeGeometry(0.13, 0.42, 6), mat(0x8e754f));
    bristleDark.rotation.x = PI / 2;
    bristleDark.position.set(0, 0.0, -1.02);
    rig.add(bristleDark);

    var torso = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.43, 0.22), mat(robe));
    torso.position.set(0, 0.66, -0.01);
    torso.rotation.x = 0.2;
    torso.castShadow = true;
    rig.add(torso);
    var stripe = new THREE.Mesh(new THREE.BoxGeometry(0.312, 0.065, 0.228), mat(accent));
    stripe.position.set(0, 0.58, 0.0);
    stripe.rotation.x = 0.2;
    rig.add(stripe);
    var collar = new THREE.Mesh(new THREE.BoxGeometry(0.26, 0.1, 0.2), mat(robeDark));
    collar.position.set(0, 0.87, 0.0);
    rig.add(collar);
    var head = new THREE.Mesh(new THREE.SphereGeometry(0.135, 8, 6), mat(skin));
    head.position.set(0, 0.99, 0.025);
    head.castShadow = true;
    rig.add(head);
    var hairCap = new THREE.Mesh(new THREE.SphereGeometry(0.146, 8, 6, 0, TAU, 0, PI * 0.58), mat(hair));
    hairCap.position.set(0, 1.0, 0.015);
    hairCap.rotation.x = -0.18;
    rig.add(hairCap);

    for (var side = -1; side <= 1; side += 2) {
      var arm = new THREE.Mesh(new THREE.BoxGeometry(0.075, 0.34, 0.08), mat(robe));
      arm.position.set(side * 0.18, 0.62, 0.13);
      arm.rotation.x = 0.95;
      arm.rotation.z = side * 0.28;
      rig.add(arm);
      var hand = new THREE.Mesh(new THREE.SphereGeometry(0.055, 5, 4), mat(0x4a3527));
      hand.position.set(side * 0.24, 0.5, 0.31);
      rig.add(hand);
      var leg = new THREE.Mesh(new THREE.BoxGeometry(0.085, 0.36, 0.09), mat(0x3a3029));
      leg.position.set(side * 0.115, 0.34, -0.12);
      leg.rotation.x = -0.52;
      rig.add(leg);
      var boot = new THREE.Mesh(new THREE.BoxGeometry(0.095, 0.12, 0.16), mat(0x2c241f));
      boot.position.set(side * 0.115, 0.2, -0.03);
      rig.add(boot);
    }

    if (role === 'keeper') {
      var helmet = new THREE.Mesh(new THREE.SphereGeometry(0.155, 8, 5, 0, TAU, 0, PI * 0.55), mat(accent, { metalness: 0.15 }));
      helmet.position.set(0, 1.015, 0.015);
      helmet.rotation.x = -0.2;
      rig.add(helmet);
      for (var ps = -1; ps <= 1; ps += 2) {
        var pad = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.2, 0.24), mat(C.creamHi));
        pad.position.set(ps * 0.21, 0.71, 0.0);
        pad.rotation.x = 0.2;
        rig.add(pad);
      }
    }
    if (role === 'beater') {
      for (var pb = -1; pb <= 1; pb += 2) {
        var bpad = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.2), mat(robeDark));
        bpad.position.set(pb * 0.2, 0.74, 0.0);
        rig.add(bpad);
      }
    }

    var capeSegs = [];
    var capeParent = new THREE.Object3D();
    capeParent.position.set(0, 0.82, -0.12);
    rig.add(capeParent);
    var cp = capeParent;
    var capeWidths = [0.54, 0.45, 0.36];
    var capeCols = [robeDark, robe, accent];
    for (var csi = 0; csi < 3; csi++) {
      var pivot = new THREE.Object3D();
      pivot.position.set(0, csi === 0 ? 0 : -0.3, 0);
      cp.add(pivot);
      var cw = capeWidths[csi], chh = 0.31;
      var cgeo = new THREE.PlaneGeometry(cw, chh, 2, 2);
      cgeo.translate(0, -chh / 2 + 0.02, 0);
      var cmat = new THREE.MeshStandardMaterial({ color: capeCols[csi], roughness: 0.92, side: THREE.DoubleSide, flatShading: true });
      var cmesh = new THREE.Mesh(cgeo, cmat);
      cmesh.castShadow = false;
      pivot.add(cmesh);
      pivot.rotation.x = 1.18 + csi * 0.1;
      capeSegs.push({ pivot: pivot, base: pivot.rotation.x, amp: 0.16 + csi * 0.08, sp: 6.5 + csi });
      cp = pivot;
    }

    var scarfSegs = [];
    var scarfParent = new THREE.Object3D();
    scarfParent.position.set(0, 0.92, 0.01);
    rig.add(scarfParent);
    var sp2 = scarfParent;
    var scarfCount = opts.longScarf ? 4 : 2;
    for (var ssi = 0; ssi < scarfCount; ssi++) {
      var spivot = new THREE.Object3D();
      spivot.position.set(0, ssi === 0 ? 0 : -0.22, 0);
      sp2.add(spivot);
      var sgeo = new THREE.PlaneGeometry(0.14, 0.26, 1, 2);
      sgeo.translate(0, -0.13, 0);
      var smesh = new THREE.Mesh(sgeo, new THREE.MeshStandardMaterial({
        color: opts.scarfColor || accent, roughness: 0.92, side: THREE.DoubleSide, flatShading: true
      }));
      spivot.add(smesh);
      spivot.rotation.x = 1.45;
      scarfSegs.push({ pivot: spivot, base: 1.45, amp: 0.34 + ssi * 0.05, sp: 8.5 + ssi * 0.6 });
      sp2 = spivot;
    }

    if (role === 'seeker') {
      var goggles = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.045, 0.06), mat(0x3a2f28));
      goggles.position.set(0, 1.0, 0.135);
      rig.add(goggles);
      var lensL = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.025, 8), mat(0xe8c56b, { metalness: 0.3, roughness: 0.4 }));
      lensL.rotation.x = PI / 2;
      lensL.position.set(-0.065, 1.0, 0.165);
      var lensR = lensL.clone(); lensR.position.x = 0.065;
      rig.add(lensL, lensR);
    }

    var batPivot = null;
    if (role === 'beater') {
      batPivot = new THREE.Object3D();
      batPivot.position.set(0.25, 0.56, 0.28);
      rig.add(batPivot);
      var bat = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.055, 0.85, 6), mat(0x8f6540, { roughness: 0.85 }));
      bat.position.y = 0.42;
      bat.castShadow = true;
      batPivot.add(bat);
      var batHead = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.09, 0.22, 6), mat(0x6d4a2c));
      batHead.position.y = 0.84;
      batPivot.add(batHead);
      batPivot.rotation.set(0.5, 0, -0.9);
    }

    var handAnchor = new THREE.Object3D();
    handAnchor.position.set(0.24, 0.58, 0.36);
    rig.add(handAnchor);

    root.scale.setScalar((opts.scale || 1) * 1.72);
    return {
      root: root, rig: rig, cape: capeSegs, scarf: scarfSegs,
      bat: batPivot, anchor: handAnchor, phase: rr(0, TAU),
      bank: 0
    };
  }

  function addFlyer(team, role, path, opts) {
    opts = opts || {};
    var r = createRider(team, role, opts);
    var curve = opts.curve || curveFrom(path);
    var f = {
      team: team, role: role, rider: r, root: r.root, curve: curve,
      len: curve.getLength(), speed: opts.speed || 5.5,
      u0: opts.u0 === undefined ? 0 : opts.u0,
      follow: opts.follow || null,
      phase: rr(0, TAU), bank: 0
    };
    r.root.position.copy(curve.getPointAt(f.u0));
    teamsGroup.add(r.root);
    flyers.push(f);
    return f;
  }

  var gryfChasers = [];
  var slythChasers = [];

  var chaserPathsG = [
    [[-10, 4.4, 10], [-3.2, 5.0, 3.2], [5.8, 4.4, 2.1], [10.2, 5.2, 8.0], [4.2, 5.8, 12.6], [-3.8, 5.0, 11.8]],
    [[-9.2, 3.2, 3.1], [-4.0, 4.0, 9.2], [3.1, 3.4, 11.0], [9.4, 4.2, 6.1], [5.0, 3.6, 0.4], [-3.0, 3.0, 0.2]],
    [[-10.8, 6.0, 5.2], [-4.3, 6.6, 1.1], [4.0, 6.0, -0.8], [9.2, 6.4, 4.9], [3.4, 7.0, 9.4], [-5.2, 6.4, 9.0]]
  ];
  var chaserPathsS = [
    [[-9.4, 4.0, 6.0], [-2.3, 3.6, 10.2], [5.0, 4.2, 9.0], [10.0, 4.8, 4.0], [3.0, 4.4, -0.8], [-5.0, 4.8, 0.3]],
    [[-8.0, 5.6, 11.0], [-1.0, 6.2, 6.0], [7.0, 5.6, 5.0], [8.2, 6.0, 0.2], [0.0, 6.4, 3.2], [-6.2, 6.2, 7.2]],
    [[-10.0, 2.8, 8.0], [-4.0, 3.2, 12.0], [3.0, 2.8, 10.2], [8.2, 3.4, 4.2], [2.0, 3.0, 1.0], [-6.0, 2.6, 3.0]]
  ];
  var beaterPathsG = [
    [[-11.2, 3.0, 1.2], [-5.0, 3.6, 7.0], [3.0, 3.0, 9.4], [8.0, 3.4, 4.2], [1.0, 3.8, -2.0], [-7.0, 3.2, -1.0]],
    [[-8.4, 4.8, 12.0], [-2.0, 5.2, 5.0], [7.0, 4.6, 4.2], [6.2, 5.0, 11.0], [-2.2, 5.4, 13.0]]
  ];
  var beaterPathsS = [
    [[-9.0, 4.4, 5.2], [-3.0, 4.8, 11.0], [6.0, 4.2, 10.0], [9.0, 4.6, 3.2], [1.0, 5.0, 0.0], [-7.0, 4.6, 1.2]],
    [[-7.0, 3.2, 9.0], [1.0, 3.6, 5.0], [8.0, 3.2, 6.0], [5.0, 3.8, 12.0], [-3.0, 4.2, 11.0]]
  ];

  var i, f;
  for (i = 0; i < 3; i++) {
    var gg = createRider('gryf', 'chaser', { scale: 0.98 + i * 0.02, hair: hairTones[i] });
    var ggc = curveFrom(chaserPathsG[i]);
    f = { team: 'gryf', role: 'chaser', rider: gg, root: gg.root, curve: ggc, len: ggc.getLength(), speed: 5.4 + i * 0.45, u0: [0.08, 0.42, 0.71][i], follow: null, phase: rr(0, TAU), bank: 0 };
    gg.root.position.copy(ggc.getPointAt(f.u0));
    teamsGroup.add(gg.root); flyers.push(f); gryfChasers.push(f);
  }
  for (i = 0; i < 3; i++) {
    var ss = createRider('slyth', 'chaser', { scale: 0.97 + i * 0.025, hair: hairTones[(i + 2) % hairTones.length] });
    var ssc = curveFrom(chaserPathsS[i]);
    f = { team: 'slyth', role: 'chaser', rider: ss, root: ss.root, curve: ssc, len: ssc.getLength(), speed: 5.0 + i * 0.5, u0: [0.55, 0.2, 0.83][i], follow: null, phase: rr(0, TAU), bank: 0 };
    ss.root.position.copy(ssc.getPointAt(f.u0));
    teamsGroup.add(ss.root); flyers.push(f); slythChasers.push(f);
  }
  for (i = 0; i < 2; i++) {
    addFlyer('gryf', 'beater', beaterPathsG[i], { speed: 4.6 + i * 0.5, u0: [0.3, 0.72][i], scale: 1.04 });
  }
  for (i = 0; i < 2; i++) {
    addFlyer('slyth', 'beater', beaterPathsS[i], { speed: 4.3 + i * 0.55, u0: [0.6, 0.16][i], scale: 1.03 });
  }

  var keeperPathG = curveFrom([[-10.7, 3.0, 1.2], [-10.2, 4.4, 3.5], [-10.8, 5.3, 6.4], [-11.4, 4.0, 7.5], [-11.1, 2.7, 4.3]]);
  var keeperPathS = curveFrom([[10.7, 3.5, 6.8], [10.2, 4.8, 4.3], [10.8, 5.4, 1.6], [11.4, 4.1, 0.7], [11.0, 2.8, 3.9]]);
  addFlyer('gryf', 'keeper', null, { curve: keeperPathG, speed: 2.2, u0: 0.15, scale: 1.04 });
  addFlyer('slyth', 'keeper', null, { curve: keeperPathS, speed: 2.0, u0: 0.62, scale: 1.04 });

  var snitchCurve = curveFrom([
    [-8.6, 6.9, 10.4], [-2.0, 8.0, 4.0], [4.4, 6.6, 2.2], [9.4, 7.5, 6.2],
    [7.2, 5.9, 11.6], [1.0, 8.2, 12.4], [-5.0, 7.3, 9.2], [-10.4, 7.7, 5.4]
  ]);
  var snitchLen = snitchCurve.getLength();
  var snitchSpeed = 8.2;

  var harry = addFlyer('gryf', 'seeker', null, {
    curve: snitchCurve, speed: 8.2, u0: 0, scale: 1.06,
    follow: { lag: 0.018, side: 0.75, dy: -0.45 },
    longScarf: true, scarfColor: 0xf0c75a, hair: 0x2e211b
  });
  harry.isHarry = true;
  var draco = addFlyer('slyth', 'seeker', null, {
    curve: snitchCurve, speed: 8.2, u0: 0, scale: 1.02,
    follow: { lag: 0.036, side: -0.95, dy: -0.9 },
    longScarf: true, scarfColor: 0xd6ded4, hair: 0xd8c590
  });
  draco.isDraco = true;

  var snitch = new THREE.Group();
  var snitchBody = new THREE.Mesh(new THREE.SphereGeometry(0.17, 8, 6), mat(C.snitch, {
    metalness: 0.6, roughness: 0.28, emissive: 0x7a5209, emissiveIntensity: 0.55
  }));
  snitch.add(snitchBody);
  var wingMat = new THREE.MeshStandardMaterial({
    color: 0xf4ead0, roughness: 0.5, metalness: 0.2, side: THREE.DoubleSide,
    emissive: 0x4c3a10, emissiveIntensity: 0.18
  });
  var wingL = new THREE.Group();
  var wingMeshL = new THREE.Mesh(new THREE.PlaneGeometry(0.68, 0.26), wingMat);
  wingMeshL.position.x = 0.34;
  wingL.add(wingMeshL);
  wingL.position.set(0.07, 0.04, 0);
  var wingR = new THREE.Group();
  var wingMeshR = wingMeshL.clone();
  wingMeshR.position.x = -0.34;
  wingR.add(wingMeshR);
  wingR.position.set(-0.07, 0.04, 0);
  snitch.add(wingL, wingR);
  teamsGroup.add(snitch);

  function makeGlowTexture() {
    var S = 64, C = S / 2;
    var cv = document.createElement('canvas');
    cv.width = cv.height = S;
    var g = cv.getContext('2d');
    var grd = g.createRadialGradient(C, C, 0, C, C, C);
    grd.addColorStop(0, 'rgba(255,250,220,1)');
    grd.addColorStop(0.32, 'rgba(250,205,90,1)');
    grd.addColorStop(0.62, 'rgba(201,140,34,0.65)');
    grd.addColorStop(1, 'rgba(201,140,34,0)');
    g.fillStyle = grd;
    g.fillRect(0, 0, S, S);
    return smoothTex(new THREE.CanvasTexture(cv));
  }

  function makeSparkTexture() {
    var S = 64, C = S / 2;
    var cv = document.createElement('canvas');
    cv.width = cv.height = S;
    var g = cv.getContext('2d');
    var halo = g.createRadialGradient(C, C, 0, C, C, C);
    halo.addColorStop(0, 'rgba(255,248,214,0.85)');
    halo.addColorStop(0.3, 'rgba(246,200,77,0.42)');
    halo.addColorStop(0.7, 'rgba(214,150,38,0.10)');
    halo.addColorStop(1, 'rgba(214,150,38,0)');
    g.fillStyle = halo;
    g.fillRect(0, 0, S, S);
    // soft four-point star with a warm dark rim so it reads on pale stone
    g.beginPath();
    g.moveTo(C, 4);
    g.quadraticCurveTo(C + 4, C - 4, S - 4, C);
    g.quadraticCurveTo(C + 4, C + 4, C, S - 4);
    g.quadraticCurveTo(C - 4, C + 4, 4, C);
    g.quadraticCurveTo(C - 4, C - 4, C, 4);
    g.closePath();
    g.fillStyle = 'rgba(255,250,224,0.92)';
    g.fill();
    return smoothTex(new THREE.CanvasTexture(cv));
  }
  var glowTex = makeGlowTexture();
  var sparkTex = makeSparkTexture();
  var sparks = [];
  for (i = 0; i < 15; i++) {
    var smat = new THREE.MeshBasicMaterial({
      map: sparkTex, transparent: true, opacity: 0.95, depthWrite: false, side: THREE.DoubleSide
    });
    var spark = new THREE.Mesh(new THREE.PlaneGeometry(0.55, 0.55), smat);
    spark.rotation.y = PI / 4;
    spark.renderOrder = 4;
    teamsGroup.add(spark);
    sparks.push(spark);
  }

  var snitchHalo = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 2.7), new THREE.MeshBasicMaterial({
    map: glowTex, transparent: true, opacity: 0.5, depthWrite: false, side: THREE.DoubleSide
  }));
  snitchHalo.renderOrder = 4;
  teamsGroup.add(snitchHalo);

  var TRAIL_N = 24;
  var trailRibbonPos = new Float32Array(TRAIL_N * 2 * 3);
  var trailRibbonGeo = new THREE.BufferGeometry();
  trailRibbonGeo.setAttribute('position', new THREE.BufferAttribute(trailRibbonPos, 3));
  var trailIndex = [];
  for (var tri = 0; tri < TRAIL_N - 1; tri++) {
    var b0 = tri * 2;
    trailIndex.push(b0, b0 + 1, b0 + 2, b0 + 1, b0 + 3, b0 + 2);
  }
  trailRibbonGeo.setIndex(trailIndex);
  var trailRibbon = new THREE.Mesh(trailRibbonGeo, new THREE.MeshBasicMaterial({
    color: 0xf6c64f, transparent: true, opacity: 0.72, depthWrite: false, side: THREE.DoubleSide
  }));
  trailRibbon.frustumCulled = false;
  trailRibbon.renderOrder = 3;
  teamsGroup.add(trailRibbon);

  var quaffle = new THREE.Group();
  var quaffleBall = new THREE.Mesh(new THREE.SphereGeometry(0.19, 9, 7), mat(C.quaffle, { roughness: 0.82 }));
  quaffleBall.castShadow = true;
  quaffle.add(quaffleBall);
  var quaffleSeam = new THREE.Mesh(new THREE.TorusGeometry(0.192, 0.02, 4, 14), mat(0xd9b17a, { roughness: 0.9 }));
  quaffleSeam.rotation.x = PI / 2;
  quaffle.add(quaffleSeam);
  var quaffleSeam2 = quaffleSeam.clone();
  quaffleSeam2.rotation.set(0, 0, PI / 2);
  quaffle.add(quaffleSeam2);
  teamsGroup.add(quaffle);

  var bludgers = [];
  for (i = 0; i < 2; i++) {
    var bg = new THREE.Group();
    var ball = new THREE.Mesh(new THREE.IcosahedronGeometry(0.24, 0), mat(C.iron, { metalness: 0.5, roughness: 0.55 }));
    ball.castShadow = true;
    bg.add(ball);
    var ring = new THREE.Mesh(new THREE.TorusGeometry(0.245, 0.022, 4, 12), mat(0x7b3d2c, { roughness: 0.7 }));
    ring.rotation.x = 1.1;
    bg.add(ring);
    teamsGroup.add(bg);
    bludgers.push({ g: bg, phase: i * 2.2, dir: i === 0 ? 1 : -1 });
  }

  function animateRider(f, t) {
    var r = f.rider;
    for (var ci = 0; ci < r.cape.length; ci++) {
      var cs = r.cape[ci];
      cs.pivot.rotation.x = cs.base + Math.sin(t * cs.sp + f.phase + ci * 1.1) * cs.amp;
      cs.pivot.rotation.y = Math.sin(t * (cs.sp * 0.7) + ci + f.phase) * 0.16;
      cs.pivot.rotation.z = Math.sin(t * (cs.sp * 0.55) + ci * 1.7 + f.phase) * 0.1;
    }
    for (var sj = 0; sj < r.scarf.length; sj++) {
      var ss = r.scarf[sj];
      ss.pivot.rotation.x = ss.base + Math.sin(t * ss.sp + f.phase + sj * 1.4) * ss.amp;
      ss.pivot.rotation.z = Math.sin(t * (ss.sp * 0.8) + sj * 1.2 + f.phase) * 0.3;
    }
    if (r.bat) {
      r.bat.rotation.z = -0.9 + Math.sin(t * 3.0 + f.phase) * 0.55;
      r.bat.rotation.x = 0.5 + Math.cos(t * 2.1 + f.phase) * 0.3;
    }
  }

  var snitchU = 0;
  var snitchPhase = 0.16;
  function updateFlight(t, dt) {
    snitchU = (t * snitchSpeed / snitchLen + snitchPhase) % 1;
    for (var fi = 0; fi < flyers.length; fi++) {
      var fly = flyers[fi];
      var u;
      if (fly.follow) {
        u = (snitchU - fly.follow.lag + 1) % 1;
      } else {
        u = (fly.u0 + t * fly.speed / fly.len) % 1;
      }
      var p = fly.curve.getPointAt(u, vA);
      if (fly.follow) {
        var tanF = fly.curve.getTangentAt(u, vB);
        vC.crossVectors(tanF, UP).normalize();
        p.addScaledVector(vC, fly.follow.side);
        p.y += fly.follow.dy + Math.sin(t * 2.5 + fly.phase) * 0.06;
      } else {
        p.y += Math.sin(t * 2.1 + fly.phase) * 0.055;
      }
      var ahead = fly.curve.getTangentAt(u, vB);
      var ahead2 = fly.curve.getTangentAt((u + 0.012) % 1, vD);
      var turn = ahead.x * ahead2.z - ahead.z * ahead2.x;
      fly.bank += (clamp(-turn * 26, -0.85, 0.85) - fly.bank) * Math.min(1, dt * 5);
      axX.crossVectors(UP, ahead);
      if (axX.lengthSq() < 0.000001) axX.set(1, 0, 0); else axX.normalize();
      axY.crossVectors(ahead, axX).normalize();
      mA.makeBasis(axX, axY, ahead);
      var q = qA.setFromRotationMatrix(mA);
      q.multiply(qB.setFromAxisAngle(FWD, fly.bank + Math.sin(t * 2.8 + fly.phase) * 0.035));
      fly.root.position.copy(p);
      fly.root.quaternion.slerp(q, 1 - Math.exp(-dt * 11));
      fly.root.updateMatrixWorld(true);
      animateRider(fly, t);
    }
  }

  var quaffleSequence = [
    gryfChasers[0], gryfChasers[1], slythChasers[0], slythChasers[1],
    gryfChasers[2], slythChasers[2]
  ];
  var handA = new THREE.Vector3(), handB = new THREE.Vector3(), qPos = new THREE.Vector3();
  var passCycle = 1.55, passTime = 0.52;
  function updateQuaffle(t, dt) {
    var step = Math.floor(t / passCycle);
    var local = t - step * passCycle;
    var from = quaffleSequence[step % quaffleSequence.length];
    var to = quaffleSequence[(step + 1) % quaffleSequence.length];
    from.root.updateMatrixWorld(true);
    to.root.updateMatrixWorld(true);
    from.rider.anchor.getWorldPosition(handA);
    to.rider.anchor.getWorldPosition(handB);
    if (local < passTime) {
      var k = local / passTime;
      var e = k * k * (3 - 2 * k);
      qPos.lerpVectors(handA, handB, e);
      qPos.y += Math.sin(PI * e) * 0.85;
    } else {
      qPos.copy(handB);
    }
    quaffle.position.copy(qPos);
    quaffle.rotation.x += dt * 3.0;
    quaffle.rotation.y += dt * 5.0;
  }

  function updateBludgers(t) {
    for (var bi2 = 0; bi2 < bludgers.length; bi2++) {
      var bl = bludgers[bi2];
      var ang = t * (0.42 + bi2 * 0.09) * bl.dir + bl.phase;
      var brx = 8.2 + bi2 * 1.2, brz = 4.8 + bi2 * 0.8;
      bl.g.position.set(Math.cos(ang) * brx - 0.4, 3.1 + bi2 * 0.9 + Math.sin(t * 0.9 + bl.phase) * 0.7, 4 + Math.sin(ang) * brz);
      bl.g.rotation.x += 0.05;
      bl.g.rotation.y += 0.07;
    }
  }

  function updateSnitch(t) {
    var p = snitchCurve.getPointAt(snitchU, vA);
    var tan = snitchCurve.getTangentAt(snitchU, vB);
    vC.crossVectors(tan, UP).normalize();
    p.addScaledVector(vC, Math.sin(t * 9.5) * 0.16);
    p.y += Math.sin(t * 13.0) * 0.11;
    snitch.position.copy(p);
    axX.crossVectors(UP, tan);
    if (axX.lengthSq() < 0.000001) axX.set(1, 0, 0); else axX.normalize();
    axY.crossVectors(tan, axX).normalize();
    mA.makeBasis(axX, axY, tan);
    snitch.quaternion.setFromRotationMatrix(mA);
    var flap = Math.sin(t * 32.0) * 0.9;
    wingL.rotation.z = flap;
    wingR.rotation.z = -flap;
    wingL.rotation.y = 0.2;
    wingR.rotation.y = -0.2;

    var trp = trailRibbon.geometry.attributes.position;
    for (var ti = 0; ti < TRAIL_N; ti++) {
      var tu = (snitchU - ti * 0.0048 + 1) % 1;
      var tpp = snitchCurve.getPointAt(tu, vD);
      var ttan = snitchCurve.getTangentAt(tu, vC);
      var tside = vB.crossVectors(ttan, UP).normalize();
      var wdt = 0.38 * Math.pow(1 - ti / TRAIL_N, 0.65);
      trp.setXYZ(ti * 2, tpp.x + tside.x * wdt, tpp.y + 0.04, tpp.z + tside.z * wdt);
      trp.setXYZ(ti * 2 + 1, tpp.x - tside.x * wdt, tpp.y + 0.04, tpp.z - tside.z * wdt);
    }
    trp.needsUpdate = true;

    snitchHalo.position.copy(p);
    snitchHalo.quaternion.copy(activeCamera.quaternion);
    snitchHalo.material.opacity = 0.4 + Math.sin(t * 6.0) * 0.1;

    for (var si = 0; si < sparks.length; si++) {
      var uu = (snitchU - (si + 1) * 0.0065 + 1) % 1;
      var sp = snitchCurve.getPointAt(uu, vD);
      sp.y += 0.04 + si * 0.008;
      sparks[si].position.copy(sp);
      sparks[si].quaternion.copy(activeCamera.quaternion);
      sparks[si].scale.setScalar(1.3 - si * 0.035);
      sparks[si].material.opacity = 0.95 * Math.pow(1 - si / sparks.length, 1.2);
    }
  }

  updaters.push(function (t, dt) {
    updateFlight(t, dt);
    updateQuaffle(t, dt);
    updateBludgers(t);
    updateSnitch(t);
  });

  window.__quidditch = { flyers: flyers, snitchCurve: snitchCurve, harry: harry, draco: draco };

  updaters.push(function (t) {
    for (var i = 0; i < cloths.length; i++) {
      var cl = cloths[i];
      var posAttr = cl.mesh.geometry.attributes.position;
      var arr = posAttr.array, base = cl.base;
      for (var v = 0; v < posAttr.count; v++) {
        var bx = base[v * 3], by = base[v * 3 + 1], bz = base[v * 3 + 2];
        var hang = clamp(-by / cl.maxHang, 0, 1);
        arr[v * 3 + 2] = bz + Math.sin(bx * 3.2 + by * 2.2 + t * 2.4 + cl.phase) * cl.amp * (0.25 + hang);
      }
      posAttr.needsUpdate = true;
    }
  });

  (function () {
    var b = new THREE.Box3().setFromObject(castle);
    fitCorners = [];
    for (var fx = 0; fx < 2; fx++) {
      for (var fy = 0; fy < 2; fy++) {
        for (var fz = 0; fz < 2; fz++) {
          fitCorners.push(new THREE.Vector3(
            fx ? b.max.x : b.min.x,
            fy ? b.max.y : b.min.y,
            fz ? b.max.z : b.min.z
          ));
        }
      }
    }
  })();

  /* --------------------------------------------------------------- render */
  var clockObj = new THREE.Clock();
  var elapsed = 0;
  function animate() {
    requestAnimationFrame(animate);
    var dt = Math.min(clockObj.getDelta(), 0.05);
    elapsed += dt;
    updateCamera(dt);
    // keep the distant ridges / haze behind the diorama from every azimuth
    backdrop.rotation.y = view.az - PI / 4;
    for (var i = 0; i < updaters.length; i++) updaters[i](elapsed, dt);
    renderer.render(scene, activeCamera);
  }
  animate();

  window.__diorama = {
    scene: scene, camera: activeCamera, persp: persp, ortho: ortho, view: view,
    goal: goal, ctrl: ctrl, setProjection: setProjection, resetView: resetView,
    fitCorners: fitCorners, getFitZoom: function () { return fitZoom; },
    renderer: renderer, world: world, backdrop: backdrop, baseGroup: baseGroup,
    castle: castle, stadium: stadium, groundHeight: groundHeight
  };
})();
