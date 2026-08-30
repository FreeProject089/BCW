-- Counting views and downloads on a hosted asset, when somebody asks for it.
--
-- OFF by default, and that default is the design. Counting means a write on every public GET,
-- and the assets this table was built for are installers and `links.json` — files fetched by
-- an application on a timer, where a counter measures polling rather than interest and costs a
-- row update per poll to say so. A media library is the opposite case: somebody uploads a
-- video and wants to know if anyone watched it.
--
-- So it is per asset, and it is asked for.

ALTER TABLE "PlatformAsset"
  ADD COLUMN "countStats" BOOLEAN NOT NULL DEFAULT false,
  -- Two numbers and not one, because they are two different events and a single "hits" would
  -- answer neither question. A view is the file rendered in place — an <img>, a <video>, the
  -- dashboard's own viewer. A download is the bytes taken away. The caller says which by
  -- asking for `?inline=1` or not, rather than the server guessing from a header.
  ADD COLUMN "views" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "downloads" INTEGER NOT NULL DEFAULT 0,
  -- What the dashboard groups and filters by, derived from the content type at upload:
  -- image · video · audio · document · archive · other. Stored rather than recomputed so a
  -- listing does not parse a MIME string per row, and so a file whose type was corrected once
  -- stays where the admin put it.
  ADD COLUMN "media" TEXT NOT NULL DEFAULT '';

-- The library view lists newest first and filters by kind.
CREATE INDEX "PlatformAsset_media_updatedAt_idx" ON "PlatformAsset"("media", "updatedAt");
