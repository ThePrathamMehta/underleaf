/*
  Warnings:

  - Added the required column `backgroundVersion` to the `PdfPage` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "PdfPage" ADD COLUMN     "backgroundVersion" TEXT NOT NULL;
