import { Module } from '@nestjs/common';
import { WhatsappService } from './whatsapp.service';

/** WhatsApp Cloud API: job messages to professionals. */
@Module({
  providers: [WhatsappService],
  exports: [WhatsappService],
})
export class WhatsappModule {}
