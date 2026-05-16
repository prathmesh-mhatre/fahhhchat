import { Controller, Get } from "@nestjs/common";
import { productConfig } from "@fahhhchat/config";

@Controller("health")
export class HealthController {
  @Get()
  getHealth() {
    return {
      ok: true,
      service: productConfig.apiServiceName
    };
  }
}
