import type { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { createValidationPipe } from './common/validation.js';
import type { Env } from './config/env.js';

// main.ts와 e2e 테스트가 같은 설정을 쓰도록 한곳에 둔다
export function configureApp(app: INestApplication) {
  const config = app.get<ConfigService<Env, true>>(ConfigService);

  // API.md 기본 URL이 /v1 이다. /health · /docs는 버전과 관계없이 둔다
  app.setGlobalPrefix('v1', { exclude: ['health'] });
  app.useGlobalPipes(createValidationPipe());
  app.useGlobalFilters(new AllExceptionsFilter());
  app.enableCors({
    origin: config
      .get('CORS_ORIGIN', { infer: true })
      .split(',')
      .map((origin) => origin.trim()),
    credentials: true,
  });
  app.enableShutdownHooks();

  if (config.get('NODE_ENV', { infer: true }) !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('lunchtime API')
        .setDescription(
          '계약: lunchtime-fe/API.md. 사용자 토큰(user)과 어드민 토큰(admin)은 따로 발급한다',
        )
        .setVersion('0.1')
        .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'user')
        .addBearerAuth({ type: 'http', scheme: 'bearer' }, 'admin')
        .build(),
    );
    // /docs: 문서 화면, /docs-json: OpenAPI (프론트 타입 확인용)
    SwaggerModule.setup('docs', app, document, {
      jsonDocumentUrl: 'docs-json',
    });
  }
}
