-- AlterTable
ALTER TABLE `service_bookings` ADD COLUMN `cancellationFee` DECIMAL(10, 2) NOT NULL DEFAULT 0,
    MODIFY `status` ENUM('AWAITING_PAYMENT', 'PENDING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
    MODIFY `paymentMethod` VARCHAR(20) NOT NULL DEFAULT 'razorpay';

-- CreateTable
CREATE TABLE `service_payments` (
    `id` CHAR(36) NOT NULL,
    `bookingId` CHAR(36) NOT NULL,
    `status` ENUM('CREATED', 'CAPTURED', 'REFUND_PENDING', 'REFUNDED') NOT NULL DEFAULT 'CREATED',
    `amount` DECIMAL(10, 2) NOT NULL,
    `razorpayOrderId` VARCHAR(40) NOT NULL,
    `razorpayPaymentId` VARCHAR(40) NULL,
    `method` VARCHAR(20) NULL,
    `refundAmount` DECIMAL(10, 2) NULL,
    `razorpayRefundId` VARCHAR(40) NULL,
    `capturedAt` DATETIME(3) NULL,
    `refundedAt` DATETIME(3) NULL,
    `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` DATETIME(3) NOT NULL,

    UNIQUE INDEX `service_payments_bookingId_key`(`bookingId`),
    UNIQUE INDEX `service_payments_razorpayOrderId_key`(`razorpayOrderId`),
    UNIQUE INDEX `service_payments_razorpayPaymentId_key`(`razorpayPaymentId`),
    UNIQUE INDEX `service_payments_razorpayRefundId_key`(`razorpayRefundId`),
    PRIMARY KEY (`id`)
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

-- AddForeignKey
ALTER TABLE `service_payments` ADD CONSTRAINT `service_payments_bookingId_fkey` FOREIGN KEY (`bookingId`) REFERENCES `service_bookings`(`id`) ON DELETE CASCADE ON UPDATE CASCADE;
