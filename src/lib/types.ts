export type Locale = "en_US" | "en_GB" | "en_CA";

export interface ProfileName {
  first: string;
  last: string;
  full: string;
  jig?: string;
}

export interface ProfileAddress {
  street: string;
  unit?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  formatted?: string;
  jig?: string;
}

export interface ProfilePayment {
  number: string;
  expiry: string;
  cvv: string;
  brand: string;
}

export interface ProfileLogin {
  id: string;
  label: string;
  username: string;
  email: string;
  password: string;
}

export interface AccountCategory {
  id: string;
  name: string;
  createdAt: string;
  sortOrder?: number;
}

export interface CardCategory {
  id: string;
  name: string;
  createdAt: string;
  sortOrder?: number;
}

export interface ProfileCategory {
  id: string;
  name: string;
  createdAt: string;
  sortOrder?: number;
}

export interface MasterProfile {
  id: string;
  /** Variable display name for generated child profiles (not first/last). */
  profileName?: string;
  phone?: string;
  name: ProfileName;
  address: ProfileAddress;
  updatedAt: string;
}

export interface CreditCard {
  id: string;
  profileName: string;
  number: string;
  expiry: string;
  cvv: string;
  brand: string;
  categoryId: string;
  accountStatus: AccountReviewStatus;
  notes: string;
  createdAt: string;
}

export interface Credential {
  id: string;
  site: string;
  username: string;
  password: string;
  categoryId: string;
  accountStatus: AccountReviewStatus;
  notes: string;
  createdAt: string;
}

export type AccountReviewStatus = "good" | "not_good";

export interface Profile {
  id: string;
  locale: Locale;
  email: string;
  masterProfileId?: string;
  generatedFromMaster?: boolean;
  nameJigPresetId?: string;
  nameJigPresetName?: string;
  addressJigPresetId?: string;
  addressJigPresetIds?: string[];
  addressJigPresetName?: string;
  jigPresetId?: string;
  jigPresetName?: string;
  /** Variable label shown in the profiles table (not billing first/last). */
  profileName?: string;
  phone?: string;
  categoryId: string;
  accountStatus: AccountReviewStatus;
  notes: string;
  name: ProfileName;
  address: ProfileAddress;
  /** Separate shipping name when billingSameAsShipping is false. */
  shippingName?: ProfileName;
  /** Separate shipping address when billingSameAsShipping is false. */
  shippingAddress?: ProfileAddress;
  /** When true (default), export uses billing for shipping. */
  billingSameAsShipping?: boolean;
  /** Stellar CARD_HOLDER_NAME — distinct from billing name when set. */
  cardHolderName?: string;
  /** When true (default), cardholder name follows shipping first + last name. */
  cardHolderSameAsShipping?: boolean;
  /** Stellar ONE_CHECKOUT_PER_PROFILE — defaults to true when unset. */
  oneCheckoutPerProfile?: boolean;
  /** Account pool site to link (Target, Walmart, etc.). Empty = no account link. */
  accountSite?: string;
  payment: ProfilePayment;
  creditCardId?: string;
  credentialIds: string[];
  logins: ProfileLogin[];
  createdAt: string;
  updatedAt: string;
}

export interface ProfileSummary {
  id: string;
  masterProfileId?: string;
  name: string;
  email: string;
  city: string;
  state: string;
  billingFullName: string;
  billingEmail: string;
  billingPhone: string;
  billingAddressLine1: string;
  billingAddressLine2: string;
  billingAddressLine3: string;
  cardNumberMasked: string;
  cardBrand: string;
  accounts: string;
  accountSite?: string;
  jigPresetName?: string;
  creditCardLabel?: string;
  creditCardId?: string;
  /** Full payment card digits for pool matching (not displayed). */
  paymentNumber?: string;
  credentialSites?: string;
  credentialIds?: string[];
  categoryId?: string;
  accountStatus?: AccountReviewStatus;
  notes?: string;
  createdAt: string;
}

