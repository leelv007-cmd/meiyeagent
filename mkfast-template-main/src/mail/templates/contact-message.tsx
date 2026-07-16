import EmailLayout from '../components/email-layout';
import { Text } from '@react-email/components';
import {
  mail_contact_message_email,
  mail_contact_message_message,
  mail_contact_message_name,
} from '@/locale/paraglide/messages';

const en = { locale: 'en' as const };

interface ContactMessageProps {
  name: string;
  email: string;
  message: string;
}

export default function ContactMessage({
  name,
  email,
  message,
}: ContactMessageProps) {
  return (
    <EmailLayout>
      <Text>
        {mail_contact_message_name(undefined, en)} {name}
      </Text>
      <Text>
        {mail_contact_message_email(undefined, en)} {email}
      </Text>
      <Text>
        {mail_contact_message_message(undefined, en)} {message}
      </Text>
    </EmailLayout>
  );
}
