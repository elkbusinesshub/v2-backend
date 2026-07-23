import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { REVIEW_MAX_COMMENT_LENGTH, REVIEW_MAX_TAGS, REVIEW_QUICK_TAGS } from './reviews.constants';

export class SubmitReviewDto {
  @ApiProperty({ minimum: 1, maximum: 5, example: 5 })
  @IsInt()
  @Min(1)
  @Max(5)
  rating!: number;

  @ApiProperty({ enum: REVIEW_QUICK_TAGS, isArray: true })
  @IsArray()
  @ArrayMaxSize(REVIEW_MAX_TAGS)
  @ArrayUnique()
  @IsIn(REVIEW_QUICK_TAGS, { each: true })
  tags!: string[];

  @ApiProperty({ example: 'Great job, very professional!' })
  @IsString()
  @MaxLength(REVIEW_MAX_COMMENT_LENGTH)
  comment!: string;
}
