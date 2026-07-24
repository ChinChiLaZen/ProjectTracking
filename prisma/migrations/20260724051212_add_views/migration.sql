-- CreateEnum
CREATE TYPE "ViewVisibility" AS ENUM ('SHARED', 'PERSONAL');

-- CreateTable
CREATE TABLE "views" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "visibility" "ViewVisibility" NOT NULL,
    "creatorId" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "views_organizationId_idx" ON "views"("organizationId");

-- CreateIndex
CREATE INDEX "views_boardId_idx" ON "views"("boardId");

-- AddForeignKey
ALTER TABLE "views" ADD CONSTRAINT "views_boardId_fkey" FOREIGN KEY ("boardId") REFERENCES "boards"("id") ON DELETE CASCADE ON UPDATE CASCADE;
