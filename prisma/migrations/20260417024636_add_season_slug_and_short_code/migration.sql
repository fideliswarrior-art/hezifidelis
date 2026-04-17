/*
  Warnings:

  - A unique constraint covering the columns `[slug]` on the table `Season` will be added. If there are existing duplicate values, this will fail.
  - A unique constraint covering the columns `[shortCode]` on the table `Season` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `shortCode` to the `Season` table without a default value. This is not possible if the table is not empty.
  - Added the required column `slug` to the `Season` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Season" ADD COLUMN     "shortCode" TEXT NOT NULL,
ADD COLUMN     "slug" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Season_slug_key" ON "Season"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Season_shortCode_key" ON "Season"("shortCode");

-- CreateIndex
CREATE INDEX "Season_slug_idx" ON "Season"("slug");
