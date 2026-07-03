// Client-side proof-of-work solver for signup. The challenge/nonce are ASCII
// ([0-9a-f.:]), so a compact synchronous SHA-256 is enough and fast.
// SHA-256 (public-domain, ASCII input) — https://geraintluff.github.io/sha256/
function sha256(ascii) {
  function rightRotate(value, amount) { return (value >>> amount) | (value << (32 - amount)); }
  const mathPow = Math.pow;
  const maxWord = mathPow(2, 32);
  let result = '';
  const words = [];
  const asciiBitLength = ascii.length * 8;
  let hash = sha256.h = sha256.h || [];
  const k = sha256.k = sha256.k || [];
  let primeCounter = k.length;
  const isComposite = {};
  for (let candidate = 2; primeCounter < 64; candidate++) {
    if (!isComposite[candidate]) {
      for (let i = 0; i < 313; i += candidate) { isComposite[i] = candidate; }
      hash[primeCounter] = (mathPow(candidate, 0.5) * maxWord) | 0;
      k[primeCounter++] = (mathPow(candidate, 1 / 3) * maxWord) | 0;
    }
  }
  ascii += '\x80';
  while (ascii.length % 64 - 56) ascii += '\x00';
  for (let i = 0; i < ascii.length; i++) {
    const j = ascii.charCodeAt(i);
    if (j >> 8) return '';
    words[i >> 2] |= j << ((3 - i) % 4) * 8;
  }
  words[words.length] = (asciiBitLength / maxWord) | 0;
  words[words.length] = asciiBitLength;
  for (let j = 0; j < words.length;) {
    const w = words.slice(j, j += 16);
    const oldHash = hash;
    hash = hash.slice(0, 8);
    for (let i = 0; i < 64; i++) {
      const w15 = w[i - 15], w2 = w[i - 2];
      const a = hash[0], e = hash[4];
      const temp1 = hash[7]
        + (rightRotate(e, 6) ^ rightRotate(e, 11) ^ rightRotate(e, 25))
        + ((e & hash[5]) ^ ((~e) & hash[6]))
        + k[i]
        + (w[i] = (i < 16) ? w[i] : (
          w[i - 16]
          + (rightRotate(w15, 7) ^ rightRotate(w15, 18) ^ (w15 >>> 3))
          + w[i - 7]
          + (rightRotate(w2, 17) ^ rightRotate(w2, 19) ^ (w2 >>> 10))
        ) | 0);
      const temp2 = (rightRotate(a, 2) ^ rightRotate(a, 13) ^ rightRotate(a, 22))
        + ((a & hash[1]) ^ (a & hash[2]) ^ (hash[1] & hash[2]));
      hash = [(temp1 + temp2) | 0].concat(hash);
      hash[4] = (hash[4] + temp1) | 0;
    }
    for (let i = 0; i < 8; i++) hash[i] = (hash[i] + oldHash[i]) | 0;
  }
  for (let i = 0; i < 8; i++) {
    for (let j = 3; j + 1; j--) {
      const b = (hash[i] >> (j * 8)) & 255;
      result += ((b < 16) ? 0 : '') + b.toString(16);
    }
  }
  return result;
}

function leadingZeroBits(hex) {
  let bits = 0;
  for (const ch of hex) { const v = parseInt(ch, 16); if (v === 0) { bits += 4; continue; } bits += Math.clz32(v) - 28; break; }
  return bits;
}

// Fetch a challenge, find a valid nonce, and return { challenge, nonce }.
// The search runs in a Web Worker so it never freezes the main thread (the
// three.js hero keeps animating and buttons stay responsive). Falls back to a
// synchronous solve only if Workers aren't available.
export async function solvePow(getChallenge) {
  const { challenge, difficulty } = await getChallenge();
  try {
    if (typeof Worker !== 'undefined') {
      const worker = new Worker(new URL('./pow-worker.js', import.meta.url), { type: 'module' });
      try {
        const nonce = await new Promise((resolve, reject) => {
          worker.onmessage = (e) => (e.data?.error ? reject(new Error(e.data.error)) : resolve(e.data.nonce));
          worker.onerror = () => reject(new Error('pow_worker_error'));
          worker.postMessage({ challenge, difficulty });
        });
        return { challenge, nonce };
      } finally { worker.terminate(); }
    }
  } catch { /* fall back to the synchronous solver below */ }
  for (let nonce = 0; nonce < 2e8; nonce++) {
    if (leadingZeroBits(sha256(`${challenge}:${nonce}`)) >= difficulty) return { challenge, nonce: String(nonce) };
  }
  throw new Error('pow_failed');
}
