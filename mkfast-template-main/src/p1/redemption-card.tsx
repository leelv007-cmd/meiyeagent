import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useRef, useState } from 'react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  settings_redemption_code_label,
  settings_redemption_code_placeholder,
  settings_redemption_description,
  settings_redemption_failed,
  settings_redemption_submit,
  settings_redemption_success,
  settings_redemption_title,
} from '@/locale/paraglide/messages';
import { commandP1 } from '@/p1/client';
import { p1QueryKeys } from '@/p1/query-keys';

export function RedemptionCard() {
  const queryClient = useQueryClient();
  const [code, setCode] = useState('');
  const pendingKey = useRef<string | undefined>(undefined);
  const mutation = useMutation({
    mutationFn: () => {
      pendingKey.current ??= crypto.randomUUID();
      return commandP1(
        'redemptions',
        { action: 'redeem', payload: { code: code.trim() } },
        `redeem-code-${pendingKey.current}`
      );
    },
    onSuccess: () => {
      pendingKey.current = undefined;
      setCode('');
      toast.success(settings_redemption_success());
      void queryClient.invalidateQueries({
        queryKey: p1QueryKeys.request('entitlements', 'projection'),
      });
    },
    onError: () => {
      toast.error(settings_redemption_failed());
    },
  });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{settings_redemption_title()}</CardTitle>
        <CardDescription>{settings_redemption_description()}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="grid flex-1 gap-2">
          <Label htmlFor="workspace-redemption-code">
            {settings_redemption_code_label()}
          </Label>
          <Input
            autoComplete="off"
            id="workspace-redemption-code"
            maxLength={64}
            placeholder={settings_redemption_code_placeholder()}
            value={code}
            onChange={(event) => {
              pendingKey.current = undefined;
              setCode(event.target.value.toUpperCase());
            }}
          />
        </div>
        <Button
          type="button"
          disabled={mutation.isPending || code.trim().length < 4}
          onClick={() => mutation.mutate()}
        >
          {settings_redemption_submit()}
        </Button>
      </CardContent>
    </Card>
  );
}
