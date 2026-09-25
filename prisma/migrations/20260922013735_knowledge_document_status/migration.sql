-- CreateEnum
CREATE TYPE "KnowledgeDocumentStatus" AS ENUM ('PENDING', 'RUNNING', 'READY', 'FAILED');

-- AlterTable
ALTER TABLE "KnowledgeDocument" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "errorMessage" TEXT,
ADD COLUMN     "status" "KnowledgeDocumentStatus" NOT NULL DEFAULT 'READY';
