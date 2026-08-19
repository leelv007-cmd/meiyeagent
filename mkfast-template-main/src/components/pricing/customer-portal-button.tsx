import {
  pricing_customer_portal_failed,
  pricing_customer_portal_loading,
} from '@/locale/paraglide/messages';
import { createCustomerPortalSession } from '@/api/payment';
import { Button } from '@/components/ui/button';
import { IconLoader2 } from '@tabler/icons-react';
import { useState } from 'react';
import { toast } from 'sonner';
interface CustomerPortalButtonProps {
  userId: string;
  ready: boolean;
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
export function CustomerPortalButton({
  ready,
  variant = 'default',
  size = 'default',
  className,
  'data-testid': dataTestId = 'customer-portal',
  children,
}: Omit<CustomerPortalButtonProps, 'userId'> & {
  userId?: string;
}) {
  const [isLoading, setIsLoading] = useState(false);
  const handleClick = async () => {
    if (!ready) return;
    try {
      setIsLoading(true);
      const result = await createCustomerPortalSession({
        data: {},
      });
      if (result?.url) {
        window.location.href = result.url;
      } else {
        toast.error(pricing_customer_portal_failed());
      }
    } catch (err) {
      console.error('Customer portal error:', err);
      toast.error(pricing_customer_portal_failed());
    } finally {
      setIsLoading(false);
    }
  };
  return (
    <Button
      variant={variant}
      size={size}
      className={className}
      data-testid={dataTestId}
      onClick={handleClick}
      disabled={!ready || isLoading}
    >
      {isLoading ? (
        <>
          <IconLoader2 className="mr-2 size-4 animate-spin" />
          {pricing_customer_portal_loading()}
        </>
      ) : (
        children
      )}
    </Button>
  );
}
