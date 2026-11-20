CREATE TABLE "review_events" (
    "id" BIGSERIAL NOT NULL,
    "product_id" INTEGER NOT NULL,
    "origin" VARCHAR(64) NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT "review_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "review_events_created_at_idx" ON "review_events"("created_at");
