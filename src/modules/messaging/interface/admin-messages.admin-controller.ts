import { Body, Controller, Param, Post, UseGuards, UseInterceptors } from '@nestjs/common';
import { z } from 'zod';
import { AuditInterceptor, AuthenticatedUser, CurrentUser, Roles, RolesGuard, SessionGuard } from '../../identity';
import { parseDto } from '../../../shared/http/parse-dto';
import { SendAdminMessageUseCase } from '../application/send-admin-message.use-case';

const sendMessageBodySchema = z.object({ body: z.string().min(1) });

/** Ver decisao 2 do plano da Etapa 1: fica em messaging por causa do outbox, mesma rota do contrato. */
@Controller('api/admin/conversations')
@UseGuards(SessionGuard, RolesGuard)
@UseInterceptors(AuditInterceptor)
@Roles('ADMIN', 'RECEPCAO')
export class AdminMessagesAdminController {
  constructor(private readonly sendAdminMessage: SendAdminMessageUseCase) {}

  @Post(':id/messages')
  send(@Param('id') id: string, @Body() body: unknown, @CurrentUser() user: AuthenticatedUser) {
    const dto = parseDto(sendMessageBodySchema, body);
    return this.sendAdminMessage.execute({ conversationId: id, body: dto.body, userId: user.id });
  }
}
