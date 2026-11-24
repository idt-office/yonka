// Deterministic PRNG (mulberry32) so repeated seeks replay identical
// topples, dust and rings. Reseed from seek() for a cold-start lookalike.

let s = 0x9e3779b9;
export function reseed(v = 0x9e3779b9) {
  s = v >>> 0;
}
export function rand() {
  s = (s + 0x6d2b79f5) >>> 0;
  let t = s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
