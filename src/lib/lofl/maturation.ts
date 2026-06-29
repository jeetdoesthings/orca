import { prisma } from '../prisma';

const BASELINE_MATURATION_DAYS = 14;
const MAX_MATURATION_DAYS = 90;
const STRUCTURAL_DISTANCE_SCALAR = 70; // 70 days max added based on distance

/**
 * Calculates the dynamic maturation period (T_mat) for an intervention.
 * Bridging to a distant territory takes cognitively more time than a micro-expansion.
 */
export async function calculateDynamicMaturationPeriod(
  userId: string,
  targetTerritoryId: string
): Promise<Date> {
  // 1. Fetch user's current identity centroid (simplified as their territory affinity snapshot)
  // Or we can use the structural distance calculated in the UserTerritoryAffinity table if it exists.
  const affinity = await prisma.userTerritoryAffinity.findUnique({
    where: {
      userId_territoryId: {
        userId,
        territoryId: targetTerritoryId
      }
    }
  });

  // Structural distance measures how far the target is from user's comfort zone
  // If no affinity exists, assume maximum distance (1.0)
  const distance = affinity?.structuralDistance ?? 1.0;

  // 2. Calculate T_mat = Baseline + beta * D_struct
  const days = Math.round(BASELINE_MATURATION_DAYS + (STRUCTURAL_DISTANCE_SCALAR * distance));
  const clampedDays = Math.min(Math.max(days, BASELINE_MATURATION_DAYS), MAX_MATURATION_DAYS);

  const maturationDate = new Date();
  maturationDate.setDate(maturationDate.getDate() + clampedDays);

  return maturationDate;
}
