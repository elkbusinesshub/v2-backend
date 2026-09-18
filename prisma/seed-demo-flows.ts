import { PrismaClient, ProviderStatus, Role } from '@prisma/client';

/**
 * Test data for the listing, cleaning and vehicle-rental flows.
 *
 * Local only, and separate from `seed.ts`, which must not invent users: this
 * one exists to make the phone-OTP test accounts usable as buyer, partners and
 * staff without setting each one up by hand.
 *
 * Run with: npm run db:seed:demo
 *
 * Idempotent — every row is keyed on the phone number, the seller and the
 * title, so running it twice changes nothing.
 *
 * The phones are OTP_TEST_PHONES from .env; they all sign in with OTP_TEST_CODE.
 */
const prisma = new PrismaClient();

const BUYER = '+919999999999';
const CLEANER = '+918888888888';
const RENTALS = '+917777777777';
const STAFF = '+916666666666';
const CLEANER_2 = '+915555555555';

const BUYER_WALLET = 25_000;

interface DemoAccount {
  phone: string;
  name: string;
  email: string;
  walletBalance?: number;
  /** Given a verified, online provider profile — only these receive requests. */
  business?: { name: string; category: string; area: string };
}

const ACCOUNTS: DemoAccount[] = [
  { phone: BUYER, name: 'Asha Nair', email: 'asha.demo@example.com', walletBalance: BUYER_WALLET },
  {
    phone: CLEANER,
    name: 'Shine Home Services',
    email: 'shine.demo@example.com',
    business: { name: 'Shine Home Services', category: 'Cleaning', area: 'Bengaluru' },
  },
  {
    phone: RENTALS,
    name: 'Kerala Wheels Rentals',
    email: 'wheels.demo@example.com',
    business: { name: 'Kerala Wheels Rentals', category: 'Vehicle rental', area: 'Bengaluru' },
  },
  { phone: STAFF, name: 'Ravi Kumar', email: 'ravi.demo@example.com' },
  {
    phone: CLEANER_2,
    name: 'Bright Clean Co',
    email: 'bright.demo@example.com',
    business: { name: 'Bright Clean Co', category: 'Cleaning', area: 'Kochi' },
  },
];

/** Marketplace listings: browsed and filtered, contacted directly, never booked. */
const LISTINGS: {
  seller: string;
  categorySlug: string;
  title: string;
  description: string;
  price: number;
  priceUnit: string;
  icon: string;
  locality: string;
  city: string;
}[] = [
  {
    seller: CLEANER,
    categorySlug: 'listing_cleaning',
    title: 'Deep home cleaning (2BHK)',
    description:
      'Full flat: floors, kitchen, two bathrooms, balconies. Team of three, about 4 hours.',
    price: 1800,
    priceUnit: '/ visit',
    icon: '🧹',
    locality: 'Koramangala',
    city: 'Bengaluru',
  },
  {
    seller: CLEANER,
    categorySlug: 'listing_cleaning',
    title: 'Sofa and carpet shampoo',
    description: 'Wet shampoo and vacuum for upholstery. Price is for a 5-seater sofa.',
    price: 1200,
    priceUnit: '/ visit',
    icon: '🛋️',
    locality: 'Indiranagar',
    city: 'Bengaluru',
  },
  {
    seller: CLEANER_2,
    categorySlug: 'listing_cleaning',
    title: 'Water tank cleaning',
    description: 'Drain, scrub and disinfect overhead and sump tanks up to 1000 litres.',
    price: 900,
    priceUnit: '/ visit',
    icon: '💧',
    locality: 'Kakkanad',
    city: 'Kochi',
  },
  {
    seller: CLEANER_2,
    categorySlug: 'listing_stay',
    title: 'Lakeside homestay, Munnar',
    description: 'Two-bedroom cottage with a lake view. Breakfast included, parking on site.',
    price: 2500,
    priceUnit: '/ night',
    icon: '🏡',
    locality: 'Munnar',
    city: 'Idukki',
  },
  {
    seller: CLEANER_2,
    categorySlug: 'listing_stay',
    title: 'PG for women, Kakkanad',
    description: 'Twin sharing with food, Wi-Fi and laundry. Walking distance to Infopark.',
    price: 7500,
    priceUnit: '/ month',
    icon: '🏠',
    locality: 'Kakkanad',
    city: 'Kochi',
  },
  {
    seller: RENTALS,
    categorySlug: 'listing_stay',
    title: 'Beach house, Varkala',
    description: 'Whole house, sleeps six, five minutes from the cliff. Weekend bookings only.',
    price: 4000,
    priceUnit: '/ night',
    icon: '🌊',
    locality: 'Varkala',
    city: 'Thiruvananthapuram',
  },
  {
    seller: CLEANER,
    categorySlug: 'listing_repair',
    title: 'AC service and gas refill',
    description: 'Split or window AC: coil clean, filter wash, gas top-up. Same-day slots.',
    price: 1400,
    priceUnit: '/ unit',
    icon: '❄️',
    locality: 'HSR Layout',
    city: 'Bengaluru',
  },
  {
    seller: RENTALS,
    categorySlug: 'listing_repair',
    title: 'Plumbing — taps and leaks',
    description: 'Tap, mixer and flush repairs. Parts charged extra at cost.',
    price: 450,
    priceUnit: 'starting',
    icon: '🔧',
    locality: 'Jayanagar',
    city: 'Bengaluru',
  },
  {
    seller: CLEANER_2,
    categorySlug: 'listing_repair',
    title: 'House painting, per room',
    description: 'Two coats of emulsion including putty and primer. Paint billed separately.',
    price: 3500,
    priceUnit: '/ room',
    icon: '🎨',
    locality: 'Edappally',
    city: 'Kochi',
  },
  {
    seller: RENTALS,
    categorySlug: 'listing_tool_rental',
    title: 'Bosch drill machine',
    description: 'Cordless hammer drill with two batteries and a bit set. Deposit ₹2,000.',
    price: 300,
    priceUnit: '/ day',
    icon: '🛠️',
    locality: 'Indiranagar',
    city: 'Bengaluru',
  },
  {
    seller: RENTALS,
    categorySlug: 'listing_tool_rental',
    title: 'Aluminium ladder, 12 ft',
    description: 'Folding step ladder. Pickup only; fits on a car roof.',
    price: 150,
    priceUnit: '/ day',
    icon: '🪜',
    locality: 'Indiranagar',
    city: 'Bengaluru',
  },
  {
    seller: CLEANER,
    categorySlug: 'listing_tool_rental',
    title: 'Pressure washer',
    description: 'High-pressure washer for cars, driveways and walls. Hose included.',
    price: 500,
    priceUnit: '/ day',
    icon: '💦',
    locality: 'Koramangala',
    city: 'Bengaluru',
  },
  {
    seller: CLEANER_2,
    categorySlug: 'listing_tool_rental',
    title: 'Concrete mixer',
    description: 'Half-bag portable mixer for small site work. Delivery available in Kochi.',
    price: 1200,
    priceUnit: '/ day',
    icon: '🧱',
    locality: 'Aluva',
    city: 'Ernakulam',
  },
];

