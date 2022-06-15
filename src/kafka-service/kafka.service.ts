import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { Kafka } from 'kafkajs'
import {
  readAVSCAsync,
  SchemaRegistry,
} from '@kafkajs/confluent-schema-registry'
import { BuyOrderDto } from '../buy-order.dto'

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private INPUT_TOPIC = 'buy-order'
  private OUTPUT_TOPIC = 'order-completed'
  private schemaId: number

  private kafka = new Kafka({
    clientId: 'buy-order-svc-id',
    brokers: ['localhost:9092'],
  })

  private registry = new SchemaRegistry({
    host: 'http://localhost:8081',
  })

  private producer = this.kafka.producer({
    transactionalId: 'buy-order-transaction',
    maxInFlightRequests: 1,
    idempotent: true,
  })

  private registerSchema = async () => {
    try {
      const schema = await readAVSCAsync('./avro/buy-order.avsc')
      const { id } = await this.registry.register(schema)
      return id
    } catch (e) {
      console.log(e)
    }
  }

  // create the kafka topic where we are going to produce the data
  private createTopic = async () => {
    try {
      const topicExists = (await this.kafka.admin().listTopics()).includes(
        this.INPUT_TOPIC,
      )
      if (!topicExists) {
        await this.kafka.admin().createTopics({
          topics: [
            {
              topic: this.INPUT_TOPIC,
              numPartitions: 1,
              replicationFactor: 1,
            },
            {
              topic: this.OUTPUT_TOPIC,
              numPartitions: 1,
              replicationFactor: 1,
            },
          ],
        })
      }
    } catch (error) {
      console.log(error)
    }
  }

  async sendMessage(buyOrderDto: BuyOrderDto) {
    const message = {
      key: buyOrderDto.asset,
      value: await this.registry.encode(this.schemaId, buyOrderDto),
    }

    await this.producer.send({
      topic: this.INPUT_TOPIC,
      messages: [message],
      acks: -1,
    })
  }

  async onModuleInit() {
    await this.createTopic()
    this.schemaId = await this.registerSchema()
    await this.producer.connect()
  }

  async onModuleDestroy() {
    await this.producer.disconnect()
  }
}
