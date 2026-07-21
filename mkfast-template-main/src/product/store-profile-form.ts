export type StoreProfileForm = {
  name: string;
  city: string;
  district: string;
  address: string;
  booking: string;
  brandVoice: string;
  projectName: string;
  projectPrice: string;
  account: string;
  accountHomepage: string;
  accountVerification: 'unverified' | 'verified' | 'restricted';
  accountNotes: string;
  douyinAccount: string;
  regulated: boolean;
};

export type RequiredStoreProfileField =
  | 'name'
  | 'city'
  | 'district'
  | 'address'
  | 'booking'
  | 'brandVoice'
  | 'projectName'
  | 'projectPrice';

const requiredTextFields = [
  'name',
  'city',
  'district',
  'address',
  'booking',
  'brandVoice',
  'projectName',
] as const;

export function missingStoreProfileFields(
  form: StoreProfileForm
): RequiredStoreProfileField[] {
  const missing = requiredTextFields.filter(
    (field) => form[field].trim().length === 0
  ) as RequiredStoreProfileField[];
  const price = Number(form.projectPrice);
  if (
    form.projectPrice.trim().length === 0 ||
    !Number.isFinite(price) ||
    price < 0
  ) {
    missing.push('projectPrice');
  }
  return missing;
}