/** Cleaning partners: which districts they cover and what they charge. */
const CLEANING_SETUP: { seller: string; districts: string[]; prices: Record<string, number> }[] = [
  {
    seller: CLEANER,
    districts: ['bengaluru_urban', 'bengaluru_rural'],
    prices: {
      HOME_CLEANING: 1500,
      DEEP_CLEANING: 2500,
      KITCHEN: 900,
      BATHROOM: 700,
      SOFA_CARPET: 1200,
      WATER_TANK: 1000,
    },
  },
  {
    // Also covers Bengaluru Urban, so a declined request there finds a second
    // partner — at a higher price, which is why the first one is picked.
    seller: CLEANER_2,
    districts: ['bengaluru_urban', 'ernakulam', 'thrissur'],
    prices: { HOME_CLEANING: 1700, DEEP_CLEANING: 2800, KITCHEN: 1100, WATER_TANK: 900 },
  },
];

/** Rental shops: where pickups happen, and the fleet. */
const RENTAL_SETUP: {
  seller: string;
  address: string;
  lat: number;
  lng: number;
  deliveryFee: number;
  vehicles: { vehicleType: string; quantity: number; pricePerDay: number }[];
}[] = [
  {
    seller: RENTALS,
    address: 'Kerala Wheels, 100 Feet Road, Indiranagar, Bengaluru',
    lat: 12.9784,
    lng: 77.6408,
    deliveryFee: 300,
    vehicles: [
      { vehicleType: 'BIKE', quantity: 2, pricePerDay: 500 },
      { vehicleType: 'SCOOTER', quantity: 3, pricePerDay: 450 },
      { vehicleType: 'HATCHBACK', quantity: 2, pricePerDay: 1500 },
      { vehicleType: 'SEDAN', quantity: 1, pricePerDay: 2200 },
      { vehicleType: 'SUV', quantity: 2, pricePerDay: 2800 },
      { vehicleType: 'TEMPO_TRAVELLER', quantity: 1, pricePerDay: 4500 },
    ],
  },
  {
    // Far from Bengaluru: a buyer there is given Kerala Wheels first, and this
    // shop only when its vehicles are all taken.
    seller: CLEANER_2,
    address: 'Bright Rentals, Marine Drive, Kochi',
    lat: 9.9816,
    lng: 76.2755,
    deliveryFee: 150,
    vehicles: [
      { vehicleType: 'SCOOTER', quantity: 4, pricePerDay: 400 },
      { vehicleType: 'HATCHBACK', quantity: 2, pricePerDay: 1300 },
      { vehicleType: 'SUV', quantity: 1, pricePerDay: 2600 },
    ],
  },
];

