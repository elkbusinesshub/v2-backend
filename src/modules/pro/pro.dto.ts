import { IsBoolean, IsIn, IsOptional } from 'class-validator';

export const JOB_VIEWS = ['today', 'upcoming', 'done'] as const;
export type JobView = (typeof JOB_VIEWS)[number];

export class JobsQueryDto {
  /** today (with anything unfinished from earlier days), upcoming, or done. */
  @IsOptional()
  @IsIn(JOB_VIEWS)
  view?: JobView;
}

export class UpdateDutyDto {
  @IsBoolean()
  onDuty!: boolean;
}

/** The signed-in professional, as their own screens show them. */
export class ProProfileDto {
  id!: string;
  name!: string;
  phone!: string;
  experienceYears!: number;
  skills!: string;
  location!: { id: string; area: string; district: string } | null;
  onDuty!: boolean;
  stats!: { today: number; upcoming: number; doneThisMonth: number; doneTotal: number };
}
