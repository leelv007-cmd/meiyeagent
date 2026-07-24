import { createFileRoute, redirect } from '@tanstack/react-router';

export const Route = createFileRoute('/heroui-spike/')({
  beforeLoad: () => {
    throw redirect({ to: '/heroui-spike/chat' });
  },
});