export type NameRuleType =
  | "truncate"
  | "appendSuffix"
  | "removeSpaces"
  | "toUpperCase"
  | "toTitleCase"
  | "addHyphen"
  | "misspell"
  | "nameMisspell"
  | "prefixRandom"
  | "suffixRandom"
  | "insertRandomLetters";

export type StreetAffixMode = "prefix" | "suffix" | "both";

export type AddressRuleType =
  | "abbreviate"
  | "addUnit"
  | "addSuite"
  | "randomUnitLine"
  | "poBox"
  | "truncateField"
  | "splitLines"
  | "misspellField"
  | "prefixRandom"
  | "suffixRandom"
  | "streetRandomLetters";

export interface NameRule {
  type: NameRuleType;
  maxLength?: number;
  suffix?: string;
  charCount?: number;
}

export interface AddressRule {
  type: AddressRuleType;
  field?: keyof ProfileAddress;
  maxLength?: number;
  unitFormat?: string;
  charCount?: number;
  affixMode?: StreetAffixMode;
}

export interface JigPreset {
  id: string;
  name: string;
  description?: string;
  nameRules: NameRule[];
  addressRules: AddressRule[];
}

export type ExportFormat =
  | "json"
  | "jsonl"
  | "csv"
  | "tsv"
  | "yaml"
  | "xml"
  | "text"
  | "template"
  | "aycd"
  | "stellar_aio";

export interface ExportTemplate {
  id: string;
  name: string;
  description?: string;
  extension: string;
  mimeType: string;
  body: string;
  isBuiltin?: boolean;
}

export interface ExportOptions {
  formats: ExportFormat[];
  templateId?: string;
  profileIds: string[];
  fields: {
    identity: boolean;
    address: boolean;
    payment: boolean;
    logins: boolean;
  };
  oneFilePerProfile: boolean;
}

export interface GenerateOptions {
  count: number;
  locale: Locale;
  jigPresetId?: string;
  loginCount: number;
}

export type CreditCardAssignMode = "none" | "random" | "selected";

export interface GenerateFromMasterOptions {
  count: number;
  nameJigPresetId?: string;
  addressJigPresetId?: string;
  addressJigPresetIds?: string[];
  creditCardMode: CreditCardAssignMode;
  creditCardId?: string;
}

export interface RejigProfilesOptions {
  profileIds: string[];
  nameJigPresetId?: string;
  addressJigPresetId?: string;
  addressJigPresetIds?: string[];
}

export interface RejigProfilesResult {
  updatedCount: number;
  failedCount: number;
}

export interface AssignCardsOptions {
  profileIds: string[];
  /** One card for every selected profile (Cards tab flow). */
  creditCardId?: string;
  /** One card per profile, matched to profileIds in order (Profiles tab batch). */
  creditCardIds?: string[];
}

export type MassDistributeField =
  | "profileName"
  | "email"
  | "phone"
  | "accountStatus"
  | "notes"
  | "cardHolderName"
  | "cardBrand"
  | "cardNumber"
  | "cardExpiry"
  | "cardCvv"
  | "shippingFirstName"
  | "shippingLastName"
  | "shippingStreet"
  | "shippingUnit"
  | "shippingCity"
  | "shippingState"
  | "shippingPostalCode"
  | "shippingCountry"
  | "billingFirstName"
  | "billingLastName"
  | "billingStreet"
  | "billingUnit"
  | "billingCity"
  | "billingState"
  | "billingPostalCode"
  | "billingCountry"
  | "accountSite"
  | "accountPassword";

export interface MassDistributeOptions {
  profileIds: string[];
  lines: string[];
  field: MassDistributeField;
  accountSite?: string;
}

export interface MassDistributeResult {
  appliedCount: number;
  skippedLines: number;
  skippedProfiles: number;
  message: string;
}

export type AppTab =
  | "profiles"
  | "master"
  | "cards"
  | "credentials"
  | "jigs";

export type ProfileEditorSection = "profile" | "addresses" | "creditCard" | "logins";
