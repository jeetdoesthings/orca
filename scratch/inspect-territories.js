const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const latest = await prisma.territory.findFirst({ orderBy: { version: 'desc' }, select: { version: true } });
  if (!latest) return console.log('No territories generated.');
  const version = latest.version;
  
  const territories = await prisma.territory.findMany({
    where: { version },
    include: {
      memberships: {
        include: { artist: true },
        orderBy: { membershipStrength: 'desc' }
      }
    }
  });

  console.log('=== TERRITORIES SUMMARY ===');
  for (const t of territories) {
    const meta = JSON.parse(t.metadata || '{}');
    console.log('\nID: ' + t.id);
    console.log('Name: "' + meta.displayName + '"');
    console.log('Size (Clustered): ' + t.size);
    console.log('Cohesion: ' + t.cohesion.toFixed(4));
    console.log('Density: ' + t.density.toFixed(2));
    console.log('Top 5 Genres: ' + JSON.stringify(meta.topGenres));
    console.log('Top 3 Traits: ' + JSON.stringify(meta.topTraits.slice(0, 3).map(tr => tr.traitId)));
    console.log('Top 5 Artists by Membership Strength:');
    t.memberships.slice(0, 5).forEach(m => {
      console.log('  - ' + m.artist.displayName + ' (strength: ' + m.membershipStrength.toFixed(4) + ', role: ' + m.role + ')');
    });
  }

  const bridges = await prisma.territoryBridge.findMany({
    where: {
      territoryAId: { startsWith: 'Territory_v' + version }
    },
    include: { artist: true },
    orderBy: { bridgeStrength: 'desc' },
    take: 5
  });

  console.log('\n=== TOP 5 BRIDGE ARTISTS ===');
  for (const b of bridges) {
    console.log('- Artist: ' + b.artist.displayName + ' | Bridge: ' + b.territoryAId + ' <-> ' + b.territoryBId + ' | Strength: ' + b.bridgeStrength.toFixed(4));
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
