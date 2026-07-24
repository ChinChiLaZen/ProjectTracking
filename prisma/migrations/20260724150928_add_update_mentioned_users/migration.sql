-- AlterTable
ALTER TABLE "updates" ADD COLUMN     "mentionedUserIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "updates_mentionedUserIds_idx" ON "updates" USING GIN ("mentionedUserIds");
