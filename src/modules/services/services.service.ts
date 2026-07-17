import { Injectable } from '@nestjs/common';
import { ResourceNotFoundException } from '@/common/errors/domain.exceptions';
import { initialsOf } from '@/common/utils/initials';
import { LocationsRepository } from '@/modules/locations/locations.repository';
import { TIME_SLOTS, upcomingDates } from './booking-window';
import { BookingOptionsDto, ServiceDetailDto, ServiceGroupDto, TimeSlotDto } from './services.dto';
import { ServicesRepository, ServiceWithCategory } from './services.repository';

@Injectable()
export class ServicesService {
  constructor(
    private readonly services: ServicesRepository,
    private readonly locations: LocationsRepository,
  ) {}

  async listGroups(): Promise<ServiceGroupDto[]> {
    const categories = await this.services.findAllGrouped();
    return categories
      .filter((c) => c.services.length > 0)
      .map((c) => ({
        title: c.name,
        icon: c.icon,
        items: c.services.map((s) => ({ id: s.id, name: s.name, icon: s.icon })),
      }));
  }

  async getDetail(serviceId: string): Promise<ServiceDetailDto> {
    const service = await this.requireService(serviceId);
    return {
      id: service.id,
      title: service.name,
      badge: service.badge ?? '',
      providerName: service.providerName,
      providerInitials: initialsOf(service.providerName),
      providerExperience: service.providerExperience,
      rating: service.rating,
      reviewCount: service.reviewCount,
      duration: service.durationLabel,
      teamSize: service.teamSizeLabel,
      category: service.category.name,
      bookings: service.bookingsLabel,
      included: Array.isArray(service.included) ? service.included.map(String) : [],
      description: service.description,
      price: service.price.toNumber(),
      priceUnit: service.priceUnit,
    };
  }

  async getBookingOptions(serviceId: string, userId: string): Promise<BookingOptionsDto> {
    const service = await this.requireService(serviceId);
    const address = await this.locations.findDefaultForUser(userId);
    const price = service.price.toNumber();

    return {
      serviceId: service.id,
      serviceName: service.name,
      dates: upcomingDates().map(({ day, weekday }) => ({ day, weekday })),
      timeSlots: TIME_SLOTS.map((time): TimeSlotDto => ({ time, available: true })),
      address: address?.formattedAddress ?? '',
      // No promo engine yet — the fee is the total.
      pricing: { serviceFee: price, promoCode: null, promoDiscount: 0, total: price },
    };
  }

  private async requireService(id: string): Promise<ServiceWithCategory> {
    const service = await this.services.findById(id);
    if (!service) {
      throw new ResourceNotFoundException('Service');
    }
    return service;
  }
}
