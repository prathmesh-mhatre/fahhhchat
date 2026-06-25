import cookieParser from "cookie-parser";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./modules/app.module";

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.use(cookieParser());
  app.enableCors({
    origin: [
      process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3001",
      process.env.NEXT_PUBLIC_WWW_URL ?? "http://localhost:3000"
    ],
    credentials: true
  });

  const port = Number(process.env.PORT ?? 4000);
  await app.listen(port);
}

void bootstrap();
