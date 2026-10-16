import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from './app.module.js';
import { configureApp } from './app.setup.js';
import type { Env } from './config/env.js';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  const port = app
    .get<ConfigService<Env, true>>(ConfigService)
    .get('PORT', { infer: true });
  await app.listen(port);
}
await bootstrap();
