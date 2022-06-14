import { Body, Controller, Get, Post } from '@nestjs/common'
import { AppService } from './app.service'
import { BuyOrderDto } from './buy-order.dto'

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Post()
  async sendOrder(@Body() buyOrderDto: BuyOrderDto) {
  }

  // generated
  @Get()
  getHello(): string {
    return this.appService.getHello()
  }
}
