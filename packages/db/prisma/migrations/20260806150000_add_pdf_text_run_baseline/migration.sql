/*
  Warnings:

  - Added the required column `baseline` to the `PdfTextRun` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PdfTextRun" ADD COLUMN     "baseline" DOUBLE PRECISION NOT NULL;
