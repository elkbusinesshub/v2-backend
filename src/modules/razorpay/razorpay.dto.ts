import { IsString, Matches, MaxLength } from 'class-validator';

/** What the app hands to Razorpay's checkout to collect a booking's payment. */
export class RazorpayCheckoutDto {
  keyId!: string;
  orderId!: string;
  /** Paise, as the checkout expects. */
  amount!: number;
  currency!: string;
}

/** The three values the checkout returns to the app on success. */
export class VerifyRazorpayPaymentDto {
  @IsString()
  @MaxLength(40)
  razorpayOrderId!: string;

  @IsString()
  @MaxLength(40)
  razorpayPaymentId!: string;

  @Matches(/^[a-f0-9]{64}$/, { message: 'razorpaySignature must be a hex SHA-256 signature' })
  razorpaySignature!: string;
}
