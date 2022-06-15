import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConsumerSubscribeTopics, Kafka } from 'kafkajs'
import {
  readAVSCAsync,
  SchemaRegistry,
} from '@kafkajs/confluent-schema-registry'
import { BuyOrderDto } from '../buy-order.dto'
import { OrderConfirmedDto } from './order-confirmed.dto'

/**
 * This code was written for a demo and should not be used as an example of good practices for real code. The goal of this
 * piece of code is to show a setup using kafka transactions and was written for a Conference presentation.
 */

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  INPUT_TOPIC = 'buy-order'
  OUTPUT_TOPIC = 'order-completed'
  private schemaId: number

  private kafka = new Kafka({
    clientId: 'buy-order-svc-id',
    brokers: ['localhost:9092'],
  })

  private registry = new SchemaRegistry({
    host: 'http://localhost:8081',
  })

  private buyOrderProducer = this.kafka.producer({
    idempotent: true, // guarantees that message will not be duplicated on send
  })

  private orderConsumer = this.kafka.consumer({
    groupId: 'order-transactional-consumer',
  })

  private confirmOrderProducer = this.kafka.producer({
    transactionalId: 'buy-order-transaction', // the transaction id used to fence
    maxInFlightRequests: 1, // required by transaction semantics EoS(Exactly once Semantics)
    idempotent: true, // guarantees that message will not be duplicated on send
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

  async sendBuyOrder(buyOrderDto: BuyOrderDto) {
    const message = {
      key: buyOrderDto.asset,
      value: await this.registry.encode(this.schemaId, buyOrderDto),
    }

    await this.buyOrderProducer.send({
      topic: this.INPUT_TOPIC,
      messages: [message],
    })
  }

  async processMessages() {
    try {
      await this.orderConsumer.run({
        eachMessage: async (consumerRecord) => {
          const { topic, partition, message } = consumerRecord
          const prefix = `${topic}[${partition} | ${message.offset}] / ${message.timestamp}`
          console.log(
            `Message processed - ${prefix} -> ${
              message.key
            }#${await this.registry.decode(message.value)}`,
          )
        },
      })
    } catch (err) {
      console.log('Error: ', err)
    }
  }

  async sendOrderConfirmation(orderConfirmed: OrderConfirmedDto) {
    const message = {
      key: orderConfirmed.orderId,
      value: await this.registry.encode(this.schemaId, orderConfirmed),
    }
    const transaction = await this.buyOrderProducer.transaction()
    try {
      await this.buyOrderProducer.send({
        topic: this.OUTPUT_TOPIC,
        messages: [message],
        acks: -1,
      })
    } catch (e) {
      await transaction.abort()
    }
  }

  async onModuleInit() {
    try {
      await this.createTopic()
      this.schemaId = await this.registerSchema()
      await this.buyOrderProducer.connect()
      await this.orderConsumer.connect()
      const consumerTopics: ConsumerSubscribeTopics = {
        topics: [this.INPUT_TOPIC],
        fromBeginning: false,
      }
      await this.orderConsumer.subscribe(consumerTopics)
      await this.processMessages()
      console.log('Yey! App with Kafka Connection setup initialized!')
    } catch (err) {
      console.log('Ooops error: ', err)
    }
  }

  async onModuleDestroy() {
    await this.buyOrderProducer.disconnect()
  }
}
