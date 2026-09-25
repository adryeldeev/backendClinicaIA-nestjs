import { Controller, Get, Inject, Query, UseGuards, UseInterceptors } from '@nestjs/common';
import { z } from 'zod';
import { AuditInterceptor, Roles, RolesGuard, SessionGuard } from '../../identity';
import { parseDto } from '../../../shared/http/parse-dto';
import { CLOCK, type Clock } from '../../../shared/kernel/clock';
import { GetResolutionMetricsUseCase } from '../application/get-resolution-metrics.use-case';

const metricsQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});

function startOfMonthUtc(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}

@Controller('api/admin/metrics')
@UseGuards(SessionGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('ADMIN', 'RECEPCAO')
export class MetricsAdminController {
  constructor(
    private readonly getResolutionMetrics: GetResolutionMetricsUseCase,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Get()
  async get(@Query() query: unknown) {
    const dto = parseDto(metricsQuerySchema, query);
    const now = this.clock.now();
    const from = dto.from ?? startOfMonthUtc(now);
    const to = dto.to ?? now;

    return this.getResolutionMetrics.execute(from, to);
  }
}
