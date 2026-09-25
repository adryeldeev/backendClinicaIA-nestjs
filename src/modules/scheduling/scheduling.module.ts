import { InjectQueue } from '@nestjs/bullmq';
import { Module, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';
import { CatalogModule } from '../catalog';
import { IdentityModule } from '../identity';
import { QueueModule } from '../../shared/queue/bullmq.module';
import { registerRepeatableJob } from '../../shared/queue/register-repeatable-job';
import { CLOCK, SystemClock } from '../../shared/kernel/clock';
import { EXPIRE_HOLDS_JOB_ID, SCHEDULING_MAINTENANCE_QUEUE } from '../../shared/queue/queue.tokens';
import { AdminCancelAppointmentUseCase } from './application/admin-cancel-appointment.use-case';
import { AdminRescheduleAppointmentUseCase } from './application/admin-reschedule-appointment.use-case';
import { CancelAppointmentUseCase } from './application/cancel-appointment.use-case';
import { ConfirmAppointmentUseCase } from './application/confirm-appointment.use-case';
import { CreateManualAppointmentUseCase } from './application/create-manual-appointment.use-case';
import { DeleteAvailabilityRuleUseCase } from './application/delete-availability-rule.use-case';
import { ExpireHoldsJob } from './application/expire-holds.job';
import { GetAppointmentResolutionMetricsUseCase } from './application/get-appointment-resolution-metrics.use-case';
import { HoldSlotUseCase } from './application/hold-slot.use-case';
import { ListAppointmentsUseCase } from './application/list-appointments.use-case';
import { ListAppointmentsNeedingReminderUseCase } from './application/list-appointments-needing-reminder.use-case';
import { ListOpenSlotsUseCase } from './application/list-open-slots.use-case';
import { ListPatientAppointmentHistoryUseCase } from './application/list-patient-appointment-history.use-case';
import { ListPatientAppointmentsUseCase } from './application/list-patient-appointments.use-case';
import { MarkReminderSentUseCase } from './application/mark-reminder-sent.use-case';
import { RescheduleAppointmentUseCase } from './application/reschedule-appointment.use-case';
import { UpdateAvailabilityRuleUseCase } from './application/update-availability-rule.use-case';
import { UpdateProcedureUseCase } from './application/update-procedure.use-case';
import { UpdateProfessionalUseCase } from './application/update-professional.use-case';
import { PrismaAppointmentRepository } from './infrastructure/prisma-appointment.repository';
import { AppointmentsAdminController } from './interface/appointments.admin-controller';
import { CatalogAdminController } from './interface/catalog.admin-controller';
import { PatientAppointmentsAdminController } from './interface/patient-appointments.admin-controller';

const EXPIRE_HOLDS_INTERVAL_MS = 60_000;

@Module({
  imports: [CatalogModule, QueueModule, IdentityModule],
  controllers: [AppointmentsAdminController, CatalogAdminController, PatientAppointmentsAdminController],
  providers: [
    PrismaAppointmentRepository,
    { provide: CLOCK, useClass: SystemClock },
    ListOpenSlotsUseCase,
    HoldSlotUseCase,
    ConfirmAppointmentUseCase,
    CancelAppointmentUseCase,
    RescheduleAppointmentUseCase,
    ListPatientAppointmentsUseCase,
    ListPatientAppointmentHistoryUseCase,
    ExpireHoldsJob,
    ListAppointmentsNeedingReminderUseCase,
    MarkReminderSentUseCase,
    ListAppointmentsUseCase,
    CreateManualAppointmentUseCase,
    AdminCancelAppointmentUseCase,
    AdminRescheduleAppointmentUseCase,
    UpdateProfessionalUseCase,
    UpdateProcedureUseCase,
    UpdateAvailabilityRuleUseCase,
    DeleteAvailabilityRuleUseCase,
    GetAppointmentResolutionMetricsUseCase,
  ],
  exports: [
    ListOpenSlotsUseCase,
    HoldSlotUseCase,
    ConfirmAppointmentUseCase,
    CancelAppointmentUseCase,
    RescheduleAppointmentUseCase,
    ListPatientAppointmentsUseCase,
    ListAppointmentsNeedingReminderUseCase,
    MarkReminderSentUseCase,
    GetAppointmentResolutionMetricsUseCase,
  ],
})
export class SchedulingModule implements OnModuleInit {
  constructor(
    @InjectQueue(SCHEDULING_MAINTENANCE_QUEUE) private readonly maintenanceQueue: Queue,
  ) {}

  async onModuleInit(): Promise<void> {
    await registerRepeatableJob(this.maintenanceQueue, EXPIRE_HOLDS_JOB_ID, EXPIRE_HOLDS_INTERVAL_MS);
  }
}
