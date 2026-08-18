import { customAlphabet } from "nanoid";

const generateKey = customAlphabet("23456789ABCDEFGHJKLMNPQRSTUVWXYZ", 4);

export function formatLicenseKey(): string {
  return `EPGS-${generateKey()}-${generateKey()}-${generateKey()}`;
}
