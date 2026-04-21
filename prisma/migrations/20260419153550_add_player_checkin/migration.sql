/*
  Warnings:

  - A unique constraint covering the columns `[checkInQrCode]` on the table `Player` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "CheckInMethod" AS ENUM ('QR_SCAN', 'MANUAL_ADMIN');

-- AlterTable
ALTER TABLE "Player" ADD COLUMN     "checkInQrCode" TEXT,
ADD COLUMN     "checkInQrGeneratedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "PlayerCheckIn" (
    "id" TEXT NOT NULL,
    "playerId" TEXT NOT NULL,
    "matchId" TEXT,
    "splitId" TEXT,
    "checkedInAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checkedInById" TEXT NOT NULL,
    "ip" TEXT,
    "method" "CheckInMethod" NOT NULL,
    "notes" TEXT,

    CONSTRAINT "PlayerCheckIn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlayerCheckIn_matchId_idx" ON "PlayerCheckIn"("matchId");

-- CreateIndex
CREATE INDEX "PlayerCheckIn_splitId_idx" ON "PlayerCheckIn"("splitId");

-- CreateIndex
CREATE INDEX "PlayerCheckIn_checkedInAt_idx" ON "PlayerCheckIn"("checkedInAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerCheckIn_playerId_matchId_key" ON "PlayerCheckIn"("playerId", "matchId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerCheckIn_playerId_splitId_key" ON "PlayerCheckIn"("playerId", "splitId");

-- CreateIndex
CREATE UNIQUE INDEX "Player_checkInQrCode_key" ON "Player"("checkInQrCode");

-- AddForeignKey
ALTER TABLE "PlayerCheckIn" ADD CONSTRAINT "PlayerCheckIn_playerId_fkey" FOREIGN KEY ("playerId") REFERENCES "Player"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerCheckIn" ADD CONSTRAINT "PlayerCheckIn_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerCheckIn" ADD CONSTRAINT "PlayerCheckIn_splitId_fkey" FOREIGN KEY ("splitId") REFERENCES "Split"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerCheckIn" ADD CONSTRAINT "PlayerCheckIn_checkedInById_fkey" FOREIGN KEY ("checkedInById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
