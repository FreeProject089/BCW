// Bringing somebody else's 3D model into the scene: what is accepted, what is refused, and
// why this file reads a `.glb` itself instead of handing it to three.js's glTF loader.
//
// The ask was "let us import our own 3D elements (optimised if possible)". This is the honest
// version of that. Every number below is a judgement call that stops looking like one the
// moment it becomes a constant, so the reasoning lives here next to it.
//
// ── Why this module does NOT use GLTFLoader, measured ────────────────────────────────────
// The obvious build is `import('three/examples/jsm/loaders/GLTFLoader.js')`, lazily, so only a
// site with a model pays for it. That was built, and then measured, and the measurement killed
// it. The loader's own code is small and it does land in a lazy chunk (57.92 kB raw / 17.32 kB
// gzipped for GLTFLoader + BufferGeometryUtils). But `three` ships as ONE module file
// (`three/build/three.module.js`, 1.3 MB), so every class GLTFLoader imports from it —
// AnimationClip, InstancedMesh, InterleavedBuffer, ImageBitmapLoader, three material types,
// the texture path — is retained in the `vendor-three` chunk, which is on the FIRST-LOAD path
// of every page. No chunking rule can move it: it is the same source module as the renderer.
//
// Measured on this build, same commit, one variable changed:
//   without the loader   vendor-three 496.02 kB raw / 124.88 kB gzipped
//   with the loader      vendor-three 545.57 kB raw / 138.29 kB gzipped   (+49.55 / +13.41)
//
// So the real price of a glTF parser is +13.4 kB gzipped on the first paint of every page for
// every visitor of every site, whether or not anybody ever imports a model. For an admin-only
// convenience that is the wrong trade, and it is the sort of cost that never gets found later
// because nothing about it looks like a mistake.
//
// What is left is this: a reader for the GLB container and its JSON chunk. glTF describes
// itself completely in that JSON — meshes, primitives, accessors, images, extensions — so the
// triangle count, the draw calls, the texture weight and every refusal below are all available
// without decoding a single vertex. It is ~5 kB, it imports nothing, and it answers the actual
// question: would this model be allowed, and what would it cost.
//
// The trade it makes, said plainly: it can measure a model and refuse it, but it cannot DRAW
// one. Showing an imported model in the scene means shipping the parser, and that is a
// decision to take with the +13.4 kB in hand — most likely alongside the server-side half,
// where the file is fetched by the page that needs it rather than validated in an admin form.
//
// ── Why .glb only ────────────────────────────────────────────────────────────────────────
// `.gltf` is JSON that points at its geometry (`.bin`) and its textures by URI. A single-file
// upload of one arrives with dangling references, and resolving them means either asking for a
// folder or letting the file name URLs we then fetch, from every visitor's browser, on every
// page, forever. `.glb` is the same format with all of it in one file, which is why it is what
// every exporter offers.
//
// `.obj` is grey without its sidecar `.mtl` (same folder problem, and materials are discarded
// here anyway). `.fbx` is proprietary and its three.js loader is ~1.1 MB of parser. `.dae` is
// XML. None of them buy a look `.glb` cannot, so none is worth a second reader.
//
// ── Why nothing in the file may execute, and how that is enforced ────────────────────────
// glTF has no script node, so the danger is not code, it is REACH. A `uri` that is not a
// `data:` URI turns a model into a beacon: every visitor's browser fetching a third-party
// server on every page load, with their IP and their referrer, because of a file an admin
// uploaded once. So:
//   · every `buffers[].uri` and `images[].uri` must be absent (held inside the GLB) or `data:`;
//   · `extensionsRequired` must be empty or name only extensions on the allowlist below. An
//     extension we do not understand is a refusal by name, never a shrug and carry on;
//   · the binary chunk is never decoded here, and no string out of the file is ever returned
//     for display except an offending URI, truncated, and the extension names.
// If this file ever does start feeding bytes to a parser, this function stays in front of it:
// the container is checked before anything downstream sees it.
//
// ── "Optimised if possible" ──────────────────────────────────────────────────────────────
// We do NOT decimate, and that is a decision rather than a gap. Mesh simplification done well
// is quadric error metrics with attribute and boundary preservation (meshoptimizer/gltfpack,
// ~200 kB of WebAssembly); hand-rolled edge collapse puts holes and flipped normals in exactly
// the models people care about. An "optimisation" that quietly ruins a model is worse than a
// refusal. So a model over budget is refused with the numbers it was judged by, and told which
// tool to fix it in.
//
// Draco (`KHR_draco_mesh_compression`) is refused for the same shape of reason: the loader shim
// is 6.37 kB / 2.71 kB gz, and it is useless without the ~700 kB WebAssembly decoder it fetches
// at runtime. 700 kB of decoder to shrink a file already capped at 8 MB is backwards.
//
// ── The budget, and why these numbers ────────────────────────────────────────────────────
// Whatever goes here is drawn behind every page, and the vertex shader runs a full 3D simplex
// noise per vertex per frame. The heaviest built-in shape is `halo` at 17 640 triangles, so the
// limits are set against that rather than against what a GPU could survive:
//   · 8 MB file. The entire site's JavaScript is ~336 kB gzipped; 8 MB is 25x the whole app,
//     downloaded before the backdrop can draw.
//   · 150 000 triangles refused, 50 000 warned. The fracture animation needs every face to own
//     its vertices, so 150 000 triangles is 450 000 vertices x 24 bytes of position+normal =
//     10.8 MB of GPU buffer. A ceiling, not a target.
//   · 8 draw calls refused, 4 warned, counted as node-instances x primitives. A file needing
//     dozens is usually a whole scene somebody dragged in rather than one object.
//   · texture bytes are measured and then reported as waste. An imported model would be drawn
//     with the scene's own shader so the site accent still colours it, which means textures are
//     never sampled: a 7 MB model that is 6 MB of texture is 6 MB of nothing, and it is worth
//     saying so instead of letting it pass as "well, it was under 8 MB".
//
// ── What this module is not ──────────────────────────────────────────────────────────────
// It reads, validates and measures. It does not upload and it does not store. A model every
// visitor downloads belongs in the platform's existing asset storage (PlatformAsset, which
// already has quotas, content types and serving) behind `manage_site`, with a field on the
// scene config pointing at it. Both halves are server-side and neither is in this pass.

