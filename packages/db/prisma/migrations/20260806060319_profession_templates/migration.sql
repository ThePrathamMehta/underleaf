-- CreateTable
CREATE TABLE "Profession" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "iconKey" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "Profession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TemplateProfession" (
    "templateId" TEXT NOT NULL,
    "professionId" TEXT NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "TemplateProfession_pkey" PRIMARY KEY ("templateId","professionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Profession_slug_key" ON "Profession"("slug");

-- CreateIndex
CREATE INDEX "Profession_sortOrder_idx" ON "Profession"("sortOrder");

-- CreateIndex
CREATE INDEX "TemplateProfession_professionId_rank_idx" ON "TemplateProfession"("professionId", "rank");

-- AddForeignKey
ALTER TABLE "TemplateProfession" ADD CONSTRAINT "TemplateProfession_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TemplateProfession" ADD CONSTRAINT "TemplateProfession_professionId_fkey" FOREIGN KEY ("professionId") REFERENCES "Profession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
