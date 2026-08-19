/**
 * Promise-result clipboard write for merchant copy actions (UX-01C).
 * Success is only true after writeText resolves. Missing API or throw is false.
 */

export type MerchantClipboard = Pick<Clipboard, 'writeText'>;

export async function writeMerchantClipboardText(
  text: string,
  clipboard?: MerchantClipboard | null
): Promise<boolean> {
  if (!clipboard?.writeText) return false;
  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

export type PublishHandoffCopyHandler = (
  role: string,
  value: string
) => boolean | Promise<boolean>;