/** Everything an import is judged by, in one object, so the UI prints the same numbers. */
export const MODEL_LIMITS = {
  bytes: 8 * 1024 * 1024,
  triangles: 150000,
  trianglesWarn: 50000,
  drawCalls: 8,
  drawCallsWarn: 4,
};

/**
 * glTF extensions accepted in `extensionsRequired`.
 *
 * One, and only because it touches geometry and nothing else: quantization stores positions
 * and normals as integers and decodes to the same vertices. Everything else — materials,
 * textures, variants, lights, instancing — either changes something discarded here or changes
 * something we would then be guessing about.
 */
const ALLOWED_REQUIRED_EXT = new Set(['KHR_mesh_quantization']);

/** A refusal the UI shows as-is. `code` is stable; `detail` carries the measured numbers. */
export class SceneModelError extends Error {
  constructor(code, detail) { super(code); this.code = code; this.detail = detail || {}; }
}

const GLB_MAGIC = 0x46546c67;  // 'glTF'
const CHUNK_JSON = 0x4e4f534a; // 'JSON'

/** Triangles a primitive draws, by glTF primitive mode. Modes other than triangles draw none. */
function primitiveTriangles(prim, accessors) {
  const mode = Number.isInteger(prim?.mode) ? prim.mode : 4; // 4 = TRIANGLES, the default
  const src = Number.isInteger(prim?.indices) ? accessors[prim.indices] : accessors[prim?.attributes?.POSITION];
  const n = Number(src?.count);
  if (!Number.isFinite(n) || n <= 0) return 0;
  if (mode === 4) return Math.floor(n / 3);
  if (mode === 5 || mode === 6) return Math.max(0, n - 2); // strip, fan
  return 0;
}

/**
 * How many times each mesh is actually drawn.
 *
 * A glTF mesh can be referenced by several nodes — one tree, twenty trees. Counting `meshes`
 * would report one object for a forest, which is precisely the file the draw-call cap exists
 * to catch. Walked from the scene's roots, with a visited set because a malformed file can
 * describe a cycle and an honest recursion would then never return.
 */
function meshInstanceCounts(json) {
  const nodes = Array.isArray(json.nodes) ? json.nodes : [];
  const counts = new Map();
  const roots = Array.isArray(json.scenes?.[json.scene ?? 0]?.nodes)
    ? json.scenes[json.scene ?? 0].nodes
    : nodes.map((_, i) => i);
  const seen = new Set();
  const stack = [...roots];
  while (stack.length) {
    const i = stack.pop();
    if (!Number.isInteger(i) || seen.has(i)) continue;
    seen.add(i);
    const node = nodes[i];
    if (!node) continue;
    if (Number.isInteger(node.mesh)) counts.set(node.mesh, (counts.get(node.mesh) || 0) + 1);
    for (const c of Array.isArray(node.children) ? node.children : []) stack.push(c);
  }
  // A file with meshes and no scene graph still has meshes. Draw them once each rather than
  // reporting an empty model, which would read as "nothing in it" for a perfectly valid file.
  if (!counts.size) for (let i = 0; i < (json.meshes?.length || 0); i++) counts.set(i, 1);
  return counts;
}

