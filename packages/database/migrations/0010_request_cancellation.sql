ALTER TABLE "task_messages" DROP CONSTRAINT "task_messages_status_valid";
--> statement-breakpoint
ALTER TABLE "task_messages" ADD CONSTRAINT "task_messages_status_valid" CHECK ("status" IN ('queued','running','completed','failed','cancelling','cancelled'));
