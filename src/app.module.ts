import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CatalogModule } from './modules/catalog';
import { ConversationModule } from './modules/conversation';
import { IdentityModule } from './modules/identity';
import { MessagingModule } from './modules/messaging';
import { MetricsModule } from './modules/metrics';
import { SchedulingModule } from './modules/scheduling';
import { validateEnv } from './shared/config/env.schema';
import { DatabaseModule } from './shared/database/database.module';
import { HealthController } from './shared/http/health.controller';
import { QueueModule } from './shared/queue/bullmq.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validate: validateEnv,
    }),
    DatabaseModule,
    QueueModule,
    IdentityModule,
    ConversationModule,
    MessagingModule,
    CatalogModule,
    SchedulingModule,
    MetricsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
