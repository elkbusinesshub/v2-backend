import { PrismaClient, Role } from '@prisma/client';

/**
 * Idempotent seed — safe to run repeatedly (uses upsert).
 * Run with: npm run db:seed
 */
const prisma = new PrismaClient();

/** Home-services catalogue (Services tab). Taxi/Stay/Rental/Porter are separate modules. */
const catalog = [
  {
    slug: 'cleaning',
    name: 'Cleaning',
    icon: '🧹',
    colorHex: 0xfffef3c7,
    providerName: 'Royal Shine Cleaning Co.',
    services: [
      { slug: 'home_cleaning', name: 'Home Cleaning', icon: '🏠', price: 85, duration: '2-3 hrs' },
      {
        slug: 'deep_cleaning',
        name: 'Deep Cleaning',
        icon: '✨',
        price: 149,
        duration: '3-4 hrs',
        badge: 'BEST DEAL',
      },
      {
        slug: 'furniture_clean',
        name: 'Furniture Clean',
        icon: '🛋️',
        price: 120,
        duration: '2-3 hrs',
      },
    ],
  },
  {
    slug: 'laundry',
    name: 'Laundry',
    icon: '👕',
    colorHex: 0xffe0f7f5,
    providerName: 'FreshFold Laundry',
    services: [
      { slug: 'wash_fold', name: 'Wash & Fold', icon: '🧺', price: 45, duration: '24 hrs' },
      { slug: 'dry_cleaning', name: 'Dry Cleaning', icon: '👔', price: 60, duration: '48 hrs' },
      { slug: 'ironing', name: 'Ironing', icon: '🔥', price: 35, duration: '24 hrs' },
    ],
  },
  {
    slug: 'ac_service',
    name: 'AC Service',
    icon: '❄️',
    colorHex: 0xffede9fe,
    providerName: 'CoolTech AC Experts',
    services: [
      { slug: 'ac_cleaning', name: 'AC Cleaning', icon: '🫧', price: 99, duration: '1-2 hrs' },
      { slug: 'ac_repair', name: 'AC Repair', icon: '🔧', price: 150, duration: '1-3 hrs' },
      { slug: 'ac_install', name: 'AC Install', icon: '⚙️', price: 299, duration: '2-4 hrs' },
    ],
  },
  {
    slug: 'repairing',
    name: 'Repairing',
    icon: '🔨',
    colorHex: 0xfffce7f3,
    providerName: 'FixPro Home Repairs',
    services: [
      { slug: 'electrical', name: 'Electrical', icon: '⚡', price: 89, duration: '1-2 hrs' },
      { slug: 'plumbing', name: 'Plumbing', icon: '🚿', price: 95, duration: '1-2 hrs' },
      { slug: 'handyman', name: 'Handyman', icon: '🛠️', price: 75, duration: '1-3 hrs' },
    ],
  },
];

async function seedCatalog(): Promise<number> {
  let count = 0;
  for (const cat of catalog) {
    const category = await prisma.serviceCategory.upsert({
      where: { slug: cat.slug },
      update: { name: cat.name, icon: cat.icon, colorHex: cat.colorHex },
      create: { slug: cat.slug, name: cat.name, icon: cat.icon, colorHex: cat.colorHex },
    });
    for (const svc of cat.services) {
      const data = {
        categoryId: category.id,
        name: svc.name,
        icon: svc.icon,
        badge: svc.badge ?? null,
        description: `Professional ${svc.name.toLowerCase()} service by vetted providers, using quality equipment and materials.`,
        price: svc.price,
        priceUnit: '/ session',
        durationLabel: svc.duration,
        teamSizeLabel: '2 People',
        included: ['Materials', 'Equipment', 'Service warranty'],
        providerName: cat.providerName,
        providerExperience: '12 years experience',
        rating: 4.8,
        reviewCount: 150,
        bookingsLabel: '1k+',
      };
      await prisma.service.upsert({
        where: { slug: svc.slug },
        update: data,
        create: { slug: svc.slug, ...data },
      });
      count += 1;
    }
  }
  return count;
}

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

  const serviceCount = await seedCatalog();

  console.log(`Seeded users: ${demoUser.name} (${demoUser.id}), ${admin.name} (${admin.id})`);
  console.log(`Seeded catalog: ${catalog.length} categories, ${serviceCount} services`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
