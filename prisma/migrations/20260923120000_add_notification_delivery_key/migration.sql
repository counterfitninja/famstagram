-- Add a nullable stable event identity so existing rows remain valid while new notification creation is idempotent.
ALTER TABLE "Notification" ADD COLUMN "deliveryKey" TEXT;
CREATE UNIQUE INDEX "Notification_deliveryKey_key" ON "Notification"("deliveryKey");
