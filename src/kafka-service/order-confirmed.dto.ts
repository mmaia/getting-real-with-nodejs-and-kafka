import { IsInt, IsNotEmpty, IsString } from 'class-validator'

export class OrderConfirmedDto {
  @IsString()
  @IsNotEmpty()
  orderId: string

  @IsString()
  @IsNotEmpty()
  asset: string

  @IsInt()
  @IsNotEmpty()
  amount: number
}
