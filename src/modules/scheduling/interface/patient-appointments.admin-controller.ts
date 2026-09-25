import { Controller, Get, Param, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuditInterceptor, Roles, RolesGuard, SessionGuard } from '../../identity';
import { ListPatientAppointmentHistoryUseCase } from '../application/list-patient-appointment-history.use-case';

/**
 * GET /api/admin/patients/:id/appointments (achado do usuario, 2026-09-25).
 * Vive em `scheduling` (dono de Appointment), nao em `conversation` (dono
 * de Patient, onde o resto de /patients/* mora) — mesma decisao ja tomada
 * pra `catalog.admin-controller.ts` (Etapa 3) e `admin-messages.admin-
 * controller.ts` (Etapa 1): o modulo dono do dado serve a rota, sem criar
 * aresta nova no grafo so pra "o caminho HTTP comecar igual". O front bate
 * na URL, nao sabe nem precisa saber qual controller/modulo atende.
 */
@Controller('api/admin/patients')
@UseGuards(SessionGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('ADMIN', 'RECEPCAO')
export class PatientAppointmentsAdminController {
  constructor(private readonly listHistory: ListPatientAppointmentHistoryUseCase) {}

  @Get(':id/appointments')
  history(@Param('id') id: string) {
    return this.listHistory.execute(id);
  }
}
