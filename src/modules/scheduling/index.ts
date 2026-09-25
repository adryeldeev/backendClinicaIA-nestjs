export { SchedulingModule } from './scheduling.module';
export { ListOpenSlotsUseCase, type ListOpenSlotsInput } from './application/list-open-slots.use-case';
export { HoldSlotUseCase, type HoldSlotInput, type HoldSlotResult } from './application/hold-slot.use-case';
export {
  ConfirmAppointmentUseCase,
  type ConfirmAppointmentResult,
} from './application/confirm-appointment.use-case';
export {
  CancelAppointmentUseCase,
  type CancelAppointmentInput,
} from './application/cancel-appointment.use-case';
export {
  RescheduleAppointmentUseCase,
  type RescheduleAppointmentInput,
  type RescheduleAppointmentResult,
} from './application/reschedule-appointment.use-case';
export {
  ListPatientAppointmentsUseCase,
  type PatientAppointmentDto,
} from './application/list-patient-appointments.use-case';
export {
  ListAppointmentsNeedingReminderUseCase,
  type AppointmentReminderDto,
} from './application/list-appointments-needing-reminder.use-case';
export { MarkReminderSentUseCase } from './application/mark-reminder-sent.use-case';
export { SlotTakenError } from './domain/errors/slot-taken.error';
export { HoldExpiredError } from './domain/errors/hold-expired.error';
export { AppointmentNotFoundError } from './domain/errors/appointment-not-found.error';
export { NotAppointmentOwnerError } from './domain/errors/not-appointment-owner.error';
export { InvalidSlotError } from './domain/errors/invalid-slot.error';
export {
  GetAppointmentResolutionMetricsUseCase,
  type AppointmentResolutionMetrics,
} from './application/get-appointment-resolution-metrics.use-case';
