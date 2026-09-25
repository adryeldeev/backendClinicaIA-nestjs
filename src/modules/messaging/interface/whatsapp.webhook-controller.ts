import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { Env } from '../../../shared/config/env.schema';
import { ReceiveWebhookUseCase } from '../application/receive-webhook.use-case';
import { InvalidSignatureError } from '../domain/errors/invalid-signature.error';
import type { WhatsappWebhookPayload } from '../domain/whatsapp-webhook-payload';

@Controller('webhooks/whatsapp')
export class WhatsappWebhookController {
  constructor(
    private readonly config: ConfigService<Env, true>,
    private readonly receiveWebhook: ReceiveWebhookUseCase,
  ) {}

  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') verifyToken: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    const expectedToken = this.config.get('WHATSAPP_VERIFY_TOKEN', { infer: true });
    if (mode === 'subscribe' && verifyToken === expectedToken) {
      return challenge;
    }
    throw new ForbiddenException('Verify token invalido');
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
  ): Promise<{ status: 'ok' }> {
    if (!req.rawBody) {
      throw new BadRequestException('Corpo bruto da requisição indisponível.');
    }

    try {
      this.receiveWebhook.verifySignature(req.rawBody, signature);
    } catch (error) {
      if (error instanceof InvalidSignatureError) {
        throw new UnauthorizedException(error.message);
      }
      throw error;
    }

    const payload = JSON.parse(req.rawBody.toString('utf8')) as WhatsappWebhookPayload;
    await this.receiveWebhook.execute(payload);

    return { status: 'ok' };
  }
}
