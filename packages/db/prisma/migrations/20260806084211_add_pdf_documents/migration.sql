-- CreateTable
CREATE TABLE "PdfDocument" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "originalFileUrl" TEXT NOT NULL,
    "pageCount" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PdfDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PdfPage" (
    "id" TEXT NOT NULL,
    "pdfDocumentId" TEXT NOT NULL,
    "pageIndex" INTEGER NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "backgroundImageUrl" TEXT NOT NULL,

    CONSTRAINT "PdfPage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PdfTextRun" (
    "id" TEXT NOT NULL,
    "pdfPageId" TEXT NOT NULL,
    "x" DOUBLE PRECISION NOT NULL,
    "y" DOUBLE PRECISION NOT NULL,
    "width" DOUBLE PRECISION NOT NULL,
    "height" DOUBLE PRECISION NOT NULL,
    "fontFamily" TEXT NOT NULL,
    "fontSource" TEXT NOT NULL,
    "embeddedFontUrl" TEXT,
    "fontSize" DOUBLE PRECISION NOT NULL,
    "color" TEXT NOT NULL,
    "backgroundColor" TEXT NOT NULL,
    "originalText" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PdfTextRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PdfDocument_userId_updatedAt_idx" ON "PdfDocument"("userId", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "PdfPage_pdfDocumentId_pageIndex_key" ON "PdfPage"("pdfDocumentId", "pageIndex");

-- CreateIndex
CREATE INDEX "PdfTextRun_pdfPageId_idx" ON "PdfTextRun"("pdfPageId");

-- AddForeignKey
ALTER TABLE "PdfDocument" ADD CONSTRAINT "PdfDocument_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PdfPage" ADD CONSTRAINT "PdfPage_pdfDocumentId_fkey" FOREIGN KEY ("pdfDocumentId") REFERENCES "PdfDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PdfTextRun" ADD CONSTRAINT "PdfTextRun_pdfPageId_fkey" FOREIGN KEY ("pdfPageId") REFERENCES "PdfPage"("id") ON DELETE CASCADE ON UPDATE CASCADE;
