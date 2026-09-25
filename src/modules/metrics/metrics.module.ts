import { Module } from '@nestjs/common';
import { ConversationModule } from '../conversation';
import { IdentityModule } from '../identity';
import { SchedulingModule } from '../scheduling';
import { CLOCK, SystemClock } from '../../shared/kernel/clock';
import { GetResolutionMetricsUseCase } from './application/get-resolution-metrics.use-case';
import { MetricsAdminController } from './interface/metrics.admin-controller';

/**
 * Modulo puramente de composicao (mesmo formato de messaging, que ja
 * importa conversation+scheduling): so agrega o que ConversationModule e
 * SchedulingModule ja expoem via index.ts, sem tabela propria, sem
 * segunda aresta nova no grafo (ambos ja sao dependencias permitidas de
 * outros modulos "de cima").
 */
@Module({
  imports: [ConversationModule, SchedulingModule, IdentityModule],
  controllers: [MetricsAdminController],
  providers: [GetResolutionMetricsUseCase, { provide: CLOCK, useClass: SystemClock }],
})
export class MetricsModule {}
