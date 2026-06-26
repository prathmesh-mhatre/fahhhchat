import cookieParser from "cookie-parser";
import { NestFactory } from "@nestjs/core";
import { webOrigins } from "./cors-origins";
import { AppModule } from "./modules/app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.enableCors({
    origin: webOrigins(),
    credentials: true
  });

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
}

void bootstrap();
