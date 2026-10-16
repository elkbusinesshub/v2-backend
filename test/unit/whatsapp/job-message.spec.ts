import { jobMessageParams, mapsLink } from '@/modules/whatsapp/job-message';
import { templateText } from '@/modules/whatsapp/whatsapp.service';

const job = {
  professionalName: 'Anil Kumar',
  companyName: 'Shine Home Services',
  serviceName: 'Bathroom deep clean',
  date: '2026-10-14',
  timeSlot: '13:00',
  hours: 3,
  professionals: 2,
  withMaterials: true,
  extraLabel: 'cleaning materials',
  customerName: 'Priya Menon',
  customerPhone: '+912222222222',
  addressLabel: 'Home',
  addressText: 'Flat 4B, Skyline Apartments, Kakkanad 682030',
  lat: 10.0159,
  lng: 76.3419,
  directions: 'Second tower.\nCall at the gate.',
  bookingCode: 'ELK-S-4T29K',
};

describe('job WhatsApp', () => {
  it('fills the template variables in order', () => {
    expect(jobMessageParams(job)).toEqual([
      'Anil Kumar',
      'Shine Home Services',
      'Bathroom deep clean',
      'Wed, 14 Oct 2026',
      '1:00 PM',
      '3 hours, 2 people, bring cleaning materials',
      'Priya Menon',
      '+912222222222',
      'Home - Flat 4B, Skyline Apartments, Kakkanad 682030',
      'https://www.google.com/maps/search/?api=1&query=10.0159%2C76.3419',
      'Second tower.\nCall at the gate.',
      'ELK-S-4T29K',
    ]);
  });

  it('links to the address when the customer has no pin', () => {
    expect(mapsLink(null, null, 'Kakkanad 682030')).toBe(
      'https://www.google.com/maps/search/?api=1&query=Kakkanad%20682030',
    );
  });

  it('cleans variables the way WhatsApp requires', () => {
    expect(templateText('Second tower.\nCall at the gate.')).toBe(
      'Second tower. Call at the gate.',
    );
    expect(templateText('a      b')).toBe('a   b');
    expect(templateText('  ')).toBe('-');
  });
});
