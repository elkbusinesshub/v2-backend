import { DriverService, Prisma, PrismaClient } from '@prisma/client';

/**
 * Idempotent seed — safe to run repeatedly (uses upsert / stable keys).
 * Run with: npm run db:seed
 *
 * Everything a seller offers is an ad. There is no separate catalogue of
 * services, stays, cars, cleans or repairs any more, so this file seeds
 * listings under the six categories the app groups by, plus the two dispatch
 * products (porter, rides) that still have their own tables.
 */
const prisma = new PrismaClient();

// ─── ELK Porter fixtures (mirror porter_screen.dart) ─────────────────────────

const PORTER_VEHICLES = [
  // prettier-ignore
  { slug: 'bike', name: 'Bike', emoji: '🏍️', iconKey: 'veh_bike', capacityLabel: 'Up to 20 kg', etaMinutes: 12, baseFare: 25, badge: 'FASTEST' as string | null },
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

// ─── Rides (Taxi) fixtures (mirror taxi_screen.dart) ─────────────────────────

const RIDE_TYPES = [
  // prettier-ignore
  { slug: 'auto', name: 'Auto', emoji: '🛺', iconKey: 'car_auto', seats: 3, etaMinutes: 4, baseFare: 8, cancellationFee: 6.0, badge: 'FASTER' as string | null },
  // prettier-ignore
  { slug: 'economy', name: 'Economy', emoji: '🚗', iconKey: 'car_sedan', seats: 4, etaMinutes: 5, baseFare: 15, cancellationFee: 10.0, badge: null },
  // prettier-ignore
  { slug: 'premium', name: 'Premium', emoji: '🚙', iconKey: 'car_premium', seats: 4, etaMinutes: 6, baseFare: 28, cancellationFee: 15.0, badge: 'POPULAR' },
  // prettier-ignore
  { slug: 'xl', name: 'ELK XL', emoji: '🚐', iconKey: 'car_van', seats: 6, etaMinutes: 7, baseFare: 35, cancellationFee: 15.0, badge: null },
];

async function seedRides(): Promise<void> {
  for (const [i, rideType] of RIDE_TYPES.entries()) {
    await prisma.rideType.upsert({
      where: { slug: rideType.slug },
      update: {},
      create: { ...rideType, sortOrder: i },
    });
  }
}

// ─── Offers fixtures (mirror dummyOffersJson) ────────────────────────────────

const OFFERS = [
  {
    tagLabel: 'FOR NEW USERS',
    title: 'Welcome Offer',
    description: 'Get 20% off your first booking on any service category',
    code: 'ELK20',
    expiryLabel: 'Expires 31 May 2026',
    discountLabel: '20%',
    discountSubLabel: 'OFF',
    gradientStartHex: 0xff0d3d35,
    gradientEndHex: 0xff4bbfb0,
  },
  {
    tagLabel: 'CLEANING SPECIAL',
    title: 'Flat ₹30 Off',
    description: 'On deep cleaning or AC services booked this weekend',
    code: 'CLEAN30',
    expiryLabel: 'Valid: Fri-Sun only',
    discountLabel: '₹',
    discountSubLabel: '30',
    gradientStartHex: 0xff1a2e3d,
    gradientEndHex: 0xff4f46e5,
  },
];

async function seedOffers(): Promise<void> {
  for (const [i, offer] of OFFERS.entries()) {
    await prisma.offer.upsert({
      where: { code: offer.code },
      update: { ...offer, sortOrder: i },
      create: { ...offer, sortOrder: i },
    });
  }
}

// ─── Marketplace listings ────────────────────────────────────────────────────

/**
 * Listings with *no* engagement: view and wishlist counts must be earned by
 * real users, or the "best sellers" ranking would be showing invented
 * popularity. Ratings start at zero for the same reason — a listing is "New"
 * until somebody actually rates it.
 *
 * `categorySlug` is what each vertical's screen filters on, so the set here is
 * exactly the set the app groups by. `attributes` follows the per-category
 * shape in src/modules/marketplace/ad-attributes.ts.
 */
type AdFixture = {
  title: string;
  categorySlug: string;
  icon: string;
  price: number;
  priceUnit: string;
  locality: string;
  city: string;
  description: string;
  attributes?: Prisma.InputJsonObject;
};

const ADS: AdFixture[] = [
  // ── Cleaning ───────────────────────────────────────────────────────────────
  {
    title: 'Deep Home Cleaning',
    categorySlug: 'cleaning',
    icon: '🧹',
    price: 180,
    priceUnit: '/ visit',
    locality: 'Koramangala',
    city: 'Bengaluru',
    description:
      'Full-home deep clean by a vetted team. Kitchen degreasing, bathroom descaling, floor scrubbing and balcony wash included. Materials and equipment provided.',
    attributes: {
      subCategory: 'deep',
      durationLabel: '3-4 hrs',
      includes: ['Kitchen degreasing', 'Bathroom descaling', 'Floor scrubbing', 'Balcony wash'],
    },
  },
  {
    title: 'Home Cleaning',
    categorySlug: 'cleaning',
    icon: '🏠',
    price: 85,
    priceUnit: '/ visit',
    locality: 'Jayanagar',
    city: 'Bengaluru',
    description:
      'Routine cleaning for a 2BHK: sweeping, mopping, dusting and bin clearance. Ideal weekly or fortnightly.',
    attributes: { subCategory: 'cln', durationLabel: '2-3 hrs' },
  },
  {
    title: 'Sofa & Carpet Shampoo',
    categorySlug: 'cleaning',
    icon: '🛋️',
    price: 120,
    priceUnit: '/ set',
    locality: 'HSR Layout',
    city: 'Bengaluru',
    description:
      'Wet shampoo and extraction for upholstery and rugs. Removes stains and odour; fabric-safe solutions only. Dries in 4-6 hours.',
    attributes: { subCategory: 'sof', durationLabel: '2-3 hrs' },
  },
  {
    title: 'Water Tank Cleaning',
    categorySlug: 'cleaning',
    icon: '🚰',
    price: 140,
    priceUnit: '/ tank',
    locality: 'Whitefield',
    city: 'Bengaluru',
    description:
      'Drain, scrub, disinfect and refill. Sludge removal and anti-bacterial treatment for overhead and underground tanks.',
    attributes: { subCategory: 'tnk', durationLabel: '1-2 hrs' },
  },
  {
    title: 'Kitchen Deep Clean',
    categorySlug: 'cleaning',
    icon: '🍽️',
    price: 99,
    priceUnit: '/ visit',
    locality: 'Indiranagar',
    city: 'Bengaluru',
    description:
      'Chimney and hob degreasing, cabinet fronts, tiles and sink polish. Food-safe products throughout.',
    attributes: { subCategory: 'kit', durationLabel: '2 hrs' },
  },
  {
    title: 'Bathroom Deep Clean',
    categorySlug: 'cleaning',
    icon: '🚿',
    price: 79,
    priceUnit: '/ bathroom',
    locality: 'Koramangala',
    city: 'Bengaluru',
    description:
      'Hard-water stain removal, grout scrubbing, sanitary-ware descaling and disinfection.',
    attributes: { subCategory: 'bth', durationLabel: '1-2 hrs' },
  },
  {
    title: 'Wash & Fold Laundry',
    categorySlug: 'cleaning',
    icon: '🧺',
    price: 45,
    priceUnit: '/ kg',
    locality: 'Koramangala',
    city: 'Bengaluru',
    description:
      'Pickup, machine wash, tumble dry and fold. Separate wash for whites and colours. Returned within 24 hours.',
    attributes: { subCategory: 'lndr', durationLabel: '24 hrs' },
  },

  // ── Repairs ────────────────────────────────────────────────────────────────
  {
    title: 'AC Service & Gas Refill',
    categorySlug: 'repairing',
    icon: '❄️',
    price: 90,
    priceUnit: 'starting',
    locality: 'Indiranagar',
    city: 'Bengaluru',
    description:
      'Split and window AC servicing, coil cleaning, gas top-up and leak check. Certified technicians.',
    attributes: { subCategory: 'ac', durationLabel: '1-2 hrs', warrantyLabel: '30-day warranty' },
  },
  {
    title: 'Plumbing & Leak Fix',
    categorySlug: 'repairing',
    icon: '🚿',
    price: 95,
    priceUnit: '/ visit',
    locality: 'Jayanagar',
    city: 'Bengaluru',
    description:
      'Tap and mixer replacement, blocked drains, concealed leak detection and pipe repair. Same-day slots available.',
    attributes: { subCategory: 'plm', durationLabel: '1-2 hrs', warrantyLabel: '15-day warranty' },
  },
  {
    title: 'Electrical Repairs',
    categorySlug: 'repairing',
    icon: '⚡',
    price: 89,
    priceUnit: '/ visit',
    locality: 'Whitefield',
    city: 'Bengaluru',
    description:
      'Wiring faults, switchboard replacement, fan and light installation. Licensed electricians with their own tools.',
    attributes: { subCategory: 'elc', durationLabel: '1-2 hrs', warrantyLabel: '30-day warranty' },
  },
  {
    title: 'Carpentry & Furniture Repair',
    categorySlug: 'repairing',
    icon: '🪚',
    price: 110,
    priceUnit: '/ visit',
    locality: 'HSR Layout',
    city: 'Bengaluru',
    description:
      'Door alignment, hinge and lock replacement, shelving, and repairs to wardrobes and beds.',
    attributes: { subCategory: 'cpt', durationLabel: '2-3 hrs' },
  },
  {
    title: 'Interior Painting',
    categorySlug: 'repairing',
    icon: '🎨',
    price: 260,
    priceUnit: '/ room',
    locality: 'MG Road',
    city: 'Bengaluru',
    description:
      'Putty, primer and two coats of emulsion. Furniture covering and post-work cleanup included.',
    attributes: { subCategory: 'pnt', durationLabel: '1-2 days', warrantyLabel: '1-year warranty' },
  },
  {
    title: 'Handyman & Assembly',
    categorySlug: 'repairing',
    icon: '🛠️',
    price: 75,
    priceUnit: '/ hour',
    locality: 'Whitefield',
    city: 'Bengaluru',
    description:
      'Furniture assembly, wall mounting, curtain rods, door alignment and general odd jobs around the house.',
    attributes: { subCategory: 'gen', durationLabel: '1-3 hrs' },
  },

  // ── Car rental ─────────────────────────────────────────────────────────────
  {
    title: 'Maruti Swift',
    categorySlug: 'car_rental',
    icon: '🚗',
    price: 1400,
    priceUnit: '/ day',
    locality: 'Koramangala',
    city: 'Bengaluru',
    description:
      'Compact hatchback, ideal for city driving. Unlimited kilometres within city limits; fuel not included.',
    attributes: { subCategory: 'SEDAN', seats: 5, transmission: 'MANUAL', fuel: 'PETROL' },
  },
  {
    title: 'Honda City',
    categorySlug: 'car_rental',
    icon: '🚙',
    price: 2100,
    priceUnit: '/ day',
    locality: 'Indiranagar',
    city: 'Bengaluru',
    description: 'Comfortable sedan with boot space for four bags. Automatic, well-maintained.',
    attributes: { subCategory: 'SEDAN', seats: 5, transmission: 'AUTOMATIC', fuel: 'PETROL' },
  },
  {
    title: 'Toyota Innova Crysta',
    categorySlug: 'car_rental',
    icon: '🚐',
    price: 3400,
    priceUnit: '/ day',
    locality: 'Whitefield',
    city: 'Bengaluru',
    description:
      'Seven-seater for family trips and outstation runs. Diesel, roof carrier on request.',
    attributes: { subCategory: 'SUV', seats: 7, transmission: 'MANUAL', fuel: 'DIESEL' },
  },
  {
    title: 'Mahindra XUV700',
    categorySlug: 'car_rental',
    icon: '🚙',
    price: 3900,
    priceUnit: '/ day',
    locality: 'HSR Layout',
    city: 'Bengaluru',
    description:
      'Full-size SUV with automatic gearbox and panoramic sunroof. Ideal for long drives.',
    attributes: { subCategory: 'SUV', seats: 7, transmission: 'AUTOMATIC', fuel: 'DIESEL' },
  },
  {
    title: 'BMW 3 Series',
    categorySlug: 'car_rental',
    icon: '🏎️',
    price: 7500,
    priceUnit: '/ day',
    locality: 'MG Road',
    city: 'Bengaluru',
    description: 'Luxury sedan for occasions and executive travel. Chauffeur available on request.',
    attributes: { subCategory: 'LUXURY', seats: 5, transmission: 'AUTOMATIC', fuel: 'PETROL' },
  },
  {
    title: 'Tata Nexon EV',
    categorySlug: 'car_rental',
    icon: '🔋',
    price: 2600,
    priceUnit: '/ day',
    locality: 'Jayanagar',
    city: 'Bengaluru',
    description: 'Electric compact SUV, roughly 300 km on a charge. Home charger cable supplied.',
    attributes: { subCategory: 'SUV', seats: 5, transmission: 'AUTOMATIC', fuel: 'ELECTRIC' },
  },

  // ── ELK Stay ───────────────────────────────────────────────────────────────
  {
    title: 'Maple Nest — Single Room',
    categorySlug: 'elkstay',
    icon: '🏨',
    price: 11500,
    priceUnit: '/ month',
    locality: 'Koramangala',
    city: 'Bengaluru',
    description:
      'Furnished single room in a co-living house. Wi-Fi, housekeeping twice a week, and meals available on a separate plan.',
    attributes: {
      roomType: 'Single occupancy',
      stayType: 'PG',
      depositAmount: 11500,
      furnished: true,
    },
  },
  {
    title: 'Maple Nest — Twin Sharing',
    categorySlug: 'elkstay',
    icon: '🛏️',
    price: 7800,
    priceUnit: '/ month',
    locality: 'Koramangala',
    city: 'Bengaluru',
    description: 'Twin-sharing room with attached bathroom, wardrobe and study table per occupant.',
    attributes: {
      roomType: 'Twin sharing',
      stayType: 'PG',
      depositAmount: 7800,
      furnished: true,
    },
  },
  {
    title: 'Skyline Mens Hostel',
    categorySlug: 'elkstay',
    icon: '🏢',
    price: 6500,
    priceUnit: '/ month',
    locality: 'Whitefield',
    city: 'Bengaluru',
    description:
      'Walking distance from the tech park. Three meals a day, laundry, and 24-hour security.',
    attributes: {
      roomType: 'Triple sharing',
      stayType: 'MENS_HOSTEL',
      depositAmount: 6500,
      furnished: true,
    },
  },
  {
    title: 'Lotus Womens Hostel',
    categorySlug: 'elkstay',
    icon: '🌸',
    price: 7200,
    priceUnit: '/ month',
    locality: 'Jayanagar',
    city: 'Bengaluru',
    description: 'Women-only accommodation with warden, biometric entry and a common study room.',
    attributes: {
      roomType: 'Twin sharing',
      stayType: 'WOMENS_HOSTEL',
      depositAmount: 14400,
      furnished: true,
    },
  },
  {
    title: 'Green Court Homestay',
    categorySlug: 'elkstay',
    icon: '🏡',
    price: 18000,
    priceUnit: '/ month',
    locality: 'Indiranagar',
    city: 'Bengaluru',
    description:
      'Independent 1BHK on the first floor of a family home. Private entrance, kitchen and parking.',
    attributes: {
      roomType: '1BHK',
      stayType: 'HOMESTAY',
      depositAmount: 36000,
      furnished: false,
    },
  },
  {
    title: 'Harbour View PG',
    categorySlug: 'elkstay',
    icon: '🏬',
    price: 9400,
    priceUnit: '/ month',
    locality: 'HSR Layout',
    city: 'Bengaluru',
    description: 'Newly built PG with air-conditioned rooms, gym access and a rooftop common area.',
    attributes: {
      roomType: 'Single occupancy',
      stayType: 'PG',
      depositAmount: 18800,
      furnished: true,
    },
  },
];

/**
 * Centre of each seeded locality, so the ad detail screen can draw a real
 * coverage map. Localities repeat across listings, hence a lookup rather than
 * a coordinate pair on every row.
 */
const LOCALITY_COORDS: Record<string, { lat: number; lng: number }> = {
  Koramangala: { lat: 12.9352, lng: 77.6245 },
  'HSR Layout': { lat: 12.9116, lng: 77.6474 },
  Indiranagar: { lat: 12.9784, lng: 77.6408 },
  Whitefield: { lat: 12.9698, lng: 77.75 },
  Jayanagar: { lat: 12.925, lng: 77.5938 },
  'MG Road': { lat: 12.9756, lng: 77.6068 },
};

async function seedAds(sellerId: string | null): Promise<number> {
  if (!sellerId) return 0;
  let count = 0;
  for (const ad of ADS) {
    const coords = LOCALITY_COORDS[ad.locality];
    const data = {
      ...ad,
      attributes: ad.attributes ?? undefined,
      lat: coords?.lat ?? null,
      lng: coords?.lng ?? null,
    };
    const existing = await prisma.ad.findFirst({ where: { title: data.title, sellerId } });
    if (existing) {
      // Refresh the copy, but never the counters or the rating — those are
      // earned by real users.
      await prisma.ad.update({ where: { id: existing.id }, data });
    } else {
      await prisma.ad.create({ data: { ...data, sellerId } });
    }
    count += 1;
  }
  return count;
}

/**
 * Who owns the seeded listings.
 *
 * The demo provider when there is one — a listing belongs to the person who
 * would actually do the work, and that account is the one with a seller
 * profile. Otherwise the oldest real account, so a fresh production database
 * still gets a catalogue rather than nothing.
 */
async function seedSellerId(): Promise<string | null> {
  const provider = await prisma.user.findUnique({
    where: { phone: '+971500000002' },
    select: { id: true },
  });
  if (provider) return provider.id;

  const user = await prisma.user.findFirst({ orderBy: { createdAt: 'asc' }, select: { id: true } });
  return user?.id ?? null;
}

/**
 * Demo accounts, created **only** when SEED_DEMO_USERS is set.
 *
 * Production seeds must not invent users — that decision stands, and is why
 * `seedSellerId()` falls back to a real account instead. But the integration
 * suite runs against an empty container and needs a signed-in caller to test
 * anything at all, so it opts in via the env var.
 */
async function seedDemoUsers(): Promise<number> {
  if (process.env.SEED_DEMO_USERS !== 'true') return 0;

  const demo = [
    // First names matter: the home feeds greet the user by theirs.
    { phone: '+971500000000', name: 'Demo Admin', roles: ['ADMIN'] },
    { phone: '+971500000001', name: 'Demo User', roles: ['USER'] },
    { phone: '+971500000002', name: 'Demo Provider', roles: ['PROVIDER'] },
  ];

  for (const account of demo) {
    await prisma.user.upsert({
      where: { phone: account.phone },
      update: {},
      create: { phone: account.phone, name: account.name, roles: account.roles },
    });
  }
  return demo.length;
}

/**
 * Records the integration suite reads back: a live order with a chat thread, a
 * completed order to review, a wallet ledger, and notifications.
 */
async function seedDemoRecords(): Promise<void> {
  if (process.env.SEED_DEMO_USERS !== 'true') return;

  const buyer = await prisma.user.findUnique({ where: { phone: '+971500000001' } });
  const seller = await prisma.user.findUnique({ where: { phone: '+971500000002' } });
  if (!buyer || !seller) return;

  const listing = await prisma.ad.findFirst({
    where: { title: 'Deep Home Cleaning', sellerId: seller.id },
  });
  if (listing) {
    // An in-progress order with a chat thread — what the orders spec tracks.
    const order = await prisma.adOrder.upsert({
      where: { code: 'ELK-A-SEED1' },
      update: {},
      create: {
        code: 'ELK-A-SEED1',
        adId: listing.id,
        buyerId: buyer.id,
        sellerId: seller.id,
        status: 'IN_PROGRESS',
        amount: 180,
        quantity: 1,
        serviceName: listing.title,
        scheduledAt: new Date('2026-06-12T09:00:00.000Z'),
        addressText: '5th Block, Koramangala, Bengaluru',
        lat: 12.9352,
        lng: 77.6245,
        contactPhone: buyer.phone!,
        acceptedAt: new Date('2026-06-12T08:30:00.000Z'),
      },
    });

    if ((await prisma.chatMessage.count({ where: { adOrderId: order.id } })) === 0) {
      // Order matters: seller first, so the thread opens with an incoming
      // message carrying the seller's initials.
      await prisma.chatMessage.createMany({
        data: [
          {
            adOrderId: order.id,
            fromProvider: true,
            text: 'On my way, should reach in 20 minutes.',
          },
          { adOrderId: order.id, fromProvider: false, text: 'Great, the gate code is 4471.' },
          { adOrderId: order.id, fromProvider: true, text: 'Noted, thank you.' },
        ],
      });
    }

    // A finished order, so the review flow has something to rate.
    await prisma.adOrder.upsert({
      where: { code: 'ELK-A-SEED2' },
      update: {},
      create: {
        code: 'ELK-A-SEED2',
        adId: listing.id,
        buyerId: buyer.id,
        sellerId: seller.id,
        status: 'COMPLETED',
        amount: 180,
        quantity: 1,
        serviceName: listing.title,
        scheduledAt: new Date('2026-05-19T09:00:00.000Z'),
        addressText: '5th Block, Koramangala, Bengaluru',
        contactPhone: buyer.phone!,
        acceptedAt: new Date('2026-05-19T08:30:00.000Z'),
        completedAt: new Date('2026-05-19T12:00:00.000Z'),
      },
    });
  }

  // Wallet: balance and reward points live on the user; the ledger is its own
  // table. Both are read back by the wallet, payments and offers specs.
  await prisma.user.update({
    where: { id: buyer.id },
    data: { walletBalance: 240.5, rewardPoints: 150 },
  });

  if ((await prisma.walletTransaction.count({ where: { userId: buyer.id } })) === 0) {
    // Newest first is what the summary returns, so these are created oldest
    // first and the last one here is the one the spec reads as [0].
    await prisma.walletTransaction.createMany({
      data: [
        {
          userId: buyer.id,
          icon: '🚕',
          title: 'Airport Ride',
          amount: 320,
          isCredit: false,
          colorHex: 0xfffee2e2,
          createdAt: new Date('2026-05-02T10:00:00.000Z'),
        },
        {
          userId: buyer.id,
          icon: '💰',
          title: 'Wallet Top-Up',
          amount: 500,
          isCredit: true,
          colorHex: 0xffd1fae5,
          createdAt: new Date('2026-05-08T10:00:00.000Z'),
        },
        {
          userId: buyer.id,
          icon: '🔧',
          title: 'AC Service',
          amount: 260,
          isCredit: false,
          colorHex: 0xfffee2e2,
          createdAt: new Date('2026-05-13T10:00:00.000Z'),
        },
        {
          userId: buyer.id,
          icon: '🎁',
          title: 'Referral Bonus',
          amount: 100,
          isCredit: true,
          colorHex: 0xffd1fae5,
          createdAt: new Date('2026-05-16T10:00:00.000Z'),
        },
        {
          userId: buyer.id,
          icon: '🧹',
          title: 'Deep Home Cleaning',
          amount: 119,
          isCredit: false,
          colorHex: 0xfffee2e2,
          createdAt: new Date('2026-05-19T10:00:00.000Z'),
        },
      ],
    });
  }

  // Notifications: two unread, newest first.
  if ((await prisma.notification.count({ where: { userId: buyer.id } })) === 0) {
    const minutesAgo = (m: number) => new Date(Date.now() - m * 60_000);
    await prisma.notification.createMany({
      data: [
        {
          userId: buyer.id,
          icon: '⭐',
          colorHex: 0xfffef3c7,
          title: 'Rate Your Service',
          message: 'How was your AC service?',
          isRead: true,
          createdAt: minutesAgo(60 * 72),
        },
        {
          userId: buyer.id,
          icon: '🎉',
          colorHex: 0xffe0f7f5,
          title: 'Welcome to ELK',
          message: 'Your account is ready.',
          isRead: true,
          createdAt: minutesAgo(60 * 48),
        },
        {
          userId: buyer.id,
          icon: '💰',
          colorHex: 0xffd1fae5,
          title: 'Wallet Topped Up',
          message: '₹500 added to your wallet.',
          isRead: true,
          createdAt: minutesAgo(60 * 24),
        },
        {
          userId: buyer.id,
          icon: '📦',
          colorHex: 0xfffee2e2,
          title: 'Delivery Completed',
          message: 'Your package was delivered.',
          isRead: false,
          createdAt: minutesAgo(90),
        },
        {
          userId: buyer.id,
          icon: '🧹',
          colorHex: 0xffe0f7f5,
          title: 'Provider On The Way',
          message: 'Your cleaner will arrive shortly.',
          isRead: false,
          createdAt: minutesAgo(2),
        },
      ],
    });
  }

  // The seller's own profile. Its stats are no longer stored here — the panel
  // derives them from the orders above. Wednesday off is what the schedule
  // spec asserts.
  await prisma.providerProfile.upsert({
    where: { userId: seller.id },
    update: {},
    create: {
      userId: seller.id,
      businessName: 'Royal Shine Co.',
      serviceCategory: 'cleaning',
      contactNumber: '+971500000002',
      serviceArea: 'Bengaluru · Within 15 km',
      tradeLicenseUploaded: true,
      idDocumentUploaded: true,
      status: 'VERIFIED',
      isAvailable: true,
      scheduleDays: [true, true, false, true, true, true, false],
    },
  });
}

// ─── QA test accounts ────────────────────────────────────────────────────────

/**
 * Five fixed-code accounts for manual testing, created only when
 * SEED_TEST_ACCOUNTS is set.
 *
 * Their numbers are listed in `OTP_TEST_PHONES`, so signing in as any of them
 * always takes `OTP_TEST_CODE` and never sends an SMS. `env.validation.ts`
 * refuses to boot with that list non-empty under NODE_ENV=production, which is
 * what keeps these out of a real deployment.
 *
 * Two drive, three sell — between them they cover every screen the app has.
 */
const TEST_ACCOUNTS = [
  { phone: '+919999999999', name: 'Test Driver', role: 'RIDE' as const },
  { phone: '+918888888888', name: 'Test Porter', role: 'PORTER' as const },
  { phone: '+917777777777', name: 'Test Seller One', role: 'SELLER' as const },
  { phone: '+916666666666', name: 'Test Seller Two', role: 'SELLER' as const },
  { phone: '+915555555555', name: 'Test Seller Three', role: 'SELLER' as const },
];

/** The vehicle each driving account runs. */
const TEST_VEHICLES = {
  RIDE: { vehicleSlug: 'auto', vehicleLabel: 'Bajaj RE · Yellow', plateNumber: 'KA05TA1111' },
  PORTER: { vehicleSlug: 'bike', vehicleLabel: 'Hero Splendor · Black', plateNumber: 'KA05PT2222' },
};

/**
 * Two listings in each of the four seller categories, per selling account.
 *
 * Taxi and porter are absent by design: they are dispatch products served by
 * the two driving accounts, and nobody posts an ad for them.
 */
const TEST_AD_TEMPLATES: AdFixture[] = [
  {
    title: 'Full Home Deep Cleaning',
    categorySlug: 'cleaning',
    icon: '🧹',
    price: 200,
    priceUnit: '/ visit',
    locality: 'Koramangala',
    city: 'Bengaluru',
    description:
      'Whole-house deep clean: kitchen degreasing, bathroom descaling, floor scrubbing and balcony wash. Team of two, materials included.',
    attributes: {
      subCategory: 'deep',
      durationLabel: '3-4 hrs',
      includes: ['Kitchen', 'Bathrooms', 'Floors'],
    },
  },
  {
    title: 'Sofa & Carpet Shampooing',
    categorySlug: 'cleaning',
    icon: '🛋️',
    price: 130,
    priceUnit: '/ set',
    locality: 'HSR Layout',
    city: 'Bengaluru',
    description:
      'Wet shampoo and extraction for upholstery and rugs. Fabric-safe solutions, dries in 4-6 hours.',
    attributes: { subCategory: 'sof', durationLabel: '2-3 hrs' },
  },
  {
    title: 'AC Service & Gas Refill',
    categorySlug: 'repairing',
    icon: '❄️',
    price: 95,
    priceUnit: 'starting',
    locality: 'Indiranagar',
    city: 'Bengaluru',
    description:
      'Split and window AC servicing, coil cleaning, gas top-up and leak check by certified technicians.',
    attributes: { subCategory: 'ac', durationLabel: '1-2 hrs', warrantyLabel: '30-day warranty' },
  },
  {
    title: 'Plumbing & Leak Repair',
    categorySlug: 'repairing',
    icon: '🚿',
    price: 90,
    priceUnit: '/ visit',
    locality: 'Jayanagar',
    city: 'Bengaluru',
    description:
      'Tap and mixer replacement, blocked drains, concealed leak detection and pipe repair. Same-day slots.',
    attributes: { subCategory: 'plm', durationLabel: '1-2 hrs', warrantyLabel: '15-day warranty' },
  },
  {
    title: 'Honda City · Automatic',
    categorySlug: 'car_rental',
    icon: '🚗',
    price: 2200,
    priceUnit: '/ day',
    locality: 'Koramangala',
    city: 'Bengaluru',
    description: 'Comfortable sedan with boot space for four bags. Automatic, fuel not included.',
    attributes: { subCategory: 'SEDAN', seats: 5, transmission: 'AUTOMATIC', fuel: 'PETROL' },
  },
  {
    title: 'Toyota Innova · 7 Seater',
    categorySlug: 'car_rental',
    icon: '🚐',
    price: 3500,
    priceUnit: '/ day',
    locality: 'Whitefield',
    city: 'Bengaluru',
    description:
      'Seven-seater for family trips and outstation runs. Diesel, roof carrier on request.',
    attributes: { subCategory: 'SUV', seats: 7, transmission: 'MANUAL', fuel: 'DIESEL' },
  },
  {
    title: 'Furnished PG · Single Room',
    categorySlug: 'elkstay',
    icon: '🏨',
    price: 12000,
    priceUnit: '/ month',
    locality: 'Koramangala',
    city: 'Bengaluru',
    description:
      'Furnished single room in a co-living house. Wi-Fi, housekeeping twice a week, meals on a separate plan.',
    attributes: {
      roomType: 'Single occupancy',
      stayType: 'PG',
      depositAmount: 12000,
      furnished: true,
    },
  },
  {
    title: 'Independent 1BHK Homestay',
    categorySlug: 'elkstay',
    icon: '🏡',
    price: 19000,
    priceUnit: '/ month',
    locality: 'Indiranagar',
    city: 'Bengaluru',
    description:
      'First-floor 1BHK in a family home. Private entrance, kitchen and covered parking.',
    attributes: { roomType: '1BHK', stayType: 'HOMESTAY', depositAmount: 38000, furnished: false },
  },
];

async function seedTestAccounts(): Promise<void> {
  if (process.env.SEED_TEST_ACCOUNTS !== 'true') return;

  let ads = 0;
  for (const account of TEST_ACCOUNTS) {
    const user = await prisma.user.upsert({
      where: { phone: account.phone },
      update: { name: account.name },
      create: { phone: account.phone, name: account.name, roles: ['USER'] },
    });

    // Authoritative: a test account ends up exactly as described here, even
    // if earlier manual testing left it registered for something else.
    const intended =
      account.role === 'RIDE'
        ? DriverService.RIDE
        : account.role === 'PORTER'
          ? DriverService.PORTER
          : null;
    await prisma.driverProfile.deleteMany({
      where: { userId: user.id, ...(intended ? { service: { not: intended } } : {}) },
    });

    if (account.role === 'SELLER') {
      // Each selling account gets its own copy of all eight, so the four
      // category screens have several sellers to choose between rather than
      // one seller's list repeated.
      for (const template of TEST_AD_TEMPLATES) {
        const coords = LOCALITY_COORDS[template.locality];
        const data = {
          ...template,
          lat: coords?.lat ?? null,
          lng: coords?.lng ?? null,
        };
        const existing = await prisma.ad.findFirst({
          where: { title: data.title, sellerId: user.id },
        });
        if (existing) {
          await prisma.ad.update({ where: { id: existing.id }, data });
        } else {
          await prisma.ad.create({ data: { ...data, sellerId: user.id } });
        }
        ads += 1;
      }
      continue;
    }

    // A driving account: registered, on duty, and placed in the middle of the
    // seeded localities so it is immediately dispatchable. `lastSeenAt` is set
    // to now — the app's own heartbeat keeps it fresh from there.
    const service = intended!;
    await prisma.driverProfile.upsert({
      where: { userId_service: { userId: user.id, service } },
      // The vehicle is rewritten too: a profile left over from earlier manual
      // testing must end up as described here, not keep whatever it had.
      update: {
        ...TEST_VEHICLES[account.role],
        isOnline: true,
        lat: 12.9352,
        lng: 77.6245,
        lastSeenAt: new Date(),
        activeBookingId: null,
      },
      create: {
        userId: user.id,
        service,
        ...TEST_VEHICLES[account.role],
        isOnline: true,
        lat: 12.9352,
        lng: 77.6245,
        lastSeenAt: new Date(),
      },
    });
  }

  console.log(
    `Seeded ${TEST_ACCOUNTS.length} test accounts (SEED_TEST_ACCOUNTS=true): ` +
      `1 taxi driver, 1 delivery partner, 3 sellers with ${ads} listings`,
  );
}

async function main(): Promise<void> {
  // Before the listings: they need an owner, and the demo provider is it.
  const demoUsers = await seedDemoUsers();
  if (demoUsers > 0) console.log(`Seeded ${demoUsers} demo users (SEED_DEMO_USERS=true)`);

  // Catalogue rows no seller ever creates: ride classes, porter vehicles and
  // promo banners are configuration, not somebody's listing. They must come
  // back after a wipe or the taxi and porter screens have nothing to show.
  await seedPorter();
  await seedRides();
  await seedOffers();

  // Listings are a seller's work, so a database cleared on purpose can ask to
  // stay empty and still get the configuration above.
  const withListings = process.env.SEED_LISTINGS !== 'false';
  const adCount = withListings ? await seedAds(await seedSellerId()) : 0;
  if (withListings) await seedDemoRecords();
  await seedTestAccounts();

  console.log(
    !withListings
      ? 'Skipped marketplace listings (SEED_LISTINGS=false)'
      : adCount > 0
        ? `Seeded marketplace: ${adCount} listings (zero engagement — counts and ratings are earned)`
        : 'Skipped marketplace listings: no user to own them yet',
  );
  console.log(`Seeded offers: ${OFFERS.length} banners`);
  console.log(`Seeded porter: ${PORTER_VEHICLES.length} vehicles, ${PORTER_ADDONS.length} add-ons`);
  console.log(`Seeded rides: ${RIDE_TYPES.length} ride types`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
