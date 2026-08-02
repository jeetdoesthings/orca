/**
 * Calculates Euclidean distance between two equal-length vectors.
 */
export function euclideanDistance(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0.0;

  let sum = 0.0;
  for (let i = 0; i < len; i++) {
    const diff = a[i] - b[i];
    sum += diff * diff;
  }
  return Math.sqrt(sum);
}

/**
 * Clamp a value between a minimum and maximum.
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * Clamp a value to the [0.0, 1.0] range.
 */
export function clamp01(value: number): number {
  return Math.min(Math.max(value, 0.0), 1.0);
}

/**
 * Calculates cosine similarity between two vectors.
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0.0;
  
  let dot = 0.0;
  let normA = 0.0;
  let normB = 0.0;
  
  for (let i = 0; i < len; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  
  if (normA === 0.0 || normB === 0.0) return 0.0;
  return dot / Math.sqrt(normA * normB);
}

/**
 * Normalizes a tempo value from BPM into the 0–1 range.
 * Assumes a valid BPM range of [40, 200].
 */
export function normalizeTempo(bpm: number): number {
  const min = 40.0;
  const range = 160.0;
  return Math.max(0.0, Math.min(1.0, (bpm - min) / range));
}
