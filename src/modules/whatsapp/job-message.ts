/**
 * The WhatsApp a professional gets when a company assigns them a job.
 *
 * WhatsApp Cloud API only sends pre-approved templates. Create one in
 * WhatsApp Manager (category: Utility), named as WHATSAPP_TEMPLATE_NAME, with
 * these body variables in this order. Suggested body:
 *
 *   Hello {{1}}, you have a new job from {{2}} on ELK.
 *
 *   Service: {{3}}
 *   Date: {{4}}, {{5}}
 *   Work: {{6}}
 *   Customer: {{7}}, {{8}}
 *   Address: {{9}}
 *   Location: {{10}}
 *   Note from customer: {{11}}
 *   Booking ID: {{12}}
 *
 *   Please reach on time and call the customer if you need help finding the place.
 */
export interface JobMessageInput {
  professionalName: string;
  companyName: string;
  serviceName: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM */
  timeSlot: string;
  hours: number;
  professionals: number;
  withMaterials: boolean;
  /** "materials" for cleaning, "spare parts" for repair. */
  extraLabel: string;
  customerName: string;
  customerPhone: string;
  addressLabel: string;
  addressText: string;
  lat: number | null;
  lng: number | null;
  directions: string | null;
  bookingCode: string;
}

/** The template's body variables, {{1}} to {{12}}. */
export function jobMessageParams(j: JobMessageInput): string[] {
  const people = j.professionals === 1 ? '1 person' : `${j.professionals} people`;
  const work = `${j.hours} ${j.hours === 1 ? 'hour' : 'hours'}, ${people}${
    j.withMaterials ? `, bring ${j.extraLabel}` : ''
  }`;
  const address = [j.addressLabel, j.addressText].filter((p) => p && p.trim()).join(' - ');
  return [
    j.professionalName,
    j.companyName,
    j.serviceName,
    dayLabel(j.date),
    timeLabel(j.timeSlot),
    work,
    j.customerName,
    j.customerPhone,
    address,
    mapsLink(j.lat, j.lng, j.addressText),
    j.directions?.trim() || 'None',
    j.bookingCode,
  ];
}

/** Opens Google Maps at the customer's pin, or searches the address when there is none. */
export function mapsLink(lat: number | null, lng: number | null, address: string): string {
  const query = lat != null && lng != null ? `${lat},${lng}` : address;
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

/** 2026-10-14 → "Wed, 14 Oct 2026" */
function dayLabel(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  const weekday = d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' });
  const month = d.toLocaleDateString('en-GB', { month: 'short', timeZone: 'UTC' });
  return `${weekday}, ${d.getUTCDate()} ${month} ${d.getUTCFullYear()}`;
}

/** 13:00 → "1:00 PM" */
function timeLabel(slot: string): string {
  const [h = 0, m = 0] = slot.split(':').map(Number);
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')} ${h >= 12 ? 'PM' : 'AM'}`;
}
