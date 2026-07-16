import {
  settings_security_delete_account_button,
  settings_security_delete_account_cancel,
  settings_security_delete_account_confirm,
  settings_security_delete_account_confirm_description,
  settings_security_delete_account_confirm_title,
  settings_security_delete_account_deleting,
  settings_security_delete_account_description,
  settings_security_delete_account_fail,
  settings_security_delete_account_success,
  settings_security_delete_account_title,
  settings_security_delete_account_warning,
} from '@/locale/paraglide/messages';
import { FormError } from '@/components/shared/form-error';
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { authClient } from '@/auth/client';
import { cn } from '@/lib/utils';
import { useState } from 'react';
import { toast } from 'sonner';
import { useNavigate } from '@tanstack/react-router';
export function DeleteAccountCard() {
  const [isDeleting, setIsDeleting] = useState(false);
  const [showConfirmation, setShowConfirmation] = useState(false);
  const [error, setError] = useState<string | undefined>('');
  const { data: session, refetch } = authClient.useSession();
  const navigate = useNavigate();
  const user = session?.user;
  if (!user) return null;
  const handleDeleteAccount = async () => {
    await authClient.deleteUser(
      {},
      {
        onRequest: () => {
          setIsDeleting(true);
          setError('');
        },
        onResponse: () => {
          setIsDeleting(false);
          setShowConfirmation(false);
        },
        onSuccess: () => {
          toast.success(settings_security_delete_account_success());
          refetch();
          navigate({ to: '/' });
        },
        onError: () => {
          setError(settings_security_delete_account_fail());
          toast.error(settings_security_delete_account_fail());
        },
      }
    );
  };
  return (
    <Card
      className={cn(
        'w-full border-destructive/50 overflow-hidden pt-6 pb-0 flex flex-col'
      )}
    >
      <CardHeader>
        <CardTitle className="text-lg font-bold text-destructive">
          {settings_security_delete_account_title()}
        </CardTitle>
        <CardDescription>
          {settings_security_delete_account_description()}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex-1">
        <p className="text-sm text-muted-foreground">
          {settings_security_delete_account_warning()}
        </p>
        {error && (
          <div className="mt-4">
            <FormError message={error} />
          </div>
        )}
      </CardContent>
      <CardFooter className="mt-2 px-6 py-4 flex justify-end items-center bg-muted rounded-none">
        <Button variant="destructive" onClick={() => setShowConfirmation(true)}>
          {settings_security_delete_account_button()}
        </Button>
      </CardFooter>

      <AlertDialog open={showConfirmation} onOpenChange={setShowConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="text-destructive">
              {settings_security_delete_account_confirm_title()}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {settings_security_delete_account_confirm_description()}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="flex justify-end gap-3">
            <Button
              variant="outline"
              onClick={() => setShowConfirmation(false)}
            >
              {settings_security_delete_account_cancel()}
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteAccount}
              disabled={isDeleting}
            >
              {isDeleting
                ? settings_security_delete_account_deleting()
                : settings_security_delete_account_confirm()}
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
