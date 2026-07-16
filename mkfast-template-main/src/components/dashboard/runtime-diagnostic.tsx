import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import type { ApiSuccess } from '@meiye/contracts';
import {
  runtime_diagnostic_check,
  runtime_diagnostic_description,
  runtime_diagnostic_failed,
  runtime_diagnostic_healthy,
  runtime_diagnostic_pending,
  runtime_diagnostic_title,
} from '@/locale/paraglide/messages';
import { useState } from 'react';

interface CoreHealth {
  service: string;
  status: 'ok';
}

export function RuntimeDiagnostic() {
  const [health, setHealth] = useState<CoreHealth>();
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function checkHealth() {
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/core/diagnostics');
      if (!response.ok) {
        throw new Error(`Core health check failed (${response.status})`);
      }
      const payload = (await response.json()) as ApiSuccess<CoreHealth>;
      setHealth(payload.data);
    } catch {
      setHealth(undefined);
      setError(runtime_diagnostic_failed());
    } finally {
      setPending(false);
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {runtime_diagnostic_title()}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          {runtime_diagnostic_description()}
        </p>
        <Button
          type="button"
          variant="outline"
          onClick={checkHealth}
          disabled={pending}
        >
          {pending ? runtime_diagnostic_pending() : runtime_diagnostic_check()}
        </Button>
        {health && (
          <p className="text-sm text-emerald-700">
            {runtime_diagnostic_healthy({ service: health.service })}
          </p>
        )}
        {error && <p className="text-sm text-destructive">{error}</p>}
      </CardContent>
    </Card>
  );
}
