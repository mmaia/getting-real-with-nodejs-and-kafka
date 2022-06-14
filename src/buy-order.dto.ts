import { IsInt, IsNotEmpty, IsString } from 'class-validator'

export class BuyOrderDto {
  @IsString()
  @IsNotEmpty()
  asset: string

  @IsInt()
  @IsNotEmpty()
  quantity: number
}
