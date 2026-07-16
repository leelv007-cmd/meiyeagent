import EmailLayout from '../components/email-layout';
import { Heading, Text } from '@react-email/components';
import {
  mail_subscribe_newsletter_body,
  mail_subscribe_newsletter_title,
} from '@/locale/paraglide/messages';

const en = { locale: 'en' as const };

export default function SubscribeNewsletter() {
  return (
    <EmailLayout>
      <Heading className="text-xl">
        {mail_subscribe_newsletter_title(undefined, en)}
      </Heading>
      <Text>{mail_subscribe_newsletter_body(undefined, en)}</Text>
    </EmailLayout>
  );
}
