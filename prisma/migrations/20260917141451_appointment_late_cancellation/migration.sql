/*
  Warnings:

  - You are about to drop the column `content_tsv` on the `KnowledgeChunk` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "knowledge_chunk_tsv_idx";

-- AlterTable
ALTER TABLE "Appointment" ADD COLUMN     "lateCancellation" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "KnowledgeChunk" DROP COLUMN "content_tsv";
