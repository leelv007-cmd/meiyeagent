import { createHash, randomUUID } from 'node:crypto';
import type {
  MailProvider,
  SendEmailResult,
  SendRawEmailParams,
  SendTemplateParams,
} from '../types';

type MailLogEntry = {
  event: 'MAIL_LOG_DELIVERY';
  messageId: string;
  recipientHash: string;
  subject: string;
};

export class LogMailProvider implements MailProvider {
  constructor(
    private readonly write: (entry: MailLogEntry) => void = (entry) =>
      console.info('[mail]', entry)
  ) {}

  getProviderName() {
    return 'log';
  }

  async sendTemplate(params: SendTemplateParams): Promise<SendEmailResult> {
    const { getTemplate } = await import('../render');
    const template = await getTemplate({
      context: params.context,
      template: params.template,
    });
    return this.sendRawEmail({
      html: template.html,
      subject: template.subject,
      text: template.text,
      to: params.to,
    });
  }

  async sendRawEmail(params: SendRawEmailParams): Promise<SendEmailResult> {
    const messageId = `mail-log-${randomUUID()}`;
    this.write({
      event: 'MAIL_LOG_DELIVERY',
      messageId,
      recipientHash: createHash('sha256')
        .update(params.to.trim().toLowerCase())
        .digest('hex'),
      subject: params.subject,
    });
    return { messageId, success: true };
  }
}
