import { Injectable, Logger } from '@nestjs/common';
import * as nodemailer from 'nodemailer';

@Injectable()
export class MailerService {
  private logger = new Logger(MailerService.name);
  private transporter;

  constructor() {
    if (process.env.SMTP_HOST) {
      this.transporter = nodemailer.createTransport({
        host: process.env.SMTP_HOST,
        port: Number(process.env.SMTP_PORT) || 587,
        secure: false,
        auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
      });
    }
  }

  async send(opts: { to: string; subject: string; html: string }) {
    if (!this.transporter) {
      this.logger.warn(`SMTP not configured. Skipping email to ${opts.to}: ${opts.subject}`);
      return;
    }
    try {
      await this.transporter.sendMail({
        from: process.env.SMTP_FROM || 'University System <no-reply@university.edu.pk>',
        ...opts,
      });
    } catch (err) {
      this.logger.error(`Failed to send email to ${opts.to}`, err);
    }
  }
}
