import { PrismaClient, Role } from '@prisma/client';

/**
 * Idempotent seed — safe to run repeatedly (uses upsert).
 * Run with: pnpm db:seed
 */
const prisma = new PrismaClient();

async function main(): Promise<void> {
  const demoUser = await prisma.user.upsert({
    where: { phone: '+971500000001' },
    update: {},
    create: {
      phone: '+971500000001',
      name: 'Demo User',
      roles: [Role.USER],
    },
  });

  const admin = await prisma.user.upsert({
    where: { phone: '+971500000000' },
    update: {},
    create: {
      phone: '+971500000000',
      name: 'Demo Admin',
      roles: [Role.USER, Role.ADMIN],
    },
  });

  console.log(`Seeded users: ${demoUser.name} (${demoUser.id}), ${admin.name} (${admin.id})`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
