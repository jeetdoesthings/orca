'use client';

/**
 * Exploration depth cycle control (Shore → Shallow → Deep → Alo).
 * Extracted from OrcaHUD for file-size / modularity.
 */
import { WorldConfig, type ExplorationDepthId } from '@/lib/config/world';
import { Tooltip } from '@/components/ui/Tooltip';

export interface DepthControlProps {
  activeDepth: ExplorationDepthId;
  onCycle: (e?: { preventDefault?: () => void; stopPropagation?: () => void }) => void;
  isMobile?: boolean;
}

export function DepthControl({ activeDepth, onCycle, isMobile }: DepthControlProps) {
  const label = WorldConfig.explorationDepth[activeDepth].label;
  return (
    <div
      className="orca-hud-pill-wrap orca-hud-pill-wrap--center"
      style={{ zIndex: 60, bottom: isMobile ? 20 : undefined }}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      <Tooltip position="top" content="Exploration depth">
        <button
          type="button"
          className="orca-hud-pill-btn"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={onCycle}
          aria-label={`Exploration depth: ${label}. Click to change.`}
        >
          {label}
        </button>
      </Tooltip>
    </div>
  );
}
