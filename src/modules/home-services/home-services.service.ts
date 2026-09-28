import { randomInt } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { ServiceBookingStatus, type PromoCode, type ServiceVertical } from '@prisma/client';
import {
  DomainException,
  ResourceNotFoundException,
  ValidationFailedException,
} from '@/common/errors/domain.exceptions';
import type { AuthUser } from '@/common/types/auth.types';
import { LocationsRepository } from '@/modules/locations/locations.repository';
import { UsersRepository } from '@/modules/users/users.repository';
import type {
  CreateServiceBookingDto,
  HomeServiceDto,
  PromoCheckDto,
  ServiceBookingDto,
} from './home-services.dto';
import { isoDay, toBookingJson, toServiceJson } from './home-services.mapper';
import { HomeServicesRepository } from './home-services.repository';
import { applyPromo, matchArea, quote, todayInIndia, type PromoRule } from './home-services.rules';

const CODE_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

/** A booking the customer may still walk away from. */
const CUSTOMER_CANCELLABLE: ServiceBookingStatus[] = [
  ServiceBookingStatus.PENDING,
  ServiceBookingStatus.CONFIRMED,
];

export function toPromoRule(p: PromoCode): PromoRule {
  return {
    code: p.code,
    percent: p.percent,
    maxDiscount: Number(p.maxDiscount),
    minOrder: Number(p.minOrder),
    validTill: isoDay(p.validTill),
    active: p.active,
  };
}

/**
 * ELK's own cleaning and repair services, as the customer app uses them:
 * what is on offer, what a promo code takes off, and booking one.
 *
 * Every price is computed here from the stored rates — the app shows the same
 * arithmetic, but the order is priced on the server.
 */
@Injectable()
export class HomeServicesService {
  constructor(
    private readonly repo: HomeServicesRepository,
    private readonly addresses: LocationsRepository,
    private readonly users: UsersRepository,
  ) {}

  async listLive(vertical?: ServiceVertical): Promise<HomeServiceDto[]> {
    return (await this.repo.listLive(vertical)).map(toServiceJson);
  }

  async checkPromo(code: string, subtotal: number): Promise<PromoCheckDto> {
    const promo = await this.repo.findPromo(code);
    const result = applyPromo(promo && toPromoRule(promo), code, subtotal, todayInIndia());
    return { ok: result.ok, discount: result.discount, message: result.message };
  }

  async book(user: AuthUser, dto: CreateServiceBookingDto): Promise<ServiceBookingDto> {
    const service = await this.repo.findService(dto.serviceId);
    if (!service || !service.active || !service.online) {
      throw new ResourceNotFoundException('Service');
    }
    if (dto.hours < service.minHours) {
      throw new ValidationFailedException([
        { field: 'hours', message: `${service.name} needs at least ${service.minHours} hours` },
      ]);
    }
    if (dto.date < todayInIndia()) {
      throw new ValidationFailedException([{ field: 'date', message: 'date has passed' }]);
    }

    const address = await this.addresses.findByIdForUser(dto.addressId, user.id);
    if (!address) {
      throw new ResourceNotFoundException('Address');
    }
    const addressText = [address.flatNumber, address.building, address.formattedAddress]
      .filter((part) => part && part.trim())
      .join(', ');
    const area = matchArea(await this.repo.activeAreas(), {
      text: addressText,
      lat: address.lat,
      lng: address.lng,
    });
    if (!area) {
      throw new DomainException(
        HttpStatus.UNPROCESSABLE_ENTITY,
        'AREA_NOT_SERVED',
        "We don't serve this address yet. Try another address.",
      );
    }

    const price = {
      hourlyRate: Number(service.hourlyRate),
      extraProRate: Number(service.extraProRate),
      materialsFee: Number(service.materialsFee),
    };
    // Materials can only be asked for where the service offers them.
    const withMaterials = (dto.withMaterials ?? false) && price.materialsFee > 0;
    const q = quote(price, dto.hours, dto.professionals, withMaterials);

    let discount = 0;
    let promoCode: string | null = null;
    if (dto.promoCode?.trim()) {
      const promo = await this.repo.findPromo(dto.promoCode);
      const result = applyPromo(
        promo && toPromoRule(promo),
        dto.promoCode,
        q.subtotal,
        todayInIndia(),
      );
      if (!result.ok) {
        throw new DomainException(
          HttpStatus.UNPROCESSABLE_ENTITY,
          'PROMO_REJECTED',
          result.message,
        );
      }
      discount = result.discount;
      promoCode = promo!.code;
    }

    const account = await this.users.findById(user.id);
    const booking = await this.repo.createBooking({
      code: `ELK-S-${this.randomCode()}`,
      userId: user.id,
      serviceId: service.id,
      serviceName: service.name,
      vertical: service.vertical,
      category: service.category,
      hours: dto.hours,
      professionals: dto.professionals,
      withMaterials,
      scheduledDate: new Date(`${dto.date}T00:00:00.000Z`),
      timeSlot: dto.timeSlot,
      addressLabel: address.label,
      addressText,
      lat: address.lat,
      lng: address.lng,
      directions: address.directions,
      contactPhone: account?.phone ?? '',
      locationId: area.id,
      baseAmount: q.base,
      materialsAmount: q.materials,
      discountAmount: discount,
      totalAmount: q.subtotal - discount,
      promoCode,
    });
    return toBookingJson(booking);
  }

  async cancel(user: AuthUser, id: string): Promise<ServiceBookingDto> {
    const booking = await this.repo.findBooking(id);
    // Someone else's booking reads as missing, not as forbidden.
    if (!booking || booking.userId !== user.id) {
      throw new ResourceNotFoundException('Booking');
    }
    if (!CUSTOMER_CANCELLABLE.includes(booking.status)) {
      throw new DomainException(
        HttpStatus.CONFLICT,
        'INVALID_TRANSITION',
        'This booking has already started and can no longer be cancelled',
      );
    }
    return toBookingJson(
      await this.repo.updateBooking(id, {
        status: ServiceBookingStatus.CANCELLED,
        cancelledAt: new Date(),
      }),
    );
  }

  private randomCode(): string {
    return Array.from({ length: 5 }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
  }
}
