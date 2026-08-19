import {
  pricing_checkout_failed,
  pricing_checkout_loading,
} from '@/locale/paraglide/messages';
import {
  createCheckoutSession,
  createCreditPackageCheckoutSession,
} from '@/api/payment';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { IconLoader2 } from '@tabler/icons-react';
import { useState } from 'react';
import { toast } from 'sonner';
interface CheckoutButtonProps {
  planId: 'starter' | 'growth' | 'pro';
  cycle: 'single_month' | 'monthly' | 'yearly';
  metadata?: Record<string, string>;
  variant?:
    | 'default'
    | 'outline'
    | 'destructive'
    | 'secondary'
    | 'ghost'
    | 'link'
    | null;
  size?: 'default' | 'sm' | 'lg' | 'icon' | null;
  className?: string;
  'data-testid'?: string;
  children?: React.ReactNode;
}
export function CheckoutButton({
  planId,
  cycle,
  metadata,
  variant = 'default',
  size = 'default',
  className,
  'data-testid': dataTestId,
  children,
}: CheckoutButtonProps) {
  const [isLoading, setIsLoading] = useState(false);
  const handleClick = async () => {
    try {
      setIsLoading(true);
      // merge metadata with existing metadata
      const mergedMetadata = metadata ? { ...metadata } : {};
      const result = await createCheckoutSession({
        data: {
          cycle,
          planId,
          metadata:
            Object.keys(mergedMetadata).length > 0 ? mergedMetadata : undefined,
        },
      });
      if (result?.url) {
        window.location.href = result.url;
      } else {
        toast.error(pricing_checkout_failed());
      }
    } catch (err) {
      console.error('Checkout error:', err);
      toast.error(pricing_checkout_failed());
    } finally {
      setIsLoading(false);
    }
  };
  return (
    <Button
      variant={variant}
      size={size}
      className={cn(className)}
      data-testid={dataTestId}
      onClick={handleClick}
      disabled={isLoading}
    >
      {isLoading ? (
        <>
          <IconLoader2 className="mr-2 size-4 animate-spin" />
          {pricing_checkout_loading()}
        </>
      ) : (
        children
      )}
    </Button>
  );
}

export function CreditPackageCheckoutButton({
  offerId,
  className,
  'data-testid': dataTestId,
  children,
}: {
  offerId: string;
  className?: string;
  'data-testid'?: string;
  children?: React.ReactNode;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const handleClick = async () => {
    try {
      setIsLoading(true);
      const result = await createCreditPackageCheckoutSession({
        data: { offerId },
      });
      if (result?.url) {
        window.location.href = result.url;
      } else {
        toast.error(pricing_checkout_failed());
      }
    } catch (err) {
      console.error('Credit package checkout error:', err);
      toast.error(pricing_checkout_failed());
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button
      className={cn(className)}
      data-testid={dataTestId}
      disabled={isLoading}
      onClick={handleClick}
      variant="outline"
    >
      {isLoading ? (
        <>
          <IconLoader2 className="mr-2 size-4 animate-spin" />
          {pricing_checkout_loading()}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
