import EmailButton from '../components/email-button';
import EmailLayout from '../components/email-layout';
import { Text } from '@react-email/components';
import {
  mail_forgot_password_body,
  mail_forgot_password_button,
  mail_forgot_password_greeting,
} from '@/locale/paraglide/messages';

const en = { locale: 'en' as const };

interface ForgotPasswordProps {
  url: string;
  name: string;
}

export default function ForgotPassword({ url, name }: ForgotPasswordProps) {
  return (
    <EmailLayout>
      <Text>
        {mail_forgot_password_greeting(undefined, en)} {name}.
      </Text>
      <Text>{mail_forgot_password_body(undefined, en)}</Text>
      <EmailButton href={url}>
        {mail_forgot_password_button(undefined, en)}
      </EmailButton>
    </EmailLayout>
  );
}
