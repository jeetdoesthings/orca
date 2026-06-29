import type { AudioSignature } from '@/lib/graph/types';

export const MOOD_DEFINITIONS = [
  {
    label: 'late-night melancholy',
    condition: (f: AudioSignature) => f.valence < 0.35 && f.energy < 0.50 && f.acousticness > 0.25,
  },
  {
    label: 'euphoric rush',
    condition: (f: AudioSignature) => f.valence > 0.70 && f.energy > 0.75,
  },
  {
    label: 'morning clarity',
    condition: (f: AudioSignature) => f.valence > 0.55 && f.energy > 0.40 && f.energy < 0.75 && f.acousticness > 0.35,
  },
  {
    label: 'restless energy',
    condition: (f: AudioSignature) => f.energy > 0.75 && f.valence > 0.35 && f.valence < 0.70,
  },
  {
    label: 'tender introspection',
    condition: (f: AudioSignature) => f.valence > 0.30 && f.valence < 0.65 && f.energy < 0.45 && f.acousticness > 0.45,
  },
  {
    label: 'triumphant arrival',
    condition: (f: AudioSignature) => f.valence > 0.70 && f.energy > 0.55 && f.energy < 0.80,
  },
  {
    label: 'floating dissociation',
    condition: (f: AudioSignature) => f.instrumentalness > 0.50 && f.energy < 0.35,
  },
  {
    label: 'defiant noise',
    condition: (f: AudioSignature) => f.energy > 0.80 && f.valence < 0.45,
  },
  {
    label: 'sun-drenched warmth',
    condition: (f: AudioSignature) => f.valence > 0.70 && f.acousticness > 0.35 && f.energy < 0.70,
  },
  {
    label: 'underground pulse',
    condition: (f: AudioSignature) => f.danceability > 0.70 && f.energy > 0.60 && f.valence < 0.60,
  },
  {
    label: 'nostalgic ache',
    condition: (f: AudioSignature) => f.valence < 0.50 && f.tempo < 95,
  },
  {
    label: 'sacred stillness',
    condition: (f: AudioSignature) => f.instrumentalness > 0.40 && f.energy < 0.25,
  },
];

export function getMoodLabel(f: AudioSignature): string {
  const match = MOOD_DEFINITIONS.find(def => def.condition(f));
  return match?.label ?? 'varied energy';
}
