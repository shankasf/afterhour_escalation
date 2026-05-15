-- Replace primary/secondary/fixed ladder with a single active-pool model.
-- Admin toggles staff on duty; calls route in onDutyPriority order through
-- the on-duty subset only.
ALTER TABLE "users"
  ADD COLUMN "on_duty" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "on_duty_priority" INTEGER NOT NULL DEFAULT 100;

CREATE INDEX "users_on_duty_on_duty_priority_idx"
  ON "users"("on_duty", "on_duty_priority");
