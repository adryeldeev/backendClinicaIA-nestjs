import { Inject, Injectable } from '@nestjs/common';
import { Appointment, Professional } from '@prisma/client';
import {
  ManageProfessionalsUseCase,
  type UpdateProfessionalInput as CatalogUpdateProfessionalInput,
} from '../../catalog';
import { CLOCK, type Clock } from '../../../shared/kernel/clock';
import { PrismaAppointmentRepository } from '../infrastructure/prisma-appointment.repository';

export interface UpdateProfessionalResult {
  professional: Professional;
  /**
   * So preenchido quando `active` vira false (Caso 1 do plano da Etapa 3)
   * — consultas confirmadas futuras que continuam validas, mas que o
   * painel precisa saber que existem. Nunca canceladas nem movidas aqui.
   */
  affectedAppointments: Appointment[];
}

/**
 * Wrapper em scheduling (nao em catalog) de proposito: catalog nao pode
 * depender de scheduling (grafo de modulos), mas avisar sobre consulta
 * futura confirmada exige ler Appointment, que scheduling e quem possui.
 * A escrita em si (ManageProfessionalsUseCase) continua pura, sem saber
 * de Appointment.
 */
@Injectable()
export class UpdateProfessionalUseCase {
  constructor(
    private readonly manageProfessionals: ManageProfessionalsUseCase,
    private readonly appointments: PrismaAppointmentRepository,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async execute(input: CatalogUpdateProfessionalInput): Promise<UpdateProfessionalResult> {
    const professional = await this.manageProfessionals.update(input);

    const affectedAppointments =
      input.active === false
        ? await this.appointments.listFutureConfirmedByProfessional(input.id, this.clock.now())
        : [];

    return { professional, affectedAppointments };
  }
}
