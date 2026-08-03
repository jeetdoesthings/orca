-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "email" TEXT,
    "emailVerified" TIMESTAMP(3),
    "image" TEXT,
    "spotifyId" TEXT,
    "displayName" TEXT,
    "avatarUrl" TEXT,
    "country" TEXT,
    "lastSyncAt" TIMESTAMP(3),
    "syncStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "globeData" TEXT,
    "homeRegion" TEXT,
    "tasteSummary" TEXT,
    "frontierData" TEXT,
    "perimeterData" TEXT,
    "frontierStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "frontierComputedAt" TIMESTAMP(3),
    "worldStateData" TEXT,
    "adventurousnessHistory" TEXT,
    "profileData" TEXT,
    "profileVersion" INTEGER NOT NULL DEFAULT 0,
    "profileComputedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecommendationMemory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "sourceSnapshot" TEXT,
    "shownAt" TIMESTAMP(3),
    "openedAt" TIMESTAMP(3),
    "clickedAt" TIMESTAMP(3),
    "playedAt" TIMESTAMP(3),
    "savedAt" TIMESTAMP(3),
    "ignoredAt" TIMESTAMP(3),
    "hiddenAt" TIMESTAMP(3),
    "acceptedAt" TIMESTAMP(3),
    "replayedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RecommendationMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecommendationRun" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "promptVersion" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "candidateCount" INTEGER NOT NULL,
    "acceptedCount" INTEGER NOT NULL,
    "rejectedCount" INTEGER NOT NULL,
    "validationFailures" TEXT,
    "latencyMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecommendationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RecommendationServeLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "trackId" TEXT,
    "bucket" TEXT NOT NULL,
    "audioDistance" DOUBLE PRECISION NOT NULL,
    "territoryDistance" DOUBLE PRECISION NOT NULL,
    "sceneDistance" DOUBLE PRECISION NOT NULL,
    "eraDistance" DOUBLE PRECISION NOT NULL,
    "languageDistance" DOUBLE PRECISION NOT NULL,
    "audioConfidence" TEXT NOT NULL,
    "territoryConfidence" TEXT NOT NULL,
    "sceneConfidence" TEXT NOT NULL,
    "eraConfidence" TEXT NOT NULL,
    "languageConfidence" TEXT NOT NULL,
    "compositeDistance" DOUBLE PRECISION,
    "decisionScore" DOUBLE PRECISION,
    "readinessStateJson" TEXT NOT NULL,
    "scoreComponentsJson" TEXT,
    "durabilityOutcomeId" TEXT,
    "tesSnapshotId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RecommendationServeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerritoryRejection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "territoryKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cooldownUntil" TIMESTAMP(3) NOT NULL,
    "sourceArtistId" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'territory_reject',

    CONSTRAINT "TerritoryRejection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgencyInteractionEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trackId" TEXT,
    "artistId" TEXT,
    "interactionType" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recommendationSnapshotId" TEXT,
    "durabilityOutcomeId" TEXT,
    "metadata" TEXT,

    CONSTRAINT "AgencyInteractionEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DurabilityOutcome" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trackId" TEXT,
    "artistId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "score" DOUBLE PRECISION,
    "measuredAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DurabilityOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgencyWeightProposal" (
    "id" TEXT NOT NULL,
    "weightsJson" TEXT NOT NULL,
    "sampleSize" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "method" TEXT NOT NULL DEFAULT 'mean_durability_by_type',
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,

    CONSTRAINT "AgencyWeightProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TesSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trackId" TEXT,
    "artistId" TEXT,
    "territoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "foreignness" DOUBLE PRECISION NOT NULL,
    "durabilityAtSnap" DOUBLE PRECISION,
    "durabilityStatus" TEXT NOT NULL DEFAULT 'pending',
    "agency" DOUBLE PRECISION NOT NULL,
    "meaningfulness" DOUBLE PRECISION,
    "tesScore" DOUBLE PRECISION NOT NULL,
    "familiarity" DOUBLE PRECISION,
    "confidenceTag" TEXT,
    "audioConfidenceTag" TEXT,
    "componentsJson" TEXT,
    "previousSnapshotId" TEXT,

    CONSTRAINT "TesSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DurabilityEvent" (
    "id" TEXT NOT NULL,
    "tesSnapshotId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trackId" TEXT,
    "artistId" TEXT,
    "eventType" TEXT NOT NULL,
    "unprompted" BOOLEAN NOT NULL DEFAULT false,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "metadata" TEXT,

    CONSTRAINT "DurabilityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "refresh_token" TEXT,
    "access_token" TEXT,
    "expires_at" INTEGER,
    "token_type" TEXT,
    "scope" TEXT,
    "id_token" TEXT,
    "session_state" TEXT,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExploredArtist" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "exploredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastExploredAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExploredArtist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Artist" (
    "id" TEXT NOT NULL,
    "spotifyId" TEXT,
    "displayName" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "rawGenres" TEXT NOT NULL,
    "popularity" INTEGER NOT NULL,
    "followers" INTEGER NOT NULL,
    "imageUrl" TEXT,
    "metadata" TEXT,
    "sourceEvidence" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Artist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArtistEmbedding" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "embeddingVersion" INTEGER NOT NULL,
    "audioVector" TEXT,
    "textVector" TEXT,
    "traitVector" TEXT,
    "structuralVector" TEXT,
    "fusedVector" TEXT,
    "confidence" DOUBLE PRECISION NOT NULL,
    "confidenceTag" TEXT,
    "modelId" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sourceDataHash" TEXT,
    "normalizationVersion" INTEGER NOT NULL,

    CONSTRAINT "ArtistEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TrackEmbedding" (
    "id" TEXT NOT NULL,
    "trackKey" TEXT NOT NULL,
    "deezerTrackId" TEXT,
    "previewUrl" TEXT,
    "embeddingVector" TEXT NOT NULL,
    "embeddingDim" INTEGER NOT NULL,
    "signatureJson" TEXT,
    "confidenceTag" TEXT NOT NULL,
    "modelId" TEXT NOT NULL,
    "sourceDataHash" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TrackEmbedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TraitDefinition" (
    "id" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "formula" TEXT,
    "activeFlag" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "TraitDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Territory" (
    "id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "centroidVector" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "density" DOUBLE PRECISION NOT NULL,
    "cohesion" DOUBLE PRECISION NOT NULL,
    "stability" DOUBLE PRECISION NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Territory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerritoryMembership" (
    "id" TEXT NOT NULL,
    "territoryId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "membershipStrength" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "role" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TerritoryMembership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerritoryBridge" (
    "id" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "territoryAId" TEXT NOT NULL,
    "territoryBId" TEXT NOT NULL,
    "bridgeStrength" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TerritoryBridge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerritorySimilarity" (
    "id" TEXT NOT NULL,
    "territoryAId" TEXT NOT NULL,
    "territoryBId" TEXT NOT NULL,
    "similarity" DOUBLE PRECISION NOT NULL,
    "distance" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TerritorySimilarity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerritorySnapshot" (
    "id" TEXT NOT NULL,
    "territoryId" TEXT NOT NULL,
    "snapshotDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "version" INTEGER NOT NULL,
    "centroidVector" TEXT NOT NULL,
    "size" INTEGER NOT NULL,
    "density" DOUBLE PRECISION NOT NULL,
    "cohesion" DOUBLE PRECISION NOT NULL,
    "stability" DOUBLE PRECISION NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TerritorySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTerritoryProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "occupancyVector" TEXT NOT NULL,
    "diversityScore" DOUBLE PRECISION NOT NULL,
    "concentrationScore" DOUBLE PRECISION NOT NULL,
    "entropyScore" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTerritoryProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTerritorySnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "territoryId" TEXT NOT NULL,
    "occupancy" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserTerritorySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerritoryMomentum" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "territoryId" TEXT NOT NULL,
    "previous" DOUBLE PRECISION NOT NULL,
    "current" DOUBLE PRECISION NOT NULL,
    "delta" DOUBLE PRECISION NOT NULL,
    "velocity" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TerritoryMomentum_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerritoryAdoption" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "territoryId" TEXT NOT NULL,
    "explorationCount" INTEGER NOT NULL,
    "adoptionScore" DOUBLE PRECISION NOT NULL,
    "lastActivity" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TerritoryAdoption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TerritoryFamiliarity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "territoryId" TEXT NOT NULL,
    "familiarityScore" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,

    CONSTRAINT "TerritoryFamiliarity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTerritoryAffinity" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "territoryId" TEXT NOT NULL,
    "compatibilityScore" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "culturalCompatibility" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "sensoryCompatibility" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "structuralDistance" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "accessibility" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "occupancy" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "hiddenPotential" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "explanation" TEXT,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "modelVersion" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "UserTerritoryAffinity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTerritoryAffinitySnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "territoryId" TEXT NOT NULL,
    "compatibilityScore" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "componentScores" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserTerritoryAffinitySnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserBanditState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "parameterString" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserBanditState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BanditDecision" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "decisionId" TEXT NOT NULL,
    "contextVector" TEXT NOT NULL,
    "chosenAction" INTEGER NOT NULL,
    "ucbValues" TEXT NOT NULL,
    "reward" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "feedbackReceived" BOOLEAN NOT NULL DEFAULT false,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BanditDecision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTerritoryRelationship" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "territoryId" TEXT NOT NULL,
    "currentState" TEXT NOT NULL,
    "stateConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "residenceStrength" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "explorationStrength" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "curiosityStrength" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "resistanceStrength" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "dormancyStrength" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "returnStrength" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "emergenceStrength" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserTerritoryRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserGenreRelationshipState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "genre" TEXT NOT NULL,
    "currentState" TEXT NOT NULL,
    "stateConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "previousStage" TEXT,
    "momentum" DOUBLE PRECISION,
    "lastUpdatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserGenreRelationshipState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTerritoryRelationshipSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "territoryId" TEXT NOT NULL,
    "state" TEXT NOT NULL,
    "stateConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "componentScores" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserTerritoryRelationshipSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelationshipTransition" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "territoryId" TEXT NOT NULL,
    "previousState" TEXT NOT NULL,
    "currentState" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reasonCodes" TEXT NOT NULL,

    CONSTRAINT "RelationshipTransition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RelationshipExplanation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "territoryId" TEXT NOT NULL,
    "explanationPayload" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RelationshipExplanation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTerritoryIntervention" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "territoryId" TEXT NOT NULL,
    "interventionType" TEXT NOT NULL,
    "interventionScore" DOUBLE PRECISION NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL,
    "expectedAdoptionImpact" DOUBLE PRECISION NOT NULL,
    "expectedRejectionRisk" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserTerritoryIntervention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterventionScoreBreakdown" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "territoryId" TEXT NOT NULL,
    "introScore" DOUBLE PRECISION NOT NULL,
    "bridgeScore" DOUBLE PRECISION NOT NULL,
    "reinforceScore" DOUBLE PRECISION NOT NULL,
    "reintroduceScore" DOUBLE PRECISION NOT NULL,
    "accelerateScore" DOUBLE PRECISION NOT NULL,
    "expandOutwardScore" DOUBLE PRECISION NOT NULL,
    "holdScore" DOUBLE PRECISION NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterventionScoreBreakdown_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterventionExplanation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "territoryId" TEXT NOT NULL,
    "explanationPayload" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InterventionExplanation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InterventionOutcome" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "territoryId" TEXT NOT NULL,
    "interventionType" TEXT NOT NULL,
    "outcomeLabel" TEXT NOT NULL,
    "adoptionChange" DOUBLE PRECISION NOT NULL,
    "rejectionChange" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InterventionOutcome_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTrackMemory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trackId" TEXT NOT NULL,
    "familiarity" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "agency" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "explorationDepth" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "persistence" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "memoryStrength" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "memoryState" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "lastReinforced" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTrackMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserArtistMemory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "familiarity" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "agency" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "explorationDepth" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "persistence" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "memoryStrength" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "memoryState" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "lastReinforced" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserArtistMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTerritoryMemory" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "territoryId" TEXT NOT NULL,
    "familiarity" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "agency" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "explorationDepth" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "persistence" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "memoryStrength" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "memoryState" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "lastReinforced" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UserTerritoryMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserListeningEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "artistId" TEXT NOT NULL,
    "territoryId" TEXT,
    "eventType" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER,
    "initiationType" TEXT,
    "sessionId" TEXT,
    "trackId" TEXT,

    CONSTRAINT "UserListeningEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserTerritoryCultivation" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "territoryId" TEXT NOT NULL,
    "familiarityScore" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "fluencyScore" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "adoptionProbability" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "exposureSchedule" TEXT NOT NULL,
    "adoptionState" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "lastExposureAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserTerritoryCultivation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LongitudinalIntervention" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "targetTerritoryId" TEXT NOT NULL,
    "pathwayHash" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'ACTIVE',
    "maturationDate" TIMESTAMP(3) NOT NULL,
    "baselineProbability" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "expectedOutcome" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LongitudinalIntervention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OutcomeEvent" (
    "id" TEXT NOT NULL,
    "interventionId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "agencyWeight" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OutcomeEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LOFLAttribution" (
    "id" TEXT NOT NULL,
    "interventionId" TEXT NOT NULL,
    "totalRawOutcome" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "exogenousCredit" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "orcaCredit" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LOFLAttribution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GlobalPathwayTemplate" (
    "id" TEXT NOT NULL,
    "sourceTerritory" TEXT NOT NULL,
    "targetTerritory" TEXT NOT NULL,
    "pathwayNodes" TEXT NOT NULL,
    "successCount" INTEGER NOT NULL DEFAULT 0,
    "failureCount" INTEGER NOT NULL DEFAULT 0,
    "conversionRate" DOUBLE PRECISION NOT NULL DEFAULT 0.0,
    "lastUpdated" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GlobalPathwayTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_spotifyId_key" ON "User"("spotifyId");

-- CreateIndex
CREATE INDEX "User_spotifyId_idx" ON "User"("spotifyId");

-- CreateIndex
CREATE INDEX "RecommendationMemory_userId_idx" ON "RecommendationMemory"("userId");

-- CreateIndex
CREATE INDEX "RecommendationMemory_artistId_idx" ON "RecommendationMemory"("artistId");

-- CreateIndex
CREATE INDEX "RecommendationMemory_status_idx" ON "RecommendationMemory"("status");

-- CreateIndex
CREATE INDEX "RecommendationMemory_updatedAt_idx" ON "RecommendationMemory"("updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RecommendationMemory_userId_artistId_key" ON "RecommendationMemory"("userId", "artistId");

-- CreateIndex
CREATE INDEX "RecommendationRun_userId_idx" ON "RecommendationRun"("userId");

-- CreateIndex
CREATE INDEX "RecommendationRun_createdAt_idx" ON "RecommendationRun"("createdAt");

-- CreateIndex
CREATE INDEX "RecommendationRun_model_idx" ON "RecommendationRun"("model");

-- CreateIndex
CREATE INDEX "RecommendationServeLog_userId_idx" ON "RecommendationServeLog"("userId");

-- CreateIndex
CREATE INDEX "RecommendationServeLog_artistId_idx" ON "RecommendationServeLog"("artistId");

-- CreateIndex
CREATE INDEX "RecommendationServeLog_bucket_idx" ON "RecommendationServeLog"("bucket");

-- CreateIndex
CREATE INDEX "RecommendationServeLog_createdAt_idx" ON "RecommendationServeLog"("createdAt");

-- CreateIndex
CREATE INDEX "RecommendationServeLog_userId_bucket_idx" ON "RecommendationServeLog"("userId", "bucket");

-- CreateIndex
CREATE INDEX "TerritoryRejection_userId_idx" ON "TerritoryRejection"("userId");

-- CreateIndex
CREATE INDEX "TerritoryRejection_territoryKey_idx" ON "TerritoryRejection"("territoryKey");

-- CreateIndex
CREATE INDEX "TerritoryRejection_cooldownUntil_idx" ON "TerritoryRejection"("cooldownUntil");

-- CreateIndex
CREATE INDEX "TerritoryRejection_userId_territoryKey_idx" ON "TerritoryRejection"("userId", "territoryKey");

-- CreateIndex
CREATE INDEX "AgencyInteractionEvent_userId_idx" ON "AgencyInteractionEvent"("userId");

-- CreateIndex
CREATE INDEX "AgencyInteractionEvent_trackId_idx" ON "AgencyInteractionEvent"("trackId");

-- CreateIndex
CREATE INDEX "AgencyInteractionEvent_interactionType_idx" ON "AgencyInteractionEvent"("interactionType");

-- CreateIndex
CREATE INDEX "AgencyInteractionEvent_timestamp_idx" ON "AgencyInteractionEvent"("timestamp");

-- CreateIndex
CREATE INDEX "AgencyInteractionEvent_durabilityOutcomeId_idx" ON "AgencyInteractionEvent"("durabilityOutcomeId");

-- CreateIndex
CREATE INDEX "AgencyInteractionEvent_recommendationSnapshotId_idx" ON "AgencyInteractionEvent"("recommendationSnapshotId");

-- CreateIndex
CREATE INDEX "DurabilityOutcome_userId_idx" ON "DurabilityOutcome"("userId");

-- CreateIndex
CREATE INDEX "DurabilityOutcome_status_idx" ON "DurabilityOutcome"("status");

-- CreateIndex
CREATE INDEX "DurabilityOutcome_trackId_idx" ON "DurabilityOutcome"("trackId");

-- CreateIndex
CREATE INDEX "DurabilityOutcome_artistId_idx" ON "DurabilityOutcome"("artistId");

-- CreateIndex
CREATE INDEX "AgencyWeightProposal_status_idx" ON "AgencyWeightProposal"("status");

-- CreateIndex
CREATE INDEX "AgencyWeightProposal_createdAt_idx" ON "AgencyWeightProposal"("createdAt");

-- CreateIndex
CREATE INDEX "TesSnapshot_userId_idx" ON "TesSnapshot"("userId");

-- CreateIndex
CREATE INDEX "TesSnapshot_artistId_idx" ON "TesSnapshot"("artistId");

-- CreateIndex
CREATE INDEX "TesSnapshot_trackId_idx" ON "TesSnapshot"("trackId");

-- CreateIndex
CREATE INDEX "TesSnapshot_createdAt_idx" ON "TesSnapshot"("createdAt");

-- CreateIndex
CREATE INDEX "TesSnapshot_previousSnapshotId_idx" ON "TesSnapshot"("previousSnapshotId");

-- CreateIndex
CREATE INDEX "DurabilityEvent_tesSnapshotId_idx" ON "DurabilityEvent"("tesSnapshotId");

-- CreateIndex
CREATE INDEX "DurabilityEvent_userId_idx" ON "DurabilityEvent"("userId");

-- CreateIndex
CREATE INDEX "DurabilityEvent_timestamp_idx" ON "DurabilityEvent"("timestamp");

-- CreateIndex
CREATE INDEX "DurabilityEvent_eventType_idx" ON "DurabilityEvent"("eventType");

-- CreateIndex
CREATE UNIQUE INDEX "Account_provider_providerAccountId_key" ON "Account"("provider", "providerAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "ExploredArtist_userId_idx" ON "ExploredArtist"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "ExploredArtist_userId_artistId_key" ON "ExploredArtist"("userId", "artistId");

-- CreateIndex
CREATE UNIQUE INDEX "Artist_spotifyId_key" ON "Artist"("spotifyId");

-- CreateIndex
CREATE INDEX "Artist_normalizedName_idx" ON "Artist"("normalizedName");

-- CreateIndex
CREATE INDEX "Artist_spotifyId_idx" ON "Artist"("spotifyId");

-- CreateIndex
CREATE INDEX "ArtistEmbedding_artistId_idx" ON "ArtistEmbedding"("artistId");

-- CreateIndex
CREATE INDEX "ArtistEmbedding_confidenceTag_idx" ON "ArtistEmbedding"("confidenceTag");

-- CreateIndex
CREATE UNIQUE INDEX "ArtistEmbedding_artistId_embeddingVersion_key" ON "ArtistEmbedding"("artistId", "embeddingVersion");

-- CreateIndex
CREATE INDEX "TrackEmbedding_deezerTrackId_idx" ON "TrackEmbedding"("deezerTrackId");

-- CreateIndex
CREATE INDEX "TrackEmbedding_confidenceTag_idx" ON "TrackEmbedding"("confidenceTag");

-- CreateIndex
CREATE UNIQUE INDEX "TrackEmbedding_trackKey_modelId_key" ON "TrackEmbedding"("trackKey", "modelId");

-- CreateIndex
CREATE INDEX "TerritoryMembership_territoryId_idx" ON "TerritoryMembership"("territoryId");

-- CreateIndex
CREATE INDEX "TerritoryMembership_artistId_idx" ON "TerritoryMembership"("artistId");

-- CreateIndex
CREATE UNIQUE INDEX "TerritoryMembership_territoryId_artistId_key" ON "TerritoryMembership"("territoryId", "artistId");

-- CreateIndex
CREATE INDEX "TerritoryBridge_artistId_idx" ON "TerritoryBridge"("artistId");

-- CreateIndex
CREATE INDEX "TerritoryBridge_territoryAId_idx" ON "TerritoryBridge"("territoryAId");

-- CreateIndex
CREATE INDEX "TerritoryBridge_territoryBId_idx" ON "TerritoryBridge"("territoryBId");

-- CreateIndex
CREATE UNIQUE INDEX "TerritoryBridge_artistId_territoryAId_territoryBId_key" ON "TerritoryBridge"("artistId", "territoryAId", "territoryBId");

-- CreateIndex
CREATE INDEX "TerritorySimilarity_territoryAId_idx" ON "TerritorySimilarity"("territoryAId");

-- CreateIndex
CREATE INDEX "TerritorySimilarity_territoryBId_idx" ON "TerritorySimilarity"("territoryBId");

-- CreateIndex
CREATE UNIQUE INDEX "TerritorySimilarity_territoryAId_territoryBId_key" ON "TerritorySimilarity"("territoryAId", "territoryBId");

-- CreateIndex
CREATE INDEX "TerritorySnapshot_territoryId_idx" ON "TerritorySnapshot"("territoryId");

-- CreateIndex
CREATE UNIQUE INDEX "UserTerritoryProfile_userId_key" ON "UserTerritoryProfile"("userId");

-- CreateIndex
CREATE INDEX "UserTerritorySnapshot_userId_idx" ON "UserTerritorySnapshot"("userId");

-- CreateIndex
CREATE INDEX "UserTerritorySnapshot_territoryId_idx" ON "UserTerritorySnapshot"("territoryId");

-- CreateIndex
CREATE INDEX "UserTerritorySnapshot_timestamp_idx" ON "UserTerritorySnapshot"("timestamp");

-- CreateIndex
CREATE INDEX "TerritoryMomentum_userId_idx" ON "TerritoryMomentum"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TerritoryMomentum_userId_territoryId_key" ON "TerritoryMomentum"("userId", "territoryId");

-- CreateIndex
CREATE INDEX "TerritoryAdoption_userId_idx" ON "TerritoryAdoption"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TerritoryAdoption_userId_territoryId_key" ON "TerritoryAdoption"("userId", "territoryId");

-- CreateIndex
CREATE INDEX "TerritoryFamiliarity_userId_idx" ON "TerritoryFamiliarity"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "TerritoryFamiliarity_userId_territoryId_key" ON "TerritoryFamiliarity"("userId", "territoryId");

-- CreateIndex
CREATE INDEX "UserTerritoryAffinity_userId_idx" ON "UserTerritoryAffinity"("userId");

-- CreateIndex
CREATE INDEX "UserTerritoryAffinity_territoryId_idx" ON "UserTerritoryAffinity"("territoryId");

-- CreateIndex
CREATE UNIQUE INDEX "UserTerritoryAffinity_userId_territoryId_key" ON "UserTerritoryAffinity"("userId", "territoryId");

-- CreateIndex
CREATE INDEX "UserTerritoryAffinitySnapshot_userId_idx" ON "UserTerritoryAffinitySnapshot"("userId");

-- CreateIndex
CREATE INDEX "UserTerritoryAffinitySnapshot_territoryId_idx" ON "UserTerritoryAffinitySnapshot"("territoryId");

-- CreateIndex
CREATE INDEX "UserTerritoryAffinitySnapshot_timestamp_idx" ON "UserTerritoryAffinitySnapshot"("timestamp");

-- CreateIndex
CREATE UNIQUE INDEX "UserBanditState_userId_key" ON "UserBanditState"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "BanditDecision_decisionId_key" ON "BanditDecision"("decisionId");

-- CreateIndex
CREATE INDEX "BanditDecision_userId_idx" ON "BanditDecision"("userId");

-- CreateIndex
CREATE INDEX "BanditDecision_timestamp_idx" ON "BanditDecision"("timestamp");

-- CreateIndex
CREATE INDEX "BanditDecision_decisionId_idx" ON "BanditDecision"("decisionId");

-- CreateIndex
CREATE INDEX "UserTerritoryRelationship_userId_idx" ON "UserTerritoryRelationship"("userId");

-- CreateIndex
CREATE INDEX "UserTerritoryRelationship_territoryId_idx" ON "UserTerritoryRelationship"("territoryId");

-- CreateIndex
CREATE UNIQUE INDEX "UserTerritoryRelationship_userId_territoryId_key" ON "UserTerritoryRelationship"("userId", "territoryId");

-- CreateIndex
CREATE INDEX "UserGenreRelationshipState_userId_idx" ON "UserGenreRelationshipState"("userId");

-- CreateIndex
CREATE INDEX "UserGenreRelationshipState_genre_idx" ON "UserGenreRelationshipState"("genre");

-- CreateIndex
CREATE UNIQUE INDEX "UserGenreRelationshipState_userId_genre_key" ON "UserGenreRelationshipState"("userId", "genre");

-- CreateIndex
CREATE INDEX "UserTerritoryRelationshipSnapshot_userId_idx" ON "UserTerritoryRelationshipSnapshot"("userId");

-- CreateIndex
CREATE INDEX "UserTerritoryRelationshipSnapshot_territoryId_idx" ON "UserTerritoryRelationshipSnapshot"("territoryId");

-- CreateIndex
CREATE INDEX "UserTerritoryRelationshipSnapshot_timestamp_idx" ON "UserTerritoryRelationshipSnapshot"("timestamp");

-- CreateIndex
CREATE INDEX "RelationshipTransition_userId_idx" ON "RelationshipTransition"("userId");

-- CreateIndex
CREATE INDEX "RelationshipTransition_territoryId_idx" ON "RelationshipTransition"("territoryId");

-- CreateIndex
CREATE INDEX "RelationshipTransition_timestamp_idx" ON "RelationshipTransition"("timestamp");

-- CreateIndex
CREATE INDEX "RelationshipExplanation_userId_idx" ON "RelationshipExplanation"("userId");

-- CreateIndex
CREATE INDEX "RelationshipExplanation_territoryId_idx" ON "RelationshipExplanation"("territoryId");

-- CreateIndex
CREATE UNIQUE INDEX "RelationshipExplanation_userId_territoryId_key" ON "RelationshipExplanation"("userId", "territoryId");

-- CreateIndex
CREATE INDEX "UserTerritoryIntervention_userId_idx" ON "UserTerritoryIntervention"("userId");

-- CreateIndex
CREATE INDEX "UserTerritoryIntervention_territoryId_idx" ON "UserTerritoryIntervention"("territoryId");

-- CreateIndex
CREATE UNIQUE INDEX "UserTerritoryIntervention_userId_territoryId_key" ON "UserTerritoryIntervention"("userId", "territoryId");

-- CreateIndex
CREATE INDEX "InterventionScoreBreakdown_userId_idx" ON "InterventionScoreBreakdown"("userId");

-- CreateIndex
CREATE INDEX "InterventionScoreBreakdown_territoryId_idx" ON "InterventionScoreBreakdown"("territoryId");

-- CreateIndex
CREATE UNIQUE INDEX "InterventionScoreBreakdown_userId_territoryId_key" ON "InterventionScoreBreakdown"("userId", "territoryId");

-- CreateIndex
CREATE INDEX "InterventionExplanation_userId_idx" ON "InterventionExplanation"("userId");

-- CreateIndex
CREATE INDEX "InterventionExplanation_territoryId_idx" ON "InterventionExplanation"("territoryId");

-- CreateIndex
CREATE UNIQUE INDEX "InterventionExplanation_userId_territoryId_key" ON "InterventionExplanation"("userId", "territoryId");

-- CreateIndex
CREATE INDEX "InterventionOutcome_userId_idx" ON "InterventionOutcome"("userId");

-- CreateIndex
CREATE INDEX "InterventionOutcome_territoryId_idx" ON "InterventionOutcome"("territoryId");

-- CreateIndex
CREATE INDEX "UserTrackMemory_userId_idx" ON "UserTrackMemory"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserTrackMemory_userId_trackId_key" ON "UserTrackMemory"("userId", "trackId");

-- CreateIndex
CREATE INDEX "UserArtistMemory_userId_idx" ON "UserArtistMemory"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "UserArtistMemory_userId_artistId_key" ON "UserArtistMemory"("userId", "artistId");

-- CreateIndex
CREATE INDEX "UserTerritoryMemory_userId_idx" ON "UserTerritoryMemory"("userId");

-- CreateIndex
CREATE INDEX "UserTerritoryMemory_territoryId_idx" ON "UserTerritoryMemory"("territoryId");

-- CreateIndex
CREATE UNIQUE INDEX "UserTerritoryMemory_userId_territoryId_key" ON "UserTerritoryMemory"("userId", "territoryId");

-- CreateIndex
CREATE INDEX "UserListeningEvent_userId_idx" ON "UserListeningEvent"("userId");

-- CreateIndex
CREATE INDEX "UserListeningEvent_territoryId_idx" ON "UserListeningEvent"("territoryId");

-- CreateIndex
CREATE INDEX "UserListeningEvent_timestamp_idx" ON "UserListeningEvent"("timestamp");

-- CreateIndex
CREATE INDEX "UserTerritoryCultivation_userId_idx" ON "UserTerritoryCultivation"("userId");

-- CreateIndex
CREATE INDEX "UserTerritoryCultivation_territoryId_idx" ON "UserTerritoryCultivation"("territoryId");

-- CreateIndex
CREATE UNIQUE INDEX "UserTerritoryCultivation_userId_territoryId_key" ON "UserTerritoryCultivation"("userId", "territoryId");

-- CreateIndex
CREATE INDEX "LongitudinalIntervention_userId_idx" ON "LongitudinalIntervention"("userId");

-- CreateIndex
CREATE INDEX "LongitudinalIntervention_targetTerritoryId_idx" ON "LongitudinalIntervention"("targetTerritoryId");

-- CreateIndex
CREATE INDEX "LongitudinalIntervention_state_idx" ON "LongitudinalIntervention"("state");

-- CreateIndex
CREATE INDEX "OutcomeEvent_interventionId_idx" ON "OutcomeEvent"("interventionId");

-- CreateIndex
CREATE UNIQUE INDEX "LOFLAttribution_interventionId_key" ON "LOFLAttribution"("interventionId");

-- CreateIndex
CREATE UNIQUE INDEX "GlobalPathwayTemplate_sourceTerritory_targetTerritory_key" ON "GlobalPathwayTemplate"("sourceTerritory", "targetTerritory");

-- AddForeignKey
ALTER TABLE "RecommendationMemory" ADD CONSTRAINT "RecommendationMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationRun" ADD CONSTRAINT "RecommendationRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RecommendationServeLog" ADD CONSTRAINT "RecommendationServeLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerritoryRejection" ADD CONSTRAINT "TerritoryRejection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyInteractionEvent" ADD CONSTRAINT "AgencyInteractionEvent_durabilityOutcomeId_fkey" FOREIGN KEY ("durabilityOutcomeId") REFERENCES "DurabilityOutcome"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgencyInteractionEvent" ADD CONSTRAINT "AgencyInteractionEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DurabilityOutcome" ADD CONSTRAINT "DurabilityOutcome_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TesSnapshot" ADD CONSTRAINT "TesSnapshot_previousSnapshotId_fkey" FOREIGN KEY ("previousSnapshotId") REFERENCES "TesSnapshot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TesSnapshot" ADD CONSTRAINT "TesSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DurabilityEvent" ADD CONSTRAINT "DurabilityEvent_tesSnapshotId_fkey" FOREIGN KEY ("tesSnapshotId") REFERENCES "TesSnapshot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DurabilityEvent" ADD CONSTRAINT "DurabilityEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExploredArtist" ADD CONSTRAINT "ExploredArtist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("spotifyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArtistEmbedding" ADD CONSTRAINT "ArtistEmbedding_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerritoryMembership" ADD CONSTRAINT "TerritoryMembership_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerritoryMembership" ADD CONSTRAINT "TerritoryMembership_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "Territory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerritoryBridge" ADD CONSTRAINT "TerritoryBridge_territoryBId_fkey" FOREIGN KEY ("territoryBId") REFERENCES "Territory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerritoryBridge" ADD CONSTRAINT "TerritoryBridge_territoryAId_fkey" FOREIGN KEY ("territoryAId") REFERENCES "Territory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerritoryBridge" ADD CONSTRAINT "TerritoryBridge_artistId_fkey" FOREIGN KEY ("artistId") REFERENCES "Artist"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerritorySimilarity" ADD CONSTRAINT "TerritorySimilarity_territoryBId_fkey" FOREIGN KEY ("territoryBId") REFERENCES "Territory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerritorySimilarity" ADD CONSTRAINT "TerritorySimilarity_territoryAId_fkey" FOREIGN KEY ("territoryAId") REFERENCES "Territory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerritorySnapshot" ADD CONSTRAINT "TerritorySnapshot_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "Territory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTerritoryProfile" ADD CONSTRAINT "UserTerritoryProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("spotifyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTerritorySnapshot" ADD CONSTRAINT "UserTerritorySnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("spotifyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerritoryMomentum" ADD CONSTRAINT "TerritoryMomentum_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("spotifyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerritoryAdoption" ADD CONSTRAINT "TerritoryAdoption_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("spotifyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TerritoryFamiliarity" ADD CONSTRAINT "TerritoryFamiliarity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("spotifyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTerritoryAffinity" ADD CONSTRAINT "UserTerritoryAffinity_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "Territory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTerritoryAffinity" ADD CONSTRAINT "UserTerritoryAffinity_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("spotifyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTerritoryAffinitySnapshot" ADD CONSTRAINT "UserTerritoryAffinitySnapshot_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "Territory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTerritoryAffinitySnapshot" ADD CONSTRAINT "UserTerritoryAffinitySnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("spotifyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserBanditState" ADD CONSTRAINT "UserBanditState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("spotifyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BanditDecision" ADD CONSTRAINT "BanditDecision_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("spotifyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTerritoryRelationship" ADD CONSTRAINT "UserTerritoryRelationship_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "Territory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTerritoryRelationship" ADD CONSTRAINT "UserTerritoryRelationship_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("spotifyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserGenreRelationshipState" ADD CONSTRAINT "UserGenreRelationshipState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("spotifyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTerritoryRelationshipSnapshot" ADD CONSTRAINT "UserTerritoryRelationshipSnapshot_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "Territory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTerritoryRelationshipSnapshot" ADD CONSTRAINT "UserTerritoryRelationshipSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("spotifyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipTransition" ADD CONSTRAINT "RelationshipTransition_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "Territory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipTransition" ADD CONSTRAINT "RelationshipTransition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("spotifyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipExplanation" ADD CONSTRAINT "RelationshipExplanation_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "Territory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RelationshipExplanation" ADD CONSTRAINT "RelationshipExplanation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("spotifyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTerritoryIntervention" ADD CONSTRAINT "UserTerritoryIntervention_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "Territory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTerritoryIntervention" ADD CONSTRAINT "UserTerritoryIntervention_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("spotifyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterventionScoreBreakdown" ADD CONSTRAINT "InterventionScoreBreakdown_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "Territory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterventionScoreBreakdown" ADD CONSTRAINT "InterventionScoreBreakdown_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("spotifyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterventionExplanation" ADD CONSTRAINT "InterventionExplanation_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "Territory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterventionExplanation" ADD CONSTRAINT "InterventionExplanation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("spotifyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterventionOutcome" ADD CONSTRAINT "InterventionOutcome_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "Territory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InterventionOutcome" ADD CONSTRAINT "InterventionOutcome_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("spotifyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTrackMemory" ADD CONSTRAINT "UserTrackMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("spotifyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserArtistMemory" ADD CONSTRAINT "UserArtistMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("spotifyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTerritoryMemory" ADD CONSTRAINT "UserTerritoryMemory_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "Territory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTerritoryMemory" ADD CONSTRAINT "UserTerritoryMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("spotifyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserListeningEvent" ADD CONSTRAINT "UserListeningEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("spotifyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTerritoryCultivation" ADD CONSTRAINT "UserTerritoryCultivation_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "Territory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserTerritoryCultivation" ADD CONSTRAINT "UserTerritoryCultivation_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("spotifyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LongitudinalIntervention" ADD CONSTRAINT "LongitudinalIntervention_targetTerritoryId_fkey" FOREIGN KEY ("targetTerritoryId") REFERENCES "Territory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LongitudinalIntervention" ADD CONSTRAINT "LongitudinalIntervention_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("spotifyId") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OutcomeEvent" ADD CONSTRAINT "OutcomeEvent_interventionId_fkey" FOREIGN KEY ("interventionId") REFERENCES "LongitudinalIntervention"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LOFLAttribution" ADD CONSTRAINT "LOFLAttribution_interventionId_fkey" FOREIGN KEY ("interventionId") REFERENCES "LongitudinalIntervention"("id") ON DELETE CASCADE ON UPDATE CASCADE;
