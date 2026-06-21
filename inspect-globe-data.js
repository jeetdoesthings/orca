const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.findFirst();
  if (!user || !user.globeData) {
    console.log('No user or globeData found.');
    return;
  }

  const parsed = JSON.parse(user.globeData);
  const nodes = parsed.nodes || [];
  console.log('--- EXPLORED NODES ---');
  console.log(`Total nodes: ${nodes.length}`);
  console.log('Sample nodes:');
  console.log(nodes.slice(0, 5).map(n => ({ id: n.id, name: n.name })));
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
