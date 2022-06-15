import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common'
import { ConsumerSubscribeTopics, Kafka, TopicOffsets } from 'kafkajs'
import {
  readAVSCAsync,
  SchemaRegistry,
} from '@kafkajs/confluent-schema-registry'
import { BuyOrderDto } from '../buy-order.dto'
import { OrderConfirmedDto } from './order-confirmed.dto'
import { v4 as uuidv4 } from 'uuid'

/**
 * This code was written for a demo and should not be used as an example of good practices for real code. The goal of this
 * piece of code is to show a setup using kafka transactions and was written for a Conference presentation.
 */

@Injectable()
export class KafkaService implements OnModuleInit, OnModuleDestroy {
  private inputTopic = 'buy-order'
  private outputTopic = 'order-completed'
  private buyOrderSchemaId: number
  private orderConfirmedSchemaId: number
  private consumerGroupId = 'order-transactional-consumer'
  private transactionId = 'buy-order-transaction'

  private kafka = new Kafka({
    clientId: 'buy-order-svc-id',
    brokers: ['localhost:9092', 'localhost:9093', 'localhost:9094'],
  })

  private registry = new SchemaRegistry({
    host: 'http://localhost:8081',
  })

  private buyOrderProducer = this.kafka.producer({
    idempotent: true, // guarantees that message will not be duplicated on send
  })

  private orderConsumer = this.kafka.consumer({
    groupId: this.consumerGroupId,
    maxInFlightRequests: 1,
  })

  private confirmOrderProducer = this.kafka.producer({
    transactionalId: this.transactionId, // the transaction id used to fence
    maxInFlightRequests: 1, // required by transaction semantics EoS(Exactly once Semantics)
    idempotent: true, // guarantees that message will not be duplicated on send
  })

  private registerBuyOrderSchema = async () => {
    try {
      const buyOrderSchema = await readAVSCAsync('avro/buy-order.avsc')
      const { id } = await this.registry.register(buyOrderSchema)
      return id
    } catch (e) {
      console.log(e)
    }
  }

  private registerOrderConfirmedSchema = async () => {
    try {
      const orderConfirmedSchema = await readAVSCAsync(
        'avro/order-confirmed.avsc',
      )
      const { id } = await this.registry.register(orderConfirmedSchema)
      return id
    } catch (e) {
      console.log(e)
    }
  }

  // create the kafka topic where we are going to produce the data
  private createTopic = async () => {
    try {
      const topicExists = (await this.kafka.admin().listTopics()).includes(
        this.inputTopic,
      )
      if (!topicExists) {
        await this.kafka.admin().createTopics({
          topics: [
            {
              topic: this.inputTopic,
              numPartitions: 3,
              replicationFactor: 3,
            },
            {
              topic: this.outputTopic,
              numPartitions: 3,
              replicationFactor: 3,
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
      value: await this.registry.encode(this.buyOrderSchemaId, buyOrderDto),
    }

    await this.buyOrderProducer.send({
      topic: this.inputTopic,
      messages: [message],
    })
  }

  async processMessages() {
    try {
      await this.orderConsumer.run({
        autoCommit: false,
        eachMessage: async (consumerRecord) => {
          const { topic, partition, message } = consumerRecord
          const buyOrderDto = await this.registry.decode(message.value)
          const orderConfirmed = {
            orderId: uuidv4(),
            asset: buyOrderDto.asset,
            amount: buyOrderDto.amount,
          }
          await this.sendOrderConfirmation(
            orderConfirmed,
            partition,
            message.offset,
          )
        },
      })
    } catch (err) {
      console.log('Error: ', err)
    }
  }

  async sendOrderConfirmation(
    orderConfirmed: OrderConfirmedDto,
    partition: number,
    offset: string,
  ) {
    const message = {
      key: orderConfirmed.orderId,
      value: await this.registry.encode(
        this.orderConfirmedSchemaId,
        orderConfirmed,
      ),
    }
    const topics: TopicOffsets[] = [
      {
        topic: this.inputTopic,
        partitions: [
          {
            partition: partition,
            offset: offset,
          },
        ],
      },
    ]
    const transaction = await this.confirmOrderProducer.transaction()
    try {
      await transaction.send({
        topic: this.outputTopic,
        messages: [message],
      })
      console.log('transaction sent')
      await transaction.sendOffsets({
        consumerGroupId: this.consumerGroupId,
        topics: topics,
      })
      console.log('offsets sent')
      await transaction.commit()
      console.log('transaction committed')
    } catch (e) {
      await transaction.abort()
    }
  }

  async onModuleInit() {
    try {
      await this.createTopic()
      this.buyOrderSchemaId = await this.registerBuyOrderSchema()
      this.orderConfirmedSchemaId = await this.registerOrderConfirmedSchema()
      await this.buyOrderProducer.connect()
      await this.orderConsumer.connect()
      await this.confirmOrderProducer.connect()
      const consumerTopics: ConsumerSubscribeTopics = {
        topics: [this.inputTopic],
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
