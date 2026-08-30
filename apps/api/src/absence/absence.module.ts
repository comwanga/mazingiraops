import { Inject, Injectable, Logger, Module, OnApplicationBootstrap, OnModuleDestroy } from "@nestjs/common";
import { AuthorizationModule } from "../authorization/authorization.module";
import { StorageModule } from "../storage/storage.module";
import { APP_CONFIG } from "../config/config.module";
import type { AppConfig } from "../config/config";
import { AbsenceService } from "./absence.service";
import { AbsenceController } from "./absence.controller";
import { AbsenceReminderService } from "./absence-reminder.service";

const REMINDER_INTERVAL_MS = 60 * 60 * 1000;

/**
 * Lightweight in-process job (§32/33): runs leave-reminder processing on
 * startup and hourly. Delivery idempotency is enforced by the
 * (absenceRequestId, reminderDays) unique index, so multiple instances cannot
 * double-send. Disabled in tests, which invoke the service directly.
 */
@Injectable()
export class ReminderScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger("ReminderScheduler");
  private timer: NodeJS.Timeout | undefined;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly reminders: AbsenceReminderService,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    if (this.config.env === "test") return;
    void this.run();
    this.timer = setInterval(() => {
      void this.run();
    }, REMINDER_INTERVAL_MS);
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async run(): Promise<void> {
    try {
      await this.reminders.processReminders();
    } catch (error) {
      this.logger.error(`Reminder processing failed: ${String(error)}`);
    }
  }
}

export const ABSENCE_REMINDER_SERVICE = "ABSENCE_REMINDER_SERVICE";

@Module({
  imports: [AuthorizationModule, StorageModule],
  providers: [
    AbsenceService,
    AbsenceReminderService,
    ReminderScheduler,
    { provide: ABSENCE_REMINDER_SERVICE, useExisting: AbsenceReminderService },
  ],
  controllers: [AbsenceController],
  exports: [AbsenceService, AbsenceReminderService, ABSENCE_REMINDER_SERVICE],
})
export class AbsenceModule {}