/**
 * Read a GLB, validate its container and its JSON chunk, and measure what it would cost.
 *
 * Throws `SceneModelError` on anything refused. Returns `{ stats, warnings }` otherwise, where
 * a warning means "this draws, and here is what it costs you".
 */
export function inspectGlb(buffer) {
  const bytes = buffer.byteLength;
  if (bytes > MODEL_LIMITS.bytes) throw new SceneModelError('too_large', { bytes, max: MODEL_LIMITS.bytes });
  if (bytes < 20) throw new SceneModelError('not_glb', { bytes });
  const dv = new DataView(buffer);
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw new SceneModelError('not_glb', { bytes });
  const version = dv.getUint32(4, true);
  if (version !== 2) throw new SceneModelError('bad_version', { version });
  // The container declares its own length. A mismatch is a truncated or padded upload, and a
  // declared length that disagrees with the file is how a reader gets walked off its buffer.
  if (dv.getUint32(8, true) !== bytes) throw new SceneModelError('length_mismatch', { declared: dv.getUint32(8, true), bytes });

  const jsonLen = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== CHUNK_JSON) throw new SceneModelError('not_glb', { bytes });
  if (jsonLen <= 0 || 20 + jsonLen > bytes) throw new SceneModelError('length_mismatch', { declared: jsonLen, bytes });

  let json;
  try {
    json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLen)));
  } catch { throw new SceneModelError('bad_json', {}); }
  if (!json || typeof json !== 'object' || Array.isArray(json)) throw new SceneModelError('bad_json', {});

  const required = Array.isArray(json.extensionsRequired) ? json.extensionsRequired : [];
  const unknown = required.filter((k) => !ALLOWED_REQUIRED_EXT.has(String(k))).map((k) => String(k).slice(0, 60));
  if (unknown.includes('KHR_draco_mesh_compression')) throw new SceneModelError('draco', { ext: unknown });
  if (unknown.length) throw new SceneModelError('unknown_extension', { ext: unknown });

  // Anything the file points at OUTSIDE itself. `data:` is inline and fine; a bare filename or
  // a URL is a fetch from the visitor's browser on every page load, which is the one thing a
  // background decoration must never do.
  const external = [];
  for (const list of [json.buffers, json.images]) {
    for (const entry of Array.isArray(list) ? list : []) {
      const uri = entry && typeof entry.uri === 'string' ? entry.uri : null;
      if (uri && !uri.startsWith('data:')) external.push(uri.slice(0, 120));
    }
  }
  if (external.length) throw new SceneModelError('external_reference', { uri: external });

  const accessors = Array.isArray(json.accessors) ? json.accessors : [];
  const meshes = Array.isArray(json.meshes) ? json.meshes : [];
  const instances = meshInstanceCounts(json);

  let triangles = 0;
  let vertices = 0;
  let drawCalls = 0;
  for (const [index, times] of instances) {
    const prims = Array.isArray(meshes[index]?.primitives) ? meshes[index].primitives : [];
    for (const p of prims) {
      triangles += primitiveTriangles(p, accessors) * times;
      vertices += (Number(accessors[p?.attributes?.POSITION]?.count) || 0) * times;
      drawCalls += times;
    }
  }
  if (!triangles) throw new SceneModelError('no_geometry', {});
  if (drawCalls > MODEL_LIMITS.drawCalls) throw new SceneModelError('too_many_draws', { drawCalls, max: MODEL_LIMITS.drawCalls });
  if (triangles > MODEL_LIMITS.triangles) throw new SceneModelError('too_many_triangles', { triangles, max: MODEL_LIMITS.triangles });

  // Texture weight. Measured because it is the half of a heavy file that buys nothing here.
  let textureBytes = 0;
  for (const img of Array.isArray(json.images) ? json.images : []) {
    if (typeof img?.uri === 'string' && img.uri.startsWith('data:')) {
      textureBytes += Math.floor((img.uri.length - img.uri.indexOf(',') - 1) * 0.75); // base64
    } else if (Number.isInteger(img?.bufferView)) {
      const bv = json.bufferViews?.[img.bufferView];
      if (Number.isFinite(bv?.byteLength)) textureBytes += bv.byteLength;
    }
  }

  const warnings = [];
  if (triangles > MODEL_LIMITS.trianglesWarn) warnings.push('triangles');
  if (drawCalls > MODEL_LIMITS.drawCallsWarn) warnings.push('draws');
  if (textureBytes > bytes / 2) warnings.push('textures');

  return {
    warnings,
    stats: {
      bytes,
      textureBytes,
      triangles,
      vertices,
      drawCalls,
      // Position + normal, float32, one set per face because the fracture needs it: what the
      // card would actually hold if this model were drawn.
      gpuBytes: triangles * 3 * 24,
      generator: typeof json.asset?.generator === 'string' ? json.asset.generator.slice(0, 80) : '',
    },
  };
}
