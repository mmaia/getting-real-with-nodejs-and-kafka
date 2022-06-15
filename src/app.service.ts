import { Injectable } from '@nestjs/common'
import { BuyOrderDto } from './buy-order.dto'
import { KafkaService } from './kafka-service/kafka.service'

@Injectable()
export class AppService {
  constructor(private kafkaService: KafkaService) {}

  async sendOrder(buyOrderDto: BuyOrderDto) {
    await this.kafkaService.sendBuyOrder(buyOrderDto)
    console.log('order sent: ', buyOrderDto)
  }

  getHello(): string {
    return 'Getting Real with NodeJS and Kafka. Demo by Bitvavo!'
  }
}
