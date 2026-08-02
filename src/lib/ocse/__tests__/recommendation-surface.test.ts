import { describe, it, expect } from 'vitest';
import {
  buildRecommendationSurface,
  bucketDistanceFit,
  flattenRecommendationSurface,
} from '@/lib/ocse/recommendation-surface';
import type { Candidate } from '@/lib/candidate/cub-types';
import type { OCSEContext } from '@/lib/ocse/ocse-types';
import type { DisaggregatedDistance } from '@/lib/expansion/distance-components';
import type { ReadinessState } from '@/lib/readiness/readiness-types';
import type { GenreRelationship } from '@/lib/gre/gre-types';

function dist(
  territory: number,
  scene: number,
  era: number,
  language: number,
): DisaggregatedDistance {
  const mk = (value: number) =>
    ({ value, confidence: 'partial_confidence' as const });
  const composite = (territory + scene + era + language) / 4;
  return {
    territory_distance: mk(territory),
    scene_distance: mk(scene),
    era_distance: mk(era),
    language_distance: mk(language),
    composite,
    compositeConfidence: 'partial_confidence',
  };
}

function cand(
  id: string,
  name: string,
  genres: string[],
  d: DisaggregatedDistance,
): Candidate {
  return {
    artistId: id,
    name,
    genres,
    popularity: 50,
    imageUrl: '',
    discoveryContext: {
      growthOpportunity: genres[0] ?? 'pop',
      relationshipStage: 'UNTUCHED',
      supportingArtists: [],
      sources: [],
    },
    discoveryConfidence: 0.7,
    candidateClassification: 'EXPANSION',
    expansionDistance: d.composite,
    distanceComponents: d,
    audioSource: 'partial_confidence',
    confidenceTag: 'partial_confidence',
  };
}

const readiness: ReadinessState = {
  recommendedTier: 'expansion',
  reasoning: 'Recommended: Expansion — based on test fixture',
  computedAt: new Date().toISOString(),
};

function makeRel(genre: string): GenreRelationship {
  return {
    genre,
    stage: 'UNTUCHED',
    metrics: {
      familiarity: 0.1,
      diversity: 0.5,
      identity: 0.1,
      recency: 0.5,
      stability: 0.5,
    },
    summary: {
      relationshipStrength: 0.2,
      relationshipMomentum: 0.5,
      relationshipBreadth: 0.5,
      relationshipConfidence: 0.5,
    },
    confidence: 0.5,
  };
}

describe('Recommendation Surface (Change C)', () => {
  it('bucketDistanceFit prefers low distance for comfort', () => {
    const near = dist(0.2, 0.25, 0.3, 0.2);
    const far = dist(0.85, 0.8, 0.7, 0.9);
    expect(bucketDistanceFit(near, 'comfort')).toBeGreaterThan(
      bucketDistanceFit(far, 'comfort'),
    );
    expect(bucketDistanceFit(far, 'leap')).toBeGreaterThan(
      bucketDistanceFit(near, 'leap'),
    );
  });

  it('fills three non-empty distinct buckets from one candidate pool', () => {
    const candidates: Candidate[] = [];
    for (let i = 0; i < 12; i++) {
      candidates.push(
        cand(
          `c${i}`,
          `Comfort ${i}`,
          ['pop'],
          dist(0.2 + i * 0.01, 0.25, 0.3, 0.2),
        ),
      );
    }
    const expansionGenres = [['indie-rock'], ['rock'], ['folk']];
    for (let i = 0; i < 12; i++) {
      candidates.push(
        cand(
          `e${i}`,
          `Expansion ${i}`,
          expansionGenres[i % 3],
          dist(0.5 + i * 0.01, 0.5, 0.45, 0.5),
        ),
      );
    }
    const leapGenres = [['techno'], ['jazz'], ['classical']];
    for (let i = 0; i < 12; i++) {
      candidates.push(
        cand(
          `l${i}`,
          `Leap ${i}`,
          leapGenres[i % 3],
          dist(0.8, 0.75, 0.6, 0.85),
        ),
      );
    }

    const context: OCSEContext = {
      relationships: [
        makeRel('pop'),
        makeRel('rock'),
        makeRel('techno'),
        makeRel('jazz'),
      ],
      sliderValue: 0.5,
      interactionHistory: {
        timesShown: {},
        timesIgnored: {},
        timesDismissed: {},
        timesIntegrated: {},
        lastShown: {},
      },
      currentVisibleWorldIds: [],
      readinessState: readiness,
    };

    const surface = buildRecommendationSurface(candidates, context, readiness);

    expect(surface.comfort.length).toBeGreaterThan(0);
    expect(surface.expansion.length).toBeGreaterThan(0);
    expect(surface.leap.length).toBeGreaterThan(0);

    const cIds = new Set(surface.comfort.map((p) => p.candidateId));
    const eIds = new Set(surface.expansion.map((p) => p.candidateId));
    const lIds = new Set(surface.leap.map((p) => p.candidateId));

    // Exclusive assignment: no id in two buckets
    for (const id of cIds) {
      expect(eIds.has(id)).toBe(false);
      expect(lIds.has(id)).toBe(false);
    }
    for (const id of eIds) {
      expect(lIds.has(id)).toBe(false);
    }

    // Distinct sets (not the same list reshuffled)
    expect(cIds).not.toEqual(eIds);
    expect(eIds).not.toEqual(lIds);

    // Tier switch is pure read of surface
    const flatExp = flattenRecommendationSurface({
      ...surface,
      readiness: { ...readiness, recommendedTier: 'expansion' },
    });
    const flatLeap = flattenRecommendationSurface({
      ...surface,
      readiness: { ...readiness, recommendedTier: 'leap' },
    });
    expect(flatExp[0]?.readinessBucket).toBe('expansion');
    expect(flatLeap[0]?.readinessBucket).toBe('leap');
    expect(flatExp.map((p) => p.candidateId).join(',')).not.toBe(
      flatLeap.map((p) => p.candidateId).join(','),
    );
  });
});
