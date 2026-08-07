import {
  settings_profile_avatar_description,
  settings_profile_avatar_fail,
  settings_profile_avatar_hint,
  settings_profile_avatar_success,
  settings_profile_avatar_title,
  settings_profile_avatar_too_large,
  settings_profile_avatar_upload_avatar,
  settings_profile_avatar_uploading,
} from '@/locale/paraglide/messages';
import { FormError } from '@/components/shared/form-error';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { buttonVariants } from '@/components/ui/button';
import {
  SettingsRow,
  SettingsRowFooter,
  SettingsRowHeader,
} from '@/components/settings/settings-section';
import { websiteConfig } from '@/config/website';
import { authClient } from '@/auth/client';
import { useUploadUserAvatar } from '@/hooks/use-user-files';
import { cn } from '@/lib/utils';
import { IconUser } from '@tabler/icons-react';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { AVATAR_MAX_FILE_SIZE } from '@/storage/upload-policy';
interface UpdateAvatarCardProps {
  className?: string;
}
/**
 * Update user avatar card
 */
export function UpdateAvatarCard({ className }: UpdateAvatarCardProps) {
  const [error, setError] = useState<string | undefined>('');
  const [avatarUrl, setAvatarUrl] = useState('');
  const { data: session, refetch } = authClient.useSession();
  const uploadMutation = useUploadUserAvatar();
  useEffect(() => {
    if (session?.user?.image) setAvatarUrl(session.user.image);
  }, [session]);
  if (!websiteConfig.storage?.enable) return null;
  const user = session?.user;
  if (!user) return null;
  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handleFileUpload(file);
    // Reset so selecting the same file again triggers onChange
    e.target.value = '';
  };
  const handleFileUpload = (file: File) => {
    if (file.size > AVATAR_MAX_FILE_SIZE) {
      setError(settings_profile_avatar_too_large());
      toast.error(settings_profile_avatar_too_large());
      return;
    }
    setError('');
    const tempUrl = URL.createObjectURL(file);
    setAvatarUrl(tempUrl);
    uploadMutation.mutate(file, {
      onSuccess: (result) => {
        authClient.updateUser(
          { image: result.url },
          {
            onSuccess: () => {
              setAvatarUrl(result.url);
              URL.revokeObjectURL(tempUrl);
              toast.success(settings_profile_avatar_success());
              refetch();
            },
            onError: () => {
              setError(settings_profile_avatar_fail());
              if (session?.user?.image) setAvatarUrl(session.user.image);
              URL.revokeObjectURL(tempUrl);
              toast.error(settings_profile_avatar_fail());
            },
          }
        );
      },
      onError: () => {
        const msg = settings_profile_avatar_fail();
        setError(msg);
        if (session?.user?.image) setAvatarUrl(session.user.image);
        URL.revokeObjectURL(tempUrl);
        toast.error(msg);
      },
    });
  };
  return (
    <SettingsRow className={cn(className)}>
      <SettingsRowHeader
        description={settings_profile_avatar_description()}
        title={settings_profile_avatar_title()}
      />
      <div className="flex flex-col items-center sm:flex-row gap-4 sm:gap-8">
        <Avatar className="h-16 w-16 border">
          <AvatarImage src={avatarUrl ?? ''} alt={user.name ?? ''} />
          <AvatarFallback className="absolute inset-0">
            <IconUser className="h-8 w-8 text-muted-foreground" />
          </AvatarFallback>
        </Avatar>
        <label
          className={cn(
            buttonVariants({ variant: 'outline', size: 'sm' }),
            'cursor-pointer',
            uploadMutation.isPending && 'pointer-events-none opacity-50'
          )}
        >
          <input
            type="file"
            accept="image/png, image/jpeg, image/webp"
            onChange={handleFileChange}
            className="sr-only"
            disabled={uploadMutation.isPending}
          />
          {uploadMutation.isPending
            ? settings_profile_avatar_uploading()
            : settings_profile_avatar_upload_avatar()}
        </label>
      </div>
      <FormError message={error} />
      <SettingsRowFooter hint={settings_profile_avatar_hint()} />
    </SettingsRow>
  );
}
