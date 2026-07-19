import {
  PrismaClient,
  RentalCarCategory,
  Role,
  StayBookingStatus,
  StayBookingType,
  StayCategoryType,
} from '@prisma/client';

/**
 * Idempotent seed — safe to run repeatedly (uses upsert / unique slugs).
 * Run with: npm run db:seed
 *
 * Stay fixtures mirror the Flutter app's elkstay_dummy_data.dart so the
 * mobile app renders identically against the real API.
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

// ─── ELK Stay fixtures (mirror elkstay_dummy_data.dart) ─────────────────────

const ROOM_OPTIONS = [
  { kind: 'Single Sharing', subtitle: 'Private room · attached bath', pricePerMonth: 15000 },
  { kind: 'Double Sharing', subtitle: '2 beds · shared bath', pricePerMonth: 11000 },
  { kind: 'Triple Sharing', subtitle: '3 beds · economical', pricePerMonth: 8500 },
];

interface StaySeed {
  slug: string;
  name: string;
  categoryType: StayCategoryType;
  badge: string;
  roomType: string;
  location: string;
  fullAddress: string;
  distanceKm: number;
  pricePerMonth: number;
  rating: number;
  gradientStart: bigint;
  gradientEnd: bigint;
  amenities: { iconKey: string; label: string }[];
  description: string;
}

const STAYS: StaySeed[] = [
  {
    slug: 'maple-nest',
    name: 'Maple Nest Residency',
    categoryType: StayCategoryType.PG_STAY,
    badge: "Women's PG",
    roomType: 'Single room',
    location: 'Koramangala',
    fullAddress: '5th Block, Koramangala · 1.2 km away',
    distanceKm: 1.2,
    pricePerMonth: 11500,
    rating: 4.8,
    gradientStart: 0xff1c5044n,
    gradientEnd: 0xff3a7261n,
    amenities: [
      { iconKey: 'wifi', label: '100 Mbps Wi-Fi' },
      { iconKey: 'meals', label: '3 meals / day' },
      { iconKey: 'laundry', label: 'Laundry' },
      { iconKey: 'ac', label: 'AC rooms' },
    ],
    description:
      'A bright, women-only PG five minutes from the metro. Fully furnished single rooms, home-style meals, biometric entry and a resident warden on site. Refundable deposit of two months.',
  },
  {
    slug: 'cedar-house',
    name: 'Cedar House',
    categoryType: StayCategoryType.MENS_HOSTEL,
    badge: "Men's Hostel",
    roomType: 'Twin room',
    location: 'HSR Layout',
    fullAddress: 'Sector 2, HSR Layout · 2.5 km away',
    distanceKm: 2.5,
    pricePerMonth: 8900,
    rating: 4.6,
    gradientStart: 0xff2c6e5cn,
    gradientEnd: 0xff184c40n,
    amenities: [
      { iconKey: 'wifi', label: 'Wi-Fi included' },
      { iconKey: 'meals', label: 'Meals available' },
      { iconKey: 'ac', label: 'AC rooms' },
      { iconKey: 'security', label: 'CCTV security' },
    ],
    description:
      "A well-maintained men's hostel with modern facilities in HSR Layout. Twin-sharing rooms with individual lockers, high-speed Wi-Fi and in-house cafeteria. Security guard 24/7.",
  },
  {
    slug: 'willow-court',
    name: 'Willow Court',
    categoryType: StayCategoryType.WOMENS_HOSTEL,
    badge: "Women's Hostel",
    roomType: 'Twin room',
    location: 'Ejipura',
    fullAddress: 'Ejipura Main Road · 2.0 km away',
    distanceKm: 2.0,
    pricePerMonth: 9200,
    rating: 4.7,
    gradientStart: 0xffc97d2an,
    gradientEnd: 0xffa85f16n,
    amenities: [
      { iconKey: 'wifi', label: 'Wi-Fi' },
      { iconKey: 'meals', label: 'Meals included' },
      { iconKey: 'laundry', label: 'Laundry' },
      { iconKey: 'security', label: 'CCTV security' },
    ],
    description:
      "Safe and comfortable women's hostel in Ejipura with 24/7 security. Twin rooms available with meals included in the rent. Walking distance from multiple IT parks.",
  },
  {
    slug: 'pine-loft',
    name: 'Pine Loft PG',
    categoryType: StayCategoryType.MENS_HOSTEL,
    badge: "Men's PG",
    roomType: 'Single room',
    location: 'Indiranagar',
    fullAddress: '100 Feet Road, Indiranagar · 3.1 km away',
    distanceKm: 3.1,
    pricePerMonth: 7500,
    rating: 4.4,
    gradientStart: 0xff1a5547n,
    gradientEnd: 0xff0e3a30n,
    amenities: [
      { iconKey: 'wifi', label: 'Wi-Fi' },
      { iconKey: 'laundry', label: 'Laundry' },
      { iconKey: 'backup', label: 'Power backup' },
      { iconKey: 'security', label: 'Biometric entry' },
    ],
    description:
      "Budget-friendly men's PG on 100 Feet Road, Indiranagar. Single occupancy rooms with basic amenities — perfect for working professionals on a budget.",
  },
  {
    slug: 'lavender-villa',
    name: 'Lavender Villa',
    categoryType: StayCategoryType.WOMENS_HOSTEL,
    badge: "Women's PG",
    roomType: 'Single room',
    location: 'Bellandur',
    fullAddress: 'Sarjapura Road, Bellandur · 4.2 km away',
    distanceKm: 4.2,
    pricePerMonth: 10000,
    rating: 4.5,
    gradientStart: 0xffc97d2an,
    gradientEnd: 0xffa85f16n,
    amenities: [
      { iconKey: 'wifi', label: '50 Mbps Wi-Fi' },
      { iconKey: 'meals', label: '2 meals / day' },
      { iconKey: 'ac', label: 'AC available' },
      { iconKey: 'parking', label: 'Two-wheeler parking' },
    ],
    description:
      "A thoughtfully designed women's PG near tech parks on Sarjapura Road. Clean rooms, nutritious meals and a friendly warden on site.",
  },
  {
    slug: 'birch-homestay',
    name: 'Birch Homestay',
    categoryType: StayCategoryType.HOMESTAY,
    badge: 'Homestay',
    roomType: 'Private room',
    location: 'Indiranagar',
    fullAddress: 'CMH Road, Indiranagar · 3.5 km away',
    distanceKm: 3.5,
    pricePerMonth: 15000,
    rating: 4.9,
    gradientStart: 0xff3a6b5en,
    gradientEnd: 0xff244c42n,
    amenities: [
      { iconKey: 'wifi', label: 'Broadband Wi-Fi' },
      { iconKey: 'meals', label: 'Home-cooked meals' },
      { iconKey: 'ac', label: 'AC room' },
      { iconKey: 'parking', label: 'Parking' },
    ],
    description:
      'A private room in a family home in the heart of Indiranagar. Enjoy home-cooked meals, a peaceful atmosphere and easy access to the metro, cafes and markets.',
  },
];

async function seedStays(providerId: string): Promise<void> {
  for (const s of STAYS) {
    const { amenities, ...stay } = s;
    await prisma.stay.upsert({
      where: { slug: s.slug },
      update: {},
      create: {
        ...stay,
        providerId,
        isVerified: true,
        amenities: {
          create: amenities.map((a, i) => ({ ...a, sortOrder: i })),
        },
        roomOptions: {
          create: ROOM_OPTIONS.map((r, i) => ({ ...r, sortOrder: i })),
        },
      },
    });
  }
}

async function seedStayCoupon(): Promise<void> {
  await prisma.stayCoupon.upsert({
    where: { code: 'ELKNEW' },
    update: {},
    create: { code: 'ELKNEW', discountAmount: 500, isActive: true },
  });
}

async function seedStayBookings(userId: string): Promise<void> {
  // mirror the two fixture bookings: one confirmed stay + one visit request
  const maple = await prisma.stay.findUnique({
    where: { slug: 'maple-nest' },
    include: { roomOptions: { orderBy: { sortOrder: 'asc' } } },
  });
  const cedar = await prisma.stay.findUnique({ where: { slug: 'cedar-house' } });
  if (!maple || !cedar) return;

  const single = maple.roomOptions[0];
  await prisma.stayBooking.upsert({
    where: { code: 'ELK-SEED1' },
    update: {},
    create: {
      code: 'ELK-SEED1',
      userId,
      stayId: maple.id,
      roomOptionId: single?.id,
      type: StayBookingType.STAY,
      status: StayBookingStatus.CONFIRMED,
      moveInDate: new Date('2026-06-12'),
      durationMonths: 6,
      rentPerMonth: 11500,
      depositAmount: 11500,
      serviceFee: 499,
      discountAmount: 0,
      totalPaid: 23499,
      paymentMethod: 'upi',
      paymentRef: 'PAY-SEED1',
      paidAt: new Date('2026-06-01T10:00:00Z'),
      nextDueDate: new Date('2026-07-01'),
    },
  });

  await prisma.stayBooking.upsert({
    where: { code: 'ELK-SEED2' },
    update: {},
    create: {
      code: 'ELK-SEED2',
      userId,
      stayId: cedar.id,
      type: StayBookingType.VISIT,
      status: StayBookingStatus.VISIT_BOOKED,
      visitAt: new Date('2026-06-10T17:00:00+04:00'),
    },
  });
}

// ─── Car Rental fixtures (mirror rental_screen.dart / rental_booking_flow.dart) ─

const RENTAL_CARS: {
  slug: string;
  name: string;
  category: RentalCarCategory;
  iconKey: string;
  seats: number;
  transmission: string;
  fuel: string;
  rating: number;
  pricePerDay: number;
  badge: string | null;
}[] = [
  // prettier-ignore
  { slug: 'toyota-camry', name: 'Toyota Camry', category: RentalCarCategory.SEDAN, iconKey: 'rental_sedan', seats: 5, transmission: 'Automatic', fuel: 'Petrol', rating: 4.8, pricePerDay: 199, badge: 'BEST DEAL' },
  // prettier-ignore
  { slug: 'honda-civic', name: 'Honda Civic', category: RentalCarCategory.SEDAN, iconKey: 'rental_sedan', seats: 5, transmission: 'Automatic', fuel: 'Petrol', rating: 4.7, pricePerDay: 179, badge: null },
  // prettier-ignore
  { slug: 'nissan-patrol', name: 'Nissan Patrol', category: RentalCarCategory.SUV, iconKey: 'rental_suv', seats: 7, transmission: 'Automatic', fuel: 'Petrol', rating: 4.7, pricePerDay: 349, badge: null },
  // prettier-ignore
  { slug: 'hyundai-tucson', name: 'Hyundai Tucson', category: RentalCarCategory.SUV, iconKey: 'rental_suv', seats: 5, transmission: 'Automatic', fuel: 'Petrol', rating: 4.6, pricePerDay: 289, badge: null },
  // prettier-ignore
  { slug: 'mercedes-e-class', name: 'Mercedes E-Class', category: RentalCarCategory.LUXURY, iconKey: 'rental_luxury', seats: 4, transmission: 'Automatic', fuel: 'Petrol', rating: 4.9, pricePerDay: 599, badge: 'PREMIUM' },
  // prettier-ignore
  { slug: 'bmw-5-series', name: 'BMW 5 Series', category: RentalCarCategory.LUXURY, iconKey: 'rental_luxury', seats: 5, transmission: 'Automatic', fuel: 'Petrol', rating: 4.8, pricePerDay: 549, badge: null },
];

const RENTAL_BRANCHES = [
  // prettier-ignore
  { slug: 'corniche', name: 'Abu Dhabi Corniche Branch', address: 'Corniche Road, Abu Dhabi', distanceLabel: '1.2 km' },
  {
    slug: 'yas',
    name: 'Yas Island Branch',
    address: 'Yas Mall, Abu Dhabi',
    distanceLabel: '18 km',
  },
  // prettier-ignore
  { slug: 'airport', name: 'Abu Dhabi Airport Branch', address: 'Terminal A Arrivals', distanceLabel: '27 km' },
];

const RENTAL_EXTRAS = [
  // prettier-ignore
  { key: 'protection', name: 'Full Protection Plan', description: 'Zero excess, drive worry-free', pricePerDay: 30 },
  // prettier-ignore
  { key: 'driver', name: 'Extra Driver', description: 'Add a second registered driver', pricePerDay: 20 },
  { key: 'seat', name: 'Child Seat', description: 'Safety seat for ages 1–4', pricePerDay: 15 },
  {
    key: 'wifi',
    name: 'Portable Wi-Fi',
    description: 'Stay connected on the road',
    pricePerDay: 10,
  },
];

async function seedRentals(providerId: string): Promise<void> {
  for (const car of RENTAL_CARS) {
    await prisma.rentalCar.upsert({
      where: { slug: car.slug },
      update: {},
      create: { ...car, providerId },
    });
  }
  for (const branch of RENTAL_BRANCHES) {
    await prisma.rentalBranch.upsert({
      where: { slug: branch.slug },
      update: {},
      create: branch,
    });
  }
  for (const extra of RENTAL_EXTRAS) {
    await prisma.rentalExtra.upsert({
      where: { key: extra.key },
      update: {},
      create: extra,
    });
  }
  await prisma.rentalPromo.upsert({
    where: { code: 'ELK10' },
    update: {},
    create: { code: 'ELK10', percent: 10, isActive: true },
  });
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

  const provider = await prisma.user.upsert({
    where: { phone: '+971500000002' },
    update: {},
    create: {
      phone: '+971500000002',
      name: 'Demo Provider',
      roles: [Role.USER, Role.PROVIDER],
    },
  });

  const serviceCount = await seedCatalog();

  await seedStays(provider.id);
  await seedStayCoupon();
  await seedStayBookings(demoUser.id);
  await seedRentals(provider.id);

  const stays = await prisma.stay.count();
  const stayBookings = await prisma.stayBooking.count();
  const cars = await prisma.rentalCar.count();

  console.log(`Seeded users: ${demoUser.name} (${demoUser.id}), ${admin.name} (${admin.id})`);
  console.log(`Seeded catalog: ${catalog.length} categories, ${serviceCount} services`);
  console.log(
    `Seeded: ${stays} stays, ${stayBookings} stay bookings, ${cars} rental cars, coupons ELKNEW/ELK10`,
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
