-- Milestone 12: the admin dashboard and order list look up open "needs
-- attention" entries (PAYMENT_NEEDS_ATTENTION, EMAIL_NEEDS_ATTENTION,
-- MARK_ORDER_PAID with stock shortfalls) by action. Without this index those
-- counts would scan the whole, ever-growing audit log.

-- CreateIndex
CREATE INDEX "audit_logs_action_created_at_idx" ON "audit_logs"("action", "created_at");
