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

export interface EmailCategory {
  id: string;
  name: string;
  createdAt: string;
  sortOrder?: number;
}

export interface PoolEmail {
  id: string;
  email: string;
  categoryId: string;
  accountStatus: AccountReviewStatus;
  /** When `single_profile`, unavailable after any assignment. Default allows one assignment per profile category. */
  assignmentScope?: CardAssignmentScope;
  notes: string;
  createdAt: string;
}

export interface ProfileCategory {
  id: string;
  name: string;
  createdAt: string;
  sortOrder?: number;
  /** When true, profiles in this category cannot be edited until unlocked. */
  locked?: boolean;
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

export type AccountReviewStatus = "good" | "not_good";

/** How a pool card may be reused across profiles. */
export type CardAssignmentScope = "account_group" | "single_profile";

export interface CreditCard {
  id: string;
  profileName: string;
  number: string;
  expiry: string;
  cvv: string;
  brand: string;
  categoryId: string;
  accountStatus: AccountReviewStatus;
  /** When `single_profile`, unavailable after any assignment. Default allows one assignment per profile category. */
  assignmentScope?: CardAssignmentScope;
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
  emailPoolId?: string;
  credentialIds: string[];
  logins: ProfileLogin[];
  createdAt: string;
  updatedAt: string;
  /** Geocodio ZIP+4 exact-match stamp for the billing address. */
  addressCheck?: AddressCheck;
}

export type AddressCheckStatus = "pass" | "warn" | "fail" | "queued" | "error";

export interface AddressCheck {
  provider: "geocodio";
  status: AddressCheckStatus;
  exactMatch?: boolean;
  accuracy?: number;
  accuracyType?: string;
  checkedAt: string;
  fingerprint: string;
  message?: string;
  /** Short badge text while a check or re-jig is in flight. */
  displayLabel?: string;
  /** Geocodio formatted address it actually matched. */
  matchedAddress?: string;
  /** House-level key from Geocodio components (number+street+city+state+ZIP5). */
  propertyKey?: string;
  /** True when the jig geocoded to the same house as the linked master. */
  masterMatch?: boolean;
}

export interface GeocodioSettings {
  apiKey: string;
}

export interface OpenAiSettings {
  apiKey: string;
}

export type OrderAnalysisSeverity = "low" | "med" | "high";

export type OrderAnalysisCause =
  | "street_too_aggressive"
  | "street_type_combo"
  | "unit_line_unrecognized"
  | "name_too_aggressive"
  | "name_card_mismatch"
  | "geocodio_fail"
  | "master_mismatch"
  | "payment_or_card"
  | "email_flagged"
  | "no_warmup"
  | "sku_pattern"
  | "timing_cluster"
  | "insufficient_data";

export interface OrderAnalysisResult {
  display: string;
  severity: OrderAnalysisSeverity;
  causes: OrderAnalysisCause[];
  confidence: number;
  action: string;
  notes?: string;
}

export interface OrderAnalysisRecord {
  site: OrderRetailer;
  email: string;
  cancelledAtCount: number;
  analyzedAt: string;
  promptVersion?: number;
  result: OrderAnalysisResult;
}

export interface GeocodioLookupRequest {
  apiKey: string;
  street: string;
  unit?: string;
  city: string;
  state: string;
  postalCode: string;
}

export interface GeocodioLookupResult {
  status: AddressCheckStatus;
  exactMatch?: boolean;
  accuracy?: number;
  accuracyType?: string;
  message?: string;
  matchedAddress?: string;
  propertyKey?: string;
}

export interface ProfileSummary {
  id: string;
  masterProfileId?: string;
  name: string;
  email: string;
  city: string;
  state: string;
  postalCode?: string;
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
  nameJigPresetName?: string;
  addressJigPresetName?: string;
  creditCardLabel?: string;
  creditCardId?: string;
  emailPoolId?: string;
  /** Full payment card digits for pool matching (not displayed). */
  paymentNumber?: string;
  credentialSites?: string;
  credentialIds?: string[];
  categoryId?: string;
  accountStatus?: AccountReviewStatus;
  notes?: string;
  createdAt: string;
  addressCheckStatus?: AddressCheckStatus;
  addressCheckMessage?: string;
  addressCheckDisplayLabel?: string;
  addressMasterMatch?: boolean;
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
  | "streetRandomLetters"
  | "streetTypeCombo";

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

export type NameMisspellScope = "both" | "first" | "last";

export interface StreetRandomLettersJigOptions {
  enabled: boolean;
  affixMode: StreetAffixMode;
  charCount: number;
}

export interface GenerateFromMasterOptions {
  count: number;
  categoryId: string;
  nameJigPresetId?: string;
  nameMisspellScope?: NameMisspellScope;
  addressJigPresetId?: string;
  addressJigPresetIds?: string[];
  streetRandomLetters?: StreetRandomLettersJigOptions;
  phoneJigLastFour?: boolean;
  creditCardMode: CreditCardAssignMode;
  creditCardId?: string;
  emailMode?: CreditCardAssignMode;
  emailId?: string;
}

export interface RejigProfilesOptions {
  profileIds: string[];
  nameJigPresetId?: string;
  nameMisspellScope?: NameMisspellScope;
  addressJigPresetId?: string;
  addressJigPresetIds?: string[];
  streetRandomLetters?: StreetRandomLettersJigOptions;
  phoneJigLastFour?: boolean;
  /** After the first re-jig, keep address-jigging Fail/Warn rows until Geocodio Pass. */
  untilPass?: boolean;
}

export interface RejigProfilesResult {
  updatedCount: number;
  failedCount: number;
  message?: string;
}

export interface AssignCardsOptions {
  profileIds: string[];
  /** One card for every selected profile (Cards tab flow). */
  creditCardId?: string;
  /** One card per profile, matched to profileIds in order (Profiles tab batch). */
  creditCardIds?: string[];
}

export interface AssignEmailsOptions {
  profileIds: string[];
  /** One pool email for every selected profile (Emails tab flow). */
  emailId?: string;
  /** One pool email per profile, matched to profileIds in order (Profiles tab batch). */
  emailIds?: string[];
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

export interface ImapSettings {
  host: string;
  port: number;
  username: string;
  password: string;
  mailbox: string;
}

export interface ImapAccount extends ImapSettings {
  id: string;
  name: string;
  createdAt: string;
  lastFetchedAt?: string;
}

export interface ImapTestResult {
  ok: boolean;
  mailbox: string;
  messageCount: number;
  message: string;
}

export interface ImapMessage {
  uid: number;
  messageId?: string;
  date: string;
  from: string;
  fromName?: string;
  fromEmail?: string;
  to: string;
  recipients: string[];
  subject: string;
  snippet: string;
  body: string;
  htmlBody?: string;
}

export interface StoredImapMessage extends ImapMessage {
  dateMs: number;
  fetchedAt: string;
}

export type OrderRetailer = "target" | "walmart" | "pokemon-center";
export type OrderStatus = "placed" | "shipped" | "delivered" | "picked_up" | "cancelled";
export type OrderEventKind = "placed" | "shipped" | "in_transit" | "delivered" | "picked_up" | "cancelled";
export type OrderFulfillment = "pickup" | "delivery";

export interface OrderEvent {
  kind: OrderEventKind;
  accountId: string;
  uid: number;
  messageId?: string;
  subject: string;
  date: string;
  dateMs: number;
}

export interface OrderLineItem {
  name: string;
  quantity: number;
}

export interface ParsedOrder {
  id: string;
  retailer: OrderRetailer;
  orderId: string;
  status: OrderStatus;
  fulfillment?: OrderFulfillment;
  total?: number;
  currency?: string;
  trackingNumber?: string;
  items?: OrderLineItem[];
  recipientEmail?: string;
  profileId?: string;
  profileName?: string;
  events: OrderEvent[];
  placedAt: string;
  updatedAt: string;
}

export type AppTab =
  | "profiles"
  | "master"
  | "cards"
  | "emails"
  | "credentials"
  | "jigs"
  | "sessions"
  | "mail"
  | "orders"
  | "performance"
  | "settings";

export type ProfileEditorSection = "profile" | "addresses" | "creditCard" | "logins";
