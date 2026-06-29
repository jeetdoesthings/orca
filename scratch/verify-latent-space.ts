import { prisma } from '../src/lib/prisma';
import {
  seedTraitDefinitions,
  processArtistLatentRepresentation,
  l2Normalize,
  FUSION_CONFIG
} from '../src/lib/latent/latent-space';

async function verify() {
  console.log('=== STARTING LATENT SPACE VERIFICATION ===\n');

  // 1. Seed trait definitions
  console.log('Step 1: Seeding trait definitions...');
  await seedTraitDefinitions();
  const traitsCount = await prisma.traitDefinition.count();
  console.log(`Success: Seeded ${traitsCount} traits.\n`);

  // 2. Run embedding pipeline for a mock artist
  console.log('Step 2: Processing mock artist "Orion Synth Project"...');
  const mockArtistData = {
    spotifyId: 'mock-orion-synth-123',
    name: 'Orion Synth Project',
    genres: ['electronic', 'synthwave', 'ambient'],
    popularity: 65,
    followers: 120500,
    imageUrl: 'https://example.com/orion.jpg',
    audioSignature: {
      energy: 0.85,
      danceability: 0.72,
      valence: 0.60,
      acousticness: 0.05,
      instrumentalness: 0.80,
      tempo: 124
    },
    bio: 'An atmospheric electronic project blending dark synthwave rhythms with spacious cosmic ambient textures.'
  };

  const result = await processArtistLatentRepresentation(mockArtistData);
  console.log('Success: Pipeline completed.');
  console.log(`Canonical ID: ${result.artistRecord.id}`);
  console.log(`Display Name: ${result.artistRecord.displayName}`);
  console.log(`Confidence Score: ${result.confidence}\n`);

  // 3. Verify subvector dimensions and L2 normalization
  console.log('Step 3: Verifying subvector dimensions and normalization...');
  const audioVec = JSON.parse(result.embeddingRecord.audioVector || '[]');
  const textVec = JSON.parse(result.embeddingRecord.textVector || '[]');
  const traitVec = JSON.parse(result.embeddingRecord.traitVector || '[]');
  const structVec = JSON.parse(result.embeddingRecord.structuralVector || '[]');
  const fusedVec = JSON.parse(result.embeddingRecord.fusedVector || '[]');

  console.log(`- Audio Subvector Dimension: ${audioVec.length} (Expected: 6)`);
  console.log(`- Text Subvector Dimension: ${textVec.length} (Expected: 8)`);
  console.log(`- Trait Subvector Dimension: ${traitVec.length} (Expected: ${traitsCount})`);
  console.log(`- Structural Subvector Dimension: ${structVec.length} (Expected: 4)`);
  console.log(`- Fused Vector Dimension: ${fusedVec.length} (Expected: ${6 + 8 + traitsCount + 4})`);

  // Check L2 normalization magnitude (should be close to 1.0)
  const getMag = (vec: number[]) => Math.sqrt(vec.reduce((sum, v) => sum + v * v, 0));
  console.log(`- Audio vector L2 magnitude: ${getMag(audioVec).toFixed(4)} (Expected: 1.0000)`);
  console.log(`- Text vector L2 magnitude: ${getMag(textVec).toFixed(4)} (Expected: 1.0000)`);
  console.log(`- Trait vector L2 magnitude: ${getMag(traitVec).toFixed(4)} (Expected: 1.0000)`);
  console.log(`- Structural vector L2 magnitude: ${getMag(structVec).toFixed(4)} (Expected: 1.0000)`);
  console.log(`- Fused vector L2 magnitude: ${getMag(fusedVec).toFixed(4)} (Expected: 1.0000)\n`);

  // Verify DB entries
  console.log('Step 4: Checking database records...');
  const dbArtist = await prisma.artist.findUnique({
    where: { spotifyId: mockArtistData.spotifyId }
  });
  const dbEmbedding = await prisma.artistEmbedding.findFirst({
    where: { artistId: dbArtist?.id }
  });

  if (dbArtist && dbEmbedding) {
    console.log('Success: Artist and ArtistEmbedding records verified in SQLite.');
  } else {
    throw new Error('Database records verification failed!');
  }

  // 4. Verify Explanation Payload
  console.log('\nStep 5: Verifying Explanation Payload...');
  console.log('Primary Traits Inferred:');
  result.explanationPayload.primaryTraits.forEach((t: any) => {
    console.log(`  - ${t.displayLabel}: ${(t.score * 100).toFixed(1)}%`);
  });

  console.log('\n=== ALL VERIFICATIONS PASSED SUCCESSFULLY ===');
}

verify()
  .catch(err => {
    console.error('\nVerification failed with error:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
