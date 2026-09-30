import nodemailer, { type Transporter } from 'nodemailer';
import type { Logger } from '@b2b/platform-kit';
import type { Mail } from './templates.js';

export interface EmailTransport {
  send(mail: Mail, from: string): Promise<void>;
}

/** Development / test transport: nothing leaves the process; the delivery log is the record. */
export class LogTransport implements EmailTransport {
  readonly sent: Mail[] = [];
  failing = false;
  constructor(private readonly logger?: Logger) {}
  async send(mail: Mail): Promise<void> {
    if (this.failing) throw new Error('smtp unavailable (simulated)');
    this.sent.push(mail);
    // Development only (no SMTP configured): the body carries the action links (invitation, reset), so print it.
    this.logger?.info({ to: mail.to, template: mail.template, subject: mail.subject, text: mail.text }, 'email (log transport)');
  }
}

export class SmtpTransport implements EmailTransport {
  private readonly transporter: Transporter;
  constructor(smtpUrl: string) {
    this.transporter = nodemailer.createTransport(smtpUrl);
  }
  async send(mail: Mail, from: string): Promise<void> {
    await this.transporter.sendMail({ from, to: mail.to, subject: mail.subject, text: mail.text });
  }
}
