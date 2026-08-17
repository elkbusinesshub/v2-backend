import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class SendMessageDto {
  @ApiProperty({ example: 'Is the 1BHK still free from October?' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(1000)
  text!: string;
}
