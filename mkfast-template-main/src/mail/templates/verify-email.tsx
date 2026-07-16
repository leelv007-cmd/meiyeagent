import EmailButton from '../components/email-button';
import EmailLayout from '../components/email-layout';
import { Text } from '@react-email/components';
import {
  mail_verify_email_body,
  mail_verify_email_button,
  mail_verify_email_greeting,
} from '@/locale/paraglide/messages';

const en = { locale: 'en' as const };

interface VerifyEmailProps {
  url: string;
  name: string;
}

export default function VerifyEmail({ url, name }: VerifyEmailProps) {
  return (
    <EmailLayout>
      <Text>
        {mail_verify_email_greeting(undefined, en)} {name}.
      </Text>
      <Text>{mail_verify_email_body(undefined, en)}</Text>
      <EmailButton href={url}>
        {mail_verify_email_button(undefined, en)}
      </EmailButton>
    </EmailLayout>
  );
}
