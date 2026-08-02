'use client';

/**
 * Bottom-left globe stats (artists / territories / explored counts).
 */
export interface GlobeStatsProps {
  artistCount: number;
  territoryCount: number;
  exploredCount: number;
  unexploredCount: number;
  tasteSummary?: string;
  hasGraph: boolean;
}

export function GlobeStats({
  artistCount,
  territoryCount,
  exploredCount,
  unexploredCount,
  tasteSummary,
  hasGraph,
}: GlobeStatsProps) {
  if (!hasGraph && !tasteSummary) return null;
  return (
    <div className="orca-stats">
      {hasGraph ? (
        <>
          <div>
            {artistCount} artists
            <span style={{ fontWeight: 700, margin: '0 5px', opacity: 0.7 }}>·</span>
            {territoryCount} territories
          </div>
          <div>
            {exploredCount} explored
            <span style={{ fontWeight: 700, margin: '0 5px', opacity: 0.7 }}>·</span>
            {unexploredCount} unexplored
          </div>
        </>
      ) : (
        <div>{tasteSummary}</div>
      )}
    </div>
  );
}
