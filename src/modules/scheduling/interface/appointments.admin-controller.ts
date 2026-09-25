import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { z } from 'zod';
import {
  AuditInterceptor,
  AuthenticatedUser,
  CurrentUser,
  Roles,
  RolesGuard,
  SessionGuard,
} from '../../identity';
import { parseDto } from '../../../shared/http/parse-dto';
import { AdminCancelAppointmentUseCase } from '../application/admin-cancel-appointment.use-case';
import { AdminRescheduleAppointmentUseCase } from '../application/admin-reschedule-appointment.use-case';
import { CreateManualAppointmentUseCase } from '../application/create-manual-appointment.use-case';
import { ListAppointmentsUseCase } from '../application/list-appointments.use-case';
import { ListOpenSlotsUseCase } from '../application/list-open-slots.use-case';

// Achado do usuario (2026-09-25): from/to invertidos devolvia 200 com
// lista vazia — silenciava um erro de calculo de data da propria tela
// (ela veria uma agenda vazia sem sinal do que errou). E sem teto, um
// intervalo aberto ainda permite pedir uma decada de agenda numa unica
// chamada. Duas checagens, reusadas em listQuerySchema e
// availabilityQuerySchema (mesmo buraco, mesmo controller — corrigir um
// e deixar o irmao e o padrao que a gente ja evitou no
// PrismaAppointmentRepository.withDeadlockRetry).
const MAX_DATE_RANGE_DAYS = 92;
const MAX_DATE_RANGE_MS = MAX_DATE_RANGE_DAYS * 24 * 60 * 60 * 1000;

function isRangeOrdered(from: Date, to: Date): boolean {
  return to.getTime() >= from.getTime();
}

function isRangeWithinCap(from: Date, to: Date): boolean {
  return to.getTime() - from.getTime() <= MAX_DATE_RANGE_MS;
}

const listQuerySchema = z
  .object({
    from: z.coerce.date(),
    to: z.coerce.date(),
    professionalId: z.string().uuid().optional(),
  })
  .refine((data) => isRangeOrdered(data.from, data.to), { message: '"to" não pode ser anterior a "from".', path: ['to'] })
  .refine((data) => isRangeWithinCap(data.from, data.to), {
    message: `O intervalo entre "from" e "to" não pode passar de ${MAX_DATE_RANGE_DAYS} dias.`,
    path: ['to'],
  });

const createBodySchema = z.object({
  patientId: z.string().uuid(),
  professionalId: z.string().uuid(),
  procedureId: z.string().uuid(),
  startsAt: z.coerce.date(),
});

// Achado do usuario (2026-09-25): nomes de campo pro ingles — motivo->reason,
// novoStartsAt->newStartsAt. Quebra de contrato deliberada, feita AGORA
// porque nada consome essas rotas ainda (front ainda nao chegou na Fase 2);
// daqui a duas semanas fica caro. So o schema Zod (contrato de fio) muda —
// a camada de aplicacao (AdminCancelAppointmentInput/
// AdminRescheduleAppointmentInput) ja usava esses nomes em ingles.
const cancelBodySchema = z.object({
  reason: z.string().optional(),
});

const rescheduleBodySchema = z.object({
  newStartsAt: z.coerce.date(),
});

const availabilityQuerySchema = z
  .object({
    professionalId: z.string().uuid(),
    procedureId: z.string().uuid(),
    from: z.coerce.date(),
    to: z.coerce.date(),
  })
  .refine((data) => isRangeOrdered(data.from, data.to), { message: '"to" não pode ser anterior a "from".', path: ['to'] })
  .refine((data) => isRangeWithinCap(data.from, data.to), {
    message: `O intervalo entre "from" e "to" não pode passar de ${MAX_DATE_RANGE_DAYS} dias.`,
    path: ['to'],
  });

@Controller('api/admin')
@UseGuards(SessionGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
export class AppointmentsAdminController {
  constructor(
    private readonly listAppointments: ListAppointmentsUseCase,
    private readonly createManualAppointment: CreateManualAppointmentUseCase,
    private readonly adminCancelAppointment: AdminCancelAppointmentUseCase,
    private readonly adminRescheduleAppointment: AdminRescheduleAppointmentUseCase,
    private readonly listOpenSlots: ListOpenSlotsUseCase,
  ) {}

  @Get('appointments')
  list(@Query() query: unknown, @CurrentUser() user: AuthenticatedUser) {
    const dto = parseDto(listQuerySchema, query);
    return this.listAppointments.execute({
      from: dto.from,
      to: dto.to,
      requestedProfessionalId: dto.professionalId,
      currentUser: user,
    });
  }

  @Post('appointments')
  @Roles('ADMIN', 'RECEPCAO')
  create(@Body() body: unknown) {
    const dto = parseDto(createBodySchema, body);
    return this.createManualAppointment.execute(dto);
  }

  @Post('appointments/:id/cancel')
  @HttpCode(HttpStatus.OK)
  cancel(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const dto = parseDto(cancelBodySchema, body);
    return this.adminCancelAppointment.execute({ appointmentId: id, reason: dto.reason, currentUser: user });
  }

  @Post('appointments/:id/reschedule')
  @HttpCode(HttpStatus.OK)
  reschedule(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const dto = parseDto(rescheduleBodySchema, body);
    return this.adminRescheduleAppointment.execute({
      appointmentId: id,
      newStartsAt: dto.newStartsAt,
      currentUser: user,
    });
  }

  @Get('availability')
  availability(@Query() query: unknown) {
    const dto = parseDto(availabilityQuerySchema, query);
    return this.listOpenSlots.execute({
      professionalId: dto.professionalId,
      procedureId: dto.procedureId,
      fromUtc: dto.from,
      toUtc: dto.to,
    });
  }
}
