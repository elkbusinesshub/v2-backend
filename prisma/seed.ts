import {
  CleanPromoKind,
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

// ─── ELK Clean fixtures (mirror elkclean_data.dart) ──────────────────────────

const CLEAN_CATEGORIES = [
  // prettier-ignore
  { slug: 'cln', code: 'CLN', label: 'Home Cleaning', blurb: 'Standard, deep & move-out', iconKey: 'ic_home_clean', badge: null as string | null, star: false },
  // prettier-ignore
  { slug: 'deep', code: 'DCP', label: 'Deep Cleaning', blurb: 'Top-to-bottom detail clean', iconKey: 'ic_deep_clean', badge: '40% Off', star: false },
  // prettier-ignore
  { slug: 'tnk', code: 'TNK', label: 'Water Tank', blurb: 'Drain, scrub & disinfect', iconKey: 'ic_water_tank', badge: null, star: true },
  // prettier-ignore
  { slug: 'sof', code: 'SOF', label: 'Sofa & Upholstery', blurb: 'Shampoo & protect', iconKey: 'ic_sofa', badge: null, star: false },
  // prettier-ignore
  { slug: 'crp', code: 'CRP', label: 'Carpet & Rug', blurb: 'Steam deep clean', iconKey: 'ic_carpet', badge: null, star: false },
  // prettier-ignore
  { slug: 'kit', code: 'KIT', label: 'Kitchen Clean', blurb: 'Degrease & sanitise', iconKey: 'ic_kitchen', badge: null, star: false },
  // prettier-ignore
  { slug: 'bth', code: 'BTH', label: 'Bathroom Clean', blurb: 'Sanitise & descale', iconKey: 'ic_bath', badge: null, star: false },
  // prettier-ignore
  { slug: 'lndr', code: 'LND', label: 'Laundry & Iron', blurb: 'Wash, dry & press', iconKey: 'ic_laundry', badge: null, star: false },
];

interface CleanServiceSeed {
  code: string;
  name: string;
  description: string;
  price: number;
  durationLabel: string;
  tag?: string;
  checklist: string[];
  steps?: string[];
}

const CLEAN_SERVICES: Record<string, CleanServiceSeed[]> = {
  cln: [
    {
      code: 'CLN-01',
      name: 'Standard Home Cleaning',
      description: 'Dusting, mopping & surface wipe-down.',
      price: 79,
      durationLabel: '2–3 hrs',
      tag: 'Popular',
      checklist: [
        'Dust all surfaces & fittings',
        'Vacuum & mop floors',
        'Wipe doors, switches, skirting',
        'Empty bins & tidy',
      ],
    },
    {
      code: 'CLN-02',
      name: 'Deep Cleaning (Full Home)',
      description: 'Top-to-bottom detailed clean.',
      price: 199,
      durationLabel: 'Half day',
      checklist: [
        'Everything in standard clean',
        'Inside cabinets & appliances',
        'Descale taps & fittings',
        'Detail corners, vents & frames',
        'Sanitise high-touch points',
      ],
    },
    {
      code: 'CLN-03',
      name: 'Move-in / Move-out Clean',
      description: 'Handover-ready spotless finish.',
      price: 249,
      durationLabel: 'Half day',
      checklist: [
        'Full deep clean of empty home',
        'Inside all cupboards & drawers',
        'Mark & scuff removal',
        'Balcony & window tracks',
      ],
    },
  ],
  deep: [
    {
      code: 'DCP-01',
      name: 'Full Home Deep Clean',
      description: 'Top-to-bottom detail clean, inside & out.',
      price: 199,
      durationLabel: 'Half day',
      tag: 'Popular',
      checklist: [
        'Everything in standard clean',
        'Inside cabinets & appliances',
        'Descale taps & fittings',
        'Detail corners, vents & frames',
        'Sanitise high-touch points',
      ],
    },
    {
      code: 'DCP-02',
      name: 'Move-in / Move-out Clean',
      description: 'Handover-ready spotless finish.',
      price: 249,
      durationLabel: 'Half day',
      checklist: [
        'Full deep clean of empty home',
        'Inside all cupboards & drawers',
        'Mark & scuff removal',
        'Balcony & window tracks',
      ],
    },
  ],
  tnk: [
    {
      code: 'TNK-01',
      name: 'Water Tank Cleaning – up to 1000L',
      description: 'Drain, scrub, disinfect & refill.',
      price: 149,
      durationLabel: '60–90 min',
      tag: 'Featured',
      checklist: [
        'Full drain & sludge removal',
        'Manual scrub of walls & base',
        'Anti-bacterial disinfection',
        'Fresh water refill',
        'Cleanliness photo report',
      ],
      steps: ['Inspect', 'Drain', 'Scrub', 'Disinfect', 'Refill', 'Report'],
    },
    {
      code: 'TNK-02',
      name: 'Large / Underground Tank – 1000L+',
      description: 'For villas & buildings, per tank.',
      price: 299,
      durationLabel: '2–3 hrs',
      checklist: [
        'Confined-space trained crew',
        'Full sediment & sludge removal',
        'Pressure wash + disinfect',
        'Refill & chlorination test',
        'Hygiene certificate',
      ],
      steps: ['Inspect', 'Drain', 'Pressure wash', 'Disinfect', 'Refill', 'Certify'],
    },
    {
      code: 'TNK-03',
      name: 'Tank Disinfection Only',
      description: 'Sanitise without full drain.',
      price: 89,
      durationLabel: '45 min',
      checklist: [
        'Surface skim & debris removal',
        'Anti-bacterial fogging',
        'Safe-to-use water test',
      ],
      steps: ['Inspect', 'Skim', 'Disinfect', 'Test'],
    },
  ],
  sof: [
    {
      code: 'SOF-01',
      name: 'Sofa Shampoo (per seat)',
      description: 'Lift stains, odours & dust mites.',
      price: 35,
      durationLabel: '20 min/seat',
      tag: 'Popular',
      checklist: ['Pre-treat stains', 'Deep shampoo extraction', 'Deodorise & fast-dry'],
    },
    {
      code: 'SOF-02',
      name: 'Fabric Protection Coat',
      description: 'Repels future spills & stains.',
      price: 49,
      durationLabel: '30 min',
      checklist: ['Apply protective layer', 'Cure & buff', 'Spill-resistant finish'],
    },
  ],
  crp: [
    {
      code: 'CRP-01',
      name: 'Carpet Steam Clean (per room)',
      description: 'Hot-water extraction deep clean.',
      price: 69,
      durationLabel: '45 min',
      tag: 'Popular',
      checklist: [
        'Vacuum & pre-spray',
        'Hot steam extraction',
        'Spot-treat stains',
        'Speed-dry pass',
      ],
    },
    {
      code: 'CRP-02',
      name: 'Rug Deep Clean',
      description: 'Per rug, collected if needed.',
      price: 89,
      durationLabel: 'By size',
      checklist: ['Dust & beat out grit', 'Submersion wash', 'Fibre-safe dry & groom'],
    },
  ],
  kit: [
    {
      code: 'KIT-01',
      name: 'Kitchen Deep Clean',
      description: 'Degrease every surface.',
      price: 119,
      durationLabel: '2 hrs',
      tag: 'Popular',
      checklist: [
        'Degrease counters & backsplash',
        'Inside & outside cabinets',
        'Sink descale & polish',
        'Floor scrub',
      ],
    },
    {
      code: 'KIT-02',
      name: 'Oven & Hob Degrease',
      description: 'Baked-on grime removal.',
      price: 79,
      durationLabel: '60 min',
      checklist: ['Dismantle racks & trays', 'Soak & scrub', 'Polish glass & hob'],
    },
  ],
  bth: [
    {
      code: 'BTH-01',
      name: 'Bathroom Sanitation',
      description: 'Descale, sanitise & shine.',
      price: 59,
      durationLabel: '45 min',
      tag: 'Popular',
      checklist: [
        'Descale taps & glass',
        'Disinfect toilet & basin',
        'Scrub tiles & floor',
        'Mirror & fittings polish',
      ],
    },
    {
      code: 'BTH-02',
      name: 'Grout & Tile Restoration',
      description: 'Bring tiles back to new.',
      price: 99,
      durationLabel: '90 min',
      checklist: ['Deep-scrub grout lines', 'Mould & stain treatment', 'Seal & protect'],
    },
  ],
  lndr: [
    {
      code: 'LND-01',
      name: 'Wash & Iron (per kg)',
      description: 'Wash, dry and press clothes to perfection.',
      price: 12,
      durationLabel: '24 hrs',
      tag: 'Popular',
      checklist: [
        'Sort & pre-treat stains',
        'Machine wash at correct temp',
        'Tumble-dry & press',
        'Fold & pack neatly',
      ],
    },
    {
      code: 'LND-02',
      name: 'Dry Cleaning (per item)',
      description: 'Professional dry cleaning for delicates.',
      price: 25,
      durationLabel: '48 hrs',
      checklist: ['Inspect & tag items', 'Chemical clean', 'Steam press & finish'],
    },
    {
      code: 'LND-03',
      name: 'Curtain Cleaning',
      description: 'Remove & rehang after full clean.',
      price: 69,
      durationLabel: '3–4 hrs',
      checklist: ['Remove & label curtains', 'Steam or wash as needed', 'Press & rehang'],
    },
  ],
};

const CLEAN_OFFERS = [
  // prettier-ignore
  { title: 'Instant Tank Refresh', discountLabel: 'Up to 60% off', promoCode: 'TANK60', timeLabel: '60', timeUnit: 'MINUTES', categoryLabel: 'Water Tank', iconKey: 'ic_water_tank' },
  // prettier-ignore
  { title: 'Sofa & Carpet Revival', discountLabel: 'Flat 50% off', promoCode: 'SOFA50', timeLabel: '90', timeUnit: 'MINUTES', categoryLabel: 'Upholstery', iconKey: 'ic_sofa' },
  // prettier-ignore
  { title: 'Sparkling Deep Clean', discountLabel: 'AED 70 off', promoCode: 'DEEP70', timeLabel: 'Same', timeUnit: 'DAY', categoryLabel: 'Deep Clean', iconKey: 'ic_deep_clean' },
];

const CLEAN_PROMOS = [
  { code: 'TANK60', kind: CleanPromoKind.PERCENT, value: 60 },
  { code: 'SOFA50', kind: CleanPromoKind.PERCENT, value: 50 },
  { code: 'DEEP70', kind: CleanPromoKind.FIXED, value: 70 },
];

async function seedClean(): Promise<void> {
  for (const [i, cat] of CLEAN_CATEGORIES.entries()) {
    const category = await prisma.cleanCategory.upsert({
      where: { slug: cat.slug },
      update: {},
      create: { ...cat, sortOrder: i },
    });
    for (const [j, svc] of (CLEAN_SERVICES[cat.slug] ?? []).entries()) {
      await prisma.cleanService.upsert({
        where: { code: svc.code },
        update: {},
        create: {
          ...svc,
          tag: svc.tag ?? null,
          steps: svc.steps ?? undefined,
          categoryId: category.id,
          sortOrder: j,
        },
      });
    }
  }
  for (const [i, offer] of CLEAN_OFFERS.entries()) {
    const existing = await prisma.cleanOffer.findFirst({ where: { promoCode: offer.promoCode } });
    if (!existing) {
      await prisma.cleanOffer.create({ data: { ...offer, sortOrder: i } });
    }
  }
  for (const promo of CLEAN_PROMOS) {
    await prisma.cleanPromo.upsert({
      where: { code: promo.code },
      update: {},
      create: promo,
    });
  }
}

// ─── ELK Porter fixtures (mirror porter_screen.dart / dummy_data.dart) ───────

const PORTER_VEHICLES = [
  // prettier-ignore
  { slug: 'bike', name: 'Bike', emoji: '🏍️', iconKey: 'veh_bike', capacityLabel: 'Up to 5 kg', etaMinutes: 12, baseFare: 35, badge: 'FASTEST' as string | null },
  // prettier-ignore
  { slug: 'car', name: 'Car', emoji: '🚐', iconKey: 'veh_car', capacityLabel: 'Up to 100 kg', etaMinutes: 18, baseFare: 65, badge: null },
  // prettier-ignore
  { slug: 'truck', name: 'Truck', emoji: '🚚', iconKey: 'veh_truck', capacityLabel: 'Up to 3 Ton', etaMinutes: 25, baseFare: 180, badge: null },
];

const PORTER_ADDONS = [
  { key: 'helper', label: 'Loading helper', price: 30 },
  { key: 'fragile', label: 'Fragile handling', price: 15 },
  { key: 'insure', label: 'Insurance', price: 10 },
];

async function seedPorter(): Promise<void> {
  for (const [i, vehicle] of PORTER_VEHICLES.entries()) {
    await prisma.porterVehicle.upsert({
      where: { slug: vehicle.slug },
      update: {},
      create: { ...vehicle, sortOrder: i },
    });
  }
  for (const [i, addon] of PORTER_ADDONS.entries()) {
    await prisma.porterAddon.upsert({
      where: { key: addon.key },
      update: {},
      create: { ...addon, sortOrder: i },
    });
  }
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
  await seedClean();
  await seedPorter();

  const stays = await prisma.stay.count();
  const stayBookings = await prisma.stayBooking.count();
  const cars = await prisma.rentalCar.count();
  const cleanServices = await prisma.cleanService.count();

  console.log(`Seeded users: ${demoUser.name} (${demoUser.id}), ${admin.name} (${admin.id})`);
  console.log(`Seeded catalog: ${catalog.length} categories, ${serviceCount} services`);
  console.log(
    `Seeded: ${stays} stays, ${stayBookings} stay bookings, ${cars} rental cars, coupons ELKNEW/ELK10`,
  );
  console.log(
    `Seeded clean: ${CLEAN_CATEGORIES.length} categories, ${cleanServices} services, promos TANK60/SOFA50/DEEP70`,
  );
  console.log(`Seeded porter: ${PORTER_VEHICLES.length} vehicles, ${PORTER_ADDONS.length} add-ons`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
