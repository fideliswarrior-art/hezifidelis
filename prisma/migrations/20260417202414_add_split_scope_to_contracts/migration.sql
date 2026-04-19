/*
  Warnings:

  - A unique constraint covering the columns `[contractCode]` on the table `PlayerContract` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `contractCode` to the `PlayerContract` table without a default value. This is not possible if the table is not empty.
  - Added the required column `splitId` to the `PlayerContract` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PlayerContract" ADD COLUMN     "contractCode" TEXT NOT NULL,
ADD COLUMN     "splitId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "PlayerContract_contractCode_key" ON "PlayerContract"("contractCode");

-- CreateIndex
CREATE INDEX "PlayerContract_playerId_splitId_endDate_idx" ON "PlayerContract"("playerId", "splitId", "endDate");

-- AddForeignKey
ALTER TABLE "PlayerContract" ADD CONSTRAINT "PlayerContract_splitId_fkey" FOREIGN KEY ("splitId") REFERENCES "Split"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
