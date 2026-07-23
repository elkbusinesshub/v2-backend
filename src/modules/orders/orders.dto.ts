import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SendMessageDto {
  @ApiProperty({ example: 'On my way, will arrive in 10 minutes' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  text!: string;
}