/** One staff login, working for both partners. */
const STAFF_OF = [
  { seller: CLEANER, name: 'Ravi Kumar' },
  { seller: RENTALS, name: 'Ravi Kumar' },
];

async function seedAccounts(): Promise<Map<string, string>> {
  const ids = new Map<string, string>();
  for (const account of ACCOUNTS) {
    const data = {
      name: account.name,
      email: account.email,
      ...(account.walletBalance === undefined ? {} : { walletBalance: account.walletBalance }),
    };
    const user = await prisma.user.upsert({
      where: { phone: account.phone },
      create: { phone: account.phone, roles: [Role.USER], ...data },
      update: data,
    });
    ids.set(account.phone, user.id);

    if (account.business) {
      const profile = {
        businessName: account.business.name,
        serviceCategory: account.business.category,
        contactNumber: account.phone,
        serviceArea: account.business.area,
        // Verified and online, or no request would ever reach them.
        status: ProviderStatus.VERIFIED,
        isAvailable: true,
      };
      await prisma.providerProfile.upsert({
        where: { userId: user.id },
        create: { userId: user.id, ...profile },
        update: profile,
      });
    }
  }
  return ids;
}

async function seedListings(ids: Map<string, string>): Promise<number> {
  for (const listing of LISTINGS) {
    const sellerId = ids.get(listing.seller)!;
    const { seller: _seller, ...fields } = listing;
    const existing = await prisma.ad.findFirst({ where: { sellerId, title: listing.title } });
    if (existing) {
      await prisma.ad.update({ where: { id: existing.id }, data: { ...fields, deletedAt: null } });
    } else {
      await prisma.ad.create({ data: { sellerId, ...fields } });
    }
  }
  return LISTINGS.length;
}

async function seedCleaningPartners(ids: Map<string, string>): Promise<void> {
  for (const partner of CLEANING_SETUP) {
    const sellerId = ids.get(partner.seller)!;
    await prisma.$transaction(async (tx) => {
      // Raw deletes: the soft-delete extension sends `deleteMany` through the
      // base client, outside this transaction, where it would wait on this
      // transaction's own locks.
      await tx.$executeRaw`DELETE FROM partner_districts WHERE sellerId = ${sellerId}`;
      await tx.$executeRaw`DELETE FROM cleaning_service_prices WHERE sellerId = ${sellerId}`;
      await tx.partnerDistrict.createMany({
        data: partner.districts.map((district) => ({ sellerId, district })),
      });
      await tx.cleaningServicePrice.createMany({
        data: Object.entries(partner.prices).map(([serviceType, price]) => ({
          sellerId,
          serviceType,
          price,
        })),
      });
    });
  }
}

async function seedRentalShops(ids: Map<string, string>): Promise<void> {
  for (const shop of RENTAL_SETUP) {
    const sellerId = ids.get(shop.seller)!;
    const row = {
      address: shop.address,
      lat: shop.lat,
      lng: shop.lng,
      deliveryFee: shop.deliveryFee,
    };
    await prisma.$transaction(async (tx) => {
      await tx.rentalShop.upsert({
        where: { sellerId },
        create: { sellerId, ...row },
        update: row,
      });
      await tx.$executeRaw`DELETE FROM rental_vehicles WHERE sellerId = ${sellerId}`;
      await tx.rentalVehicle.createMany({
        data: shop.vehicles.map((v) => ({ sellerId, ...v })),
      });
    });
  }
}

async function seedStaff(ids: Map<string, string>): Promise<void> {
  const staffUserId = ids.get(STAFF)!;
  for (const employer of STAFF_OF) {
    const sellerId = ids.get(employer.seller)!;
    await prisma.sellerStaff.upsert({
      where: { sellerId_staffUserId: { sellerId, staffUserId } },
      create: { sellerId, staffUserId, name: employer.name },
      update: { name: employer.name },
    });
  }
}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('seed-demo-flows is for local testing only — never run it against production');
  }

  const ids = await seedAccounts();
  const listings = await seedListings(ids);
  await seedCleaningPartners(ids);
  await seedRentalShops(ids);
  await seedStaff(ids);

  console.log(
    `Demo accounts: ${ACCOUNTS.length} (buyer wallet ₹${BUYER_WALLET.toLocaleString('en-IN')})`,
  );
  console.log(`  buyer            ${BUYER}  Asha Nair`);
  console.log(`  cleaning partner ${CLEANER}  Shine Home Services`);
  console.log(`  rental shop      ${RENTALS}  Kerala Wheels Rentals`);
  console.log(`  staff            ${STAFF}  Ravi Kumar (both partners)`);
  console.log(`  second partner   ${CLEANER_2}  Bright Clean Co (cleaning + Kochi rentals)`);
  console.log(`Listings: ${listings} across the four marketplace categories`);
  console.log(`Cleaning partners: ${CLEANING_SETUP.length} · rental shops: ${RENTAL_SETUP.length}`);
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => void prisma.$disconnect());
