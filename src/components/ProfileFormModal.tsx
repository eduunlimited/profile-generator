import {
  formatCardExpiry,
  formatCardNumberDisplay,
  formatCardNumberInput,
  parseCardExpiry,
  parseCardNumberDigits,
} from "../lib/creditCardUtils";
import { PROFILE_UNCATEGORIZED_CATEGORY_ID } from "../lib/profileCategoryUtils";
import type { ProfileEditField, ProfileMixedFields, ProfileTouchedFields } from "../lib/profileMassEdit";
import { formatUsPhone } from "../lib/phoneUtils";
import {
  billingSameAsShipping,
  cardHolderSameAsShipping,
  oneCheckoutPerProfile,
  setBillingSameAsShipping,
  setCardHolderSameAsShipping,
  shippingFullName,
  updateProfileField,
  updateProfilePaymentField,
} from "../lib/profileUtils";
import type {
  AccountReviewStatus,
  Credential,
  CreditCard,
  Profile,
  ProfileCategory,
} from "../lib/types";
import { AccountCategorySelect, type CategorySelection } from "./AccountCategorySelect";
import { AccountSiteSelect } from "./AccountSiteSelect";
import { Field } from "./ui";

const MASS_EDIT_PLACEHOLDER = "Multiple values";
const CARD_BRANDS = ["Visa", "Mastercard", "Amex", "Discover"] as const;

interface ProfileFormModalProps {
  open: boolean;
  title: string;
  profileDraft: Profile | null;
  isEditing: boolean;
  isMassEditing?: boolean;
  massEditCount?: number;
  mixedFields?: ProfileMixedFields;
  touchedFields?: ProfileTouchedFields;
  formCategories: ProfileCategory[];
  draftCategorySelection: CategorySelection;
  canDeleteDraftCategory: boolean;
  status: string | null;
  creditCards: CreditCard[];
  credentials?: Credential[];
  onClose: () => void;
  onProfileDraftChange: (profile: Profile) => void;
  onDraftCategorySelectionChange: (selection: CategorySelection) => void;
  onFieldTouch?: (field: ProfileEditField) => void;
  onSave: () => void;
  onDeleteDraftCategory: () => void;
}

function ProfileToggle({
  checked,
  label,
  hint,
  mixed = false,
  onChange,
}: {
  checked: boolean;
  label: string;
  hint?: string;
  mixed?: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className={`profile-edit-toggle${mixed ? " profile-edit-toggle-mixed" : ""}`}>
      <input type="checkbox" checked={mixed ? true : checked} onChange={(event) => onChange(event.target.checked)} />
      <span className="profile-edit-toggle-track" aria-hidden="true" />
      <span className="profile-edit-toggle-copy">
        <span className="profile-edit-toggle-label">{label}</span>
        {mixed ? (
          <span className="profile-edit-toggle-hint mass-edit-toggle-hint">{MASS_EDIT_PLACEHOLDER}</span>
        ) : hint ? (
          <span className="profile-edit-toggle-hint">{hint}</span>
        ) : null}
      </span>
    </label>
  );
}

export function ProfileFormModal({
  open,
  title,
  profileDraft,
  isEditing,
  isMassEditing = false,
  massEditCount = 0,
  mixedFields,
  touchedFields,
  formCategories,
  draftCategorySelection,
  canDeleteDraftCategory,
  status,
  creditCards,
  credentials = [],
  onClose,
  onProfileDraftChange,
  onDraftCategorySelectionChange,
  onFieldTouch,
  onSave,
  onDeleteDraftCategory,
}: ProfileFormModalProps) {
  if (!open || !profileDraft) return null;

  const profile = profileDraft;

  const showMixed = (field: ProfileEditField) =>
    Boolean(isMassEditing && mixedFields?.[field] && !touchedFields?.[field]);

  const touch = (field: ProfileEditField) => {
    onFieldTouch?.(field);
  };

  const saveLabel = isMassEditing
    ? `Update ${massEditCount} profile${massEditCount === 1 ? "" : "s"}`
    : isEditing
      ? "Save"
      : "Add profile";

  const billingMatchesShipping = billingSameAsShipping(profile);
  const shippingName = billingMatchesShipping
    ? profile.name
    : (profile.shippingName ?? profile.name);
  const shippingAddress = billingMatchesShipping
    ? profile.address
    : (profile.shippingAddress ?? profile.address);
  const expiryParts = parseCardExpiry(profile.payment.expiry);
  const cardholderMatchesShipping = cardHolderSameAsShipping(profile);
  const displayedCardholderName = cardholderMatchesShipping
    ? shippingFullName(profile)
    : (profile.cardHolderName ?? "");
  const paymentNumberDigits = parseCardNumberDigits(profile.payment.number);
  const cardNumberFormatBrand = profile.payment.brand || "Visa";
  const canSelectCardType = paymentNumberDigits.length > 0 || Boolean(profile.creditCardId);

  const setField = (path: string, value: string, field?: ProfileEditField) => {
    if (field && isMassEditing) touch(field);
    const next = path.startsWith("payment.")
      ? updateProfilePaymentField(profile, path, value, creditCards)
      : updateProfileField(profile, path, value);
    onProfileDraftChange(next);
  };

  const setShippingField = (path: string, value: string, field: ProfileEditField) => {
    setField(path, value, field);
  };

  const mixedTextValue = (field: ProfileEditField, value: string) => (showMixed(field) ? "" : value);

  return (
    <div className="modal-overlay">
      <div
        className="modal-dialog account-form-modal profile-form-modal"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header profile-form-header">
          <div>
            <strong>{title}</strong>
            <p className="modal-header-sub profile-form-subtitle">
              Edit profile details, payment, and addresses. Choose an account site to link this profile to a pool
              account when the profile email matches that account&apos;s email.
            </p>
            {isMassEditing ? (
              <p className="muted mass-edit-hint">
                Shared values are shown. Fields marked with &ldquo;{MASS_EDIT_PLACEHOLDER}&rdquo; vary across the
                selection — set a value to apply it to all selected profiles.
              </p>
            ) : null}
          </div>
          <button type="button" className="tool-btn tool-btn-cyan" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="modal-body">
          <div className="profile-edit-grid">
            <section className="profile-edit-panel">
              <h3 className="profile-edit-panel-title">Profile</h3>
              <div className="profile-edit-fields">
                <Field label="Profile Name">
                  <input
                    className={showMixed("profileName") ? "mass-edit-mixed" : undefined}
                    value={mixedTextValue("profileName", profile.profileName ?? "")}
                    onChange={(event) => setField("profileName", event.target.value, "profileName")}
                    placeholder={showMixed("profileName") ? MASS_EDIT_PLACEHOLDER : ""}
                  />
                </Field>
                <div className="profile-edit-row profile-edit-row-inline">
                  <Field label="Email" className="field-w-grow">
                    <input
                      className={showMixed("email") ? "mass-edit-mixed" : undefined}
                      value={mixedTextValue("email", profile.email)}
                      onChange={(event) => setField("email", event.target.value, "email")}
                      placeholder={showMixed("email") ? MASS_EDIT_PLACEHOLDER : ""}
                    />
                  </Field>
                  <Field label="Phone" className="field-w-lg">
                    <input
                      className={showMixed("phone") ? "mass-edit-mixed" : undefined}
                      value={mixedTextValue("phone", formatUsPhone(profile.phone ?? ""))}
                      onChange={(event) => setField("phone", event.target.value, "phone")}
                      inputMode="tel"
                      placeholder={showMixed("phone") ? MASS_EDIT_PLACEHOLDER : ""}
                    />
                  </Field>
                </div>
                <Field label="Account site">
                  {showMixed("accountSite") ? (
                    <input
                      className="mass-edit-mixed inline-combobox-control"
                      readOnly
                      value=""
                      placeholder={MASS_EDIT_PLACEHOLDER}
                      onFocus={() => {
                        touch("accountSite");
                        onProfileDraftChange({ ...profile, accountSite: "" });
                      }}
                    />
                  ) : (
                    <AccountSiteSelect
                      site={profile.accountSite ?? ""}
                      onSiteChange={(value) => {
                        if (isMassEditing) touch("accountSite");
                        setField("accountSite", value);
                      }}
                      extraSites={credentials.map((credential) => credential.site)}
                      allowNone
                    />
                  )}
                </Field>
                <ProfileToggle
                  checked={oneCheckoutPerProfile(profile)}
                  mixed={showMixed("oneCheckoutPerProfile")}
                  label="One Checkout Per Profile?"
                  hint="Limit resets when you stop all tasks for module or restart app."
                  onChange={(checked) => {
                    if (isMassEditing) touch("oneCheckoutPerProfile");
                    onProfileDraftChange({ ...profile, oneCheckoutPerProfile: checked });
                  }}
                />
                <div className="profile-edit-row profile-edit-row-inline">
                  <Field label="Category" className="field-w-grow">
                    {showMixed("categoryId") ? (
                      <input
                        className="mass-edit-mixed"
                        readOnly
                        value=""
                        placeholder={MASS_EDIT_PLACEHOLDER}
                        onFocus={() => touch("categoryId")}
                      />
                    ) : (
                      <AccountCategorySelect
                        categories={formCategories}
                        selection={draftCategorySelection}
                        onSelectionChange={(selection) => {
                          if (isMassEditing) touch("categoryId");
                          onDraftCategorySelectionChange(selection);
                        }}
                        uncategorizedCategoryId={PROFILE_UNCATEGORIZED_CATEGORY_ID}
                      />
                    )}
                  </Field>
                  <Field label="Status" className="field-w-md">
                    {showMixed("accountStatus") ? (
                      <input
                        className="mass-edit-mixed"
                        readOnly
                        value=""
                        placeholder={MASS_EDIT_PLACEHOLDER}
                        onFocus={() => {
                          touch("accountStatus");
                          onProfileDraftChange({ ...profile, accountStatus: "good" });
                        }}
                      />
                    ) : (
                      <select
                        value={profile.accountStatus}
                        onChange={(event) => {
                          if (isMassEditing) touch("accountStatus");
                          onProfileDraftChange({
                            ...profile,
                            accountStatus: event.target.value as AccountReviewStatus,
                          });
                        }}
                      >
                        <option value="good">Good</option>
                        <option value="not_good">Not good</option>
                      </select>
                    )}
                  </Field>
                </div>
              </div>
            </section>

            <section className="profile-edit-panel">
              <h3 className="profile-edit-panel-title">Payment Information</h3>
              <div className="profile-edit-fields">
                <ProfileToggle
                  checked={cardholderMatchesShipping}
                  mixed={showMixed("cardHolderSameAsShipping")}
                  label="Cardholder name same as shipping name"
                  onChange={(checked) => {
                    if (isMassEditing) touch("cardHolderSameAsShipping");
                    onProfileDraftChange(setCardHolderSameAsShipping(profile, checked));
                  }}
                />
                <Field label="Cardholder Name">
                  <input
                    className={showMixed("cardHolderName") ? "mass-edit-mixed" : undefined}
                    value={mixedTextValue("cardHolderName", displayedCardholderName)}
                    disabled={cardholderMatchesShipping && !showMixed("cardHolderSameAsShipping")}
                    onChange={(event) => setField("cardHolderName", event.target.value, "cardHolderName")}
                    placeholder={showMixed("cardHolderName") ? MASS_EDIT_PLACEHOLDER : ""}
                  />
                </Field>
                <div className="profile-edit-row profile-edit-row-inline">
                  <Field label="Card Number" className="field-w-grow">
                    <input
                      className={`card-pool-number${showMixed("paymentNumber") ? " mass-edit-mixed" : ""}`}
                      value={
                        showMixed("paymentNumber")
                          ? ""
                          : formatCardNumberDisplay(profile.payment.number, cardNumberFormatBrand)
                      }
                      onChange={(event) =>
                        setField(
                          "payment.number",
                          parseCardNumberDigits(
                            formatCardNumberInput(event.target.value, cardNumberFormatBrand),
                          ),
                          "paymentNumber",
                        )
                      }
                      inputMode="numeric"
                      placeholder={showMixed("paymentNumber") ? MASS_EDIT_PLACEHOLDER : ""}
                    />
                  </Field>
                  <Field label="Expiry" className="field-w-sm">
                    <input
                      className={showMixed("paymentExpiry") ? "mass-edit-mixed" : undefined}
                      value={
                        showMixed("paymentExpiry")
                          ? ""
                          : expiryParts.month && expiryParts.year
                            ? `${expiryParts.month}/${expiryParts.year.slice(-2)}`
                            : profile.payment.expiry
                      }
                      onChange={(event) => {
                        if (isMassEditing) touch("paymentExpiry");
                        const parts = parseCardExpiry(event.target.value);
                        onProfileDraftChange(
                          updateProfilePaymentField(
                            profile,
                            "payment.expiry",
                            formatCardExpiry(parts.month, parts.year),
                            creditCards,
                          ),
                        );
                      }}
                      placeholder={showMixed("paymentExpiry") ? MASS_EDIT_PLACEHOLDER : "MM/YY"}
                    />
                  </Field>
                  <Field label="CVV" className="field-w-xs">
                    <input
                      className={showMixed("paymentCvv") ? "mass-edit-mixed" : undefined}
                      value={mixedTextValue("paymentCvv", profile.payment.cvv)}
                      onChange={(event) => setField("payment.cvv", event.target.value, "paymentCvv")}
                      inputMode="numeric"
                      placeholder={showMixed("paymentCvv") ? MASS_EDIT_PLACEHOLDER : ""}
                    />
                  </Field>
                  <Field label="Card Type" className="field-w-md">
                    {showMixed("paymentBrand") ? (
                      <input
                        className="mass-edit-mixed"
                        readOnly
                        value=""
                        placeholder={MASS_EDIT_PLACEHOLDER}
                        onFocus={() => {
                          touch("paymentBrand");
                          onProfileDraftChange({
                            ...profile,
                            payment: { ...profile.payment, brand: "" },
                          });
                        }}
                      />
                    ) : !canSelectCardType ? (
                      <select value="" disabled aria-label="Card type">
                        <option value="">—</option>
                      </select>
                    ) : (
                      <select
                        value={profile.payment.brand || ""}
                        onChange={(event) => setField("payment.brand", event.target.value, "paymentBrand")}
                      >
                        <option value="">—</option>
                        {CARD_BRANDS.map((brand) => (
                          <option key={brand} value={brand}>
                            {brand}
                          </option>
                        ))}
                      </select>
                    )}
                  </Field>
                </div>
              </div>
            </section>

            <section className="profile-edit-panel">
              <h3 className="profile-edit-panel-title">Shipping Information</h3>
              <div className="profile-edit-fields">
                <div className="profile-edit-row">
                  <Field label="First Name">
                    <input
                      className={showMixed("shippingFirstName") ? "mass-edit-mixed" : undefined}
                      value={mixedTextValue("shippingFirstName", shippingName.first)}
                      onChange={(event) =>
                        setShippingField(
                          billingMatchesShipping ? "name.first" : "shippingName.first",
                          event.target.value,
                          "shippingFirstName",
                        )
                      }
                      placeholder={showMixed("shippingFirstName") ? MASS_EDIT_PLACEHOLDER : ""}
                    />
                  </Field>
                  <Field label="Last Name">
                    <input
                      className={showMixed("shippingLastName") ? "mass-edit-mixed" : undefined}
                      value={mixedTextValue("shippingLastName", shippingName.last)}
                      onChange={(event) =>
                        setShippingField(
                          billingMatchesShipping ? "name.last" : "shippingName.last",
                          event.target.value,
                          "shippingLastName",
                        )
                      }
                      placeholder={showMixed("shippingLastName") ? MASS_EDIT_PLACEHOLDER : ""}
                    />
                  </Field>
                </div>
                <Field label="Address Line 1">
                  <input
                    className={showMixed("shippingStreet") ? "mass-edit-mixed" : undefined}
                    value={mixedTextValue("shippingStreet", shippingAddress.street)}
                    onChange={(event) =>
                      setShippingField(
                        billingMatchesShipping ? "address.street" : "shippingAddress.street",
                        event.target.value,
                        "shippingStreet",
                      )
                    }
                    placeholder={showMixed("shippingStreet") ? MASS_EDIT_PLACEHOLDER : ""}
                  />
                </Field>
                <Field label="Address Line 2">
                  <input
                    className={showMixed("shippingUnit") ? "mass-edit-mixed" : undefined}
                    value={mixedTextValue("shippingUnit", shippingAddress.unit ?? "")}
                    onChange={(event) =>
                      setShippingField(
                        billingMatchesShipping ? "address.unit" : "shippingAddress.unit",
                        event.target.value,
                        "shippingUnit",
                      )
                    }
                    placeholder={showMixed("shippingUnit") ? MASS_EDIT_PLACEHOLDER : ""}
                  />
                </Field>
                <div className="profile-edit-row profile-edit-row-inline">
                  <Field label="Country" className="field-w-grow">
                    <input
                      className={showMixed("shippingCountry") ? "mass-edit-mixed" : undefined}
                      value={mixedTextValue("shippingCountry", shippingAddress.country)}
                      onChange={(event) =>
                        setShippingField(
                          billingMatchesShipping ? "address.country" : "shippingAddress.country",
                          event.target.value,
                          "shippingCountry",
                        )
                      }
                      placeholder={showMixed("shippingCountry") ? MASS_EDIT_PLACEHOLDER : ""}
                    />
                  </Field>
                  <Field label="State" className="field-w-md">
                    <input
                      className={showMixed("shippingState") ? "mass-edit-mixed" : undefined}
                      value={mixedTextValue("shippingState", shippingAddress.state)}
                      onChange={(event) =>
                        setShippingField(
                          billingMatchesShipping ? "address.state" : "shippingAddress.state",
                          event.target.value,
                          "shippingState",
                        )
                      }
                      placeholder={showMixed("shippingState") ? MASS_EDIT_PLACEHOLDER : ""}
                    />
                  </Field>
                </div>
                <div className="profile-edit-row profile-edit-row-inline">
                  <Field label="City" className="field-w-grow">
                    <input
                      className={showMixed("shippingCity") ? "mass-edit-mixed" : undefined}
                      value={mixedTextValue("shippingCity", shippingAddress.city)}
                      onChange={(event) =>
                        setShippingField(
                          billingMatchesShipping ? "address.city" : "shippingAddress.city",
                          event.target.value,
                          "shippingCity",
                        )
                      }
                      placeholder={showMixed("shippingCity") ? MASS_EDIT_PLACEHOLDER : ""}
                    />
                  </Field>
                  <Field label="Zip Code" className="field-w-sm">
                    <input
                      className={showMixed("shippingPostalCode") ? "mass-edit-mixed" : undefined}
                      value={mixedTextValue("shippingPostalCode", shippingAddress.postalCode)}
                      onChange={(event) =>
                        setShippingField(
                          billingMatchesShipping ? "address.postalCode" : "shippingAddress.postalCode",
                          event.target.value,
                          "shippingPostalCode",
                        )
                      }
                      placeholder={showMixed("shippingPostalCode") ? MASS_EDIT_PLACEHOLDER : ""}
                    />
                  </Field>
                </div>
              </div>
            </section>

            <section className="profile-edit-panel">
              <h3 className="profile-edit-panel-title">Billing Information</h3>
              <div className="profile-edit-fields">
                <ProfileToggle
                  checked={billingMatchesShipping}
                  mixed={showMixed("billingSameAsShipping")}
                  label="Billing address same as shipping address"
                  onChange={(checked) => {
                    if (isMassEditing) touch("billingSameAsShipping");
                    onProfileDraftChange(setBillingSameAsShipping(profile, checked));
                  }}
                />
                {!billingMatchesShipping ? (
                  <>
                    <div className="profile-edit-row">
                      <Field label="First Name">
                        <input
                          className={showMixed("billingFirstName") ? "mass-edit-mixed" : undefined}
                          value={mixedTextValue("billingFirstName", profile.name.first)}
                          onChange={(event) => setField("name.first", event.target.value, "billingFirstName")}
                          placeholder={showMixed("billingFirstName") ? MASS_EDIT_PLACEHOLDER : ""}
                        />
                      </Field>
                      <Field label="Last Name">
                        <input
                          className={showMixed("billingLastName") ? "mass-edit-mixed" : undefined}
                          value={mixedTextValue("billingLastName", profile.name.last)}
                          onChange={(event) => setField("name.last", event.target.value, "billingLastName")}
                          placeholder={showMixed("billingLastName") ? MASS_EDIT_PLACEHOLDER : ""}
                        />
                      </Field>
                    </div>
                    <Field label="Address Line 1">
                      <input
                        className={showMixed("billingStreet") ? "mass-edit-mixed" : undefined}
                        value={mixedTextValue("billingStreet", profile.address.street)}
                        onChange={(event) => setField("address.street", event.target.value, "billingStreet")}
                        placeholder={showMixed("billingStreet") ? MASS_EDIT_PLACEHOLDER : ""}
                      />
                    </Field>
                    <Field label="Address Line 2">
                      <input
                        className={showMixed("billingUnit") ? "mass-edit-mixed" : undefined}
                        value={mixedTextValue("billingUnit", profile.address.unit ?? "")}
                        onChange={(event) => setField("address.unit", event.target.value, "billingUnit")}
                        placeholder={showMixed("billingUnit") ? MASS_EDIT_PLACEHOLDER : ""}
                      />
                    </Field>
                    <div className="profile-edit-row profile-edit-row-inline">
                      <Field label="Country" className="field-w-grow">
                        <input
                          className={showMixed("billingCountry") ? "mass-edit-mixed" : undefined}
                          value={mixedTextValue("billingCountry", profile.address.country)}
                          onChange={(event) => setField("address.country", event.target.value, "billingCountry")}
                          placeholder={showMixed("billingCountry") ? MASS_EDIT_PLACEHOLDER : ""}
                        />
                      </Field>
                      <Field label="State" className="field-w-md">
                        <input
                          className={showMixed("billingState") ? "mass-edit-mixed" : undefined}
                          value={mixedTextValue("billingState", profile.address.state)}
                          onChange={(event) => setField("address.state", event.target.value, "billingState")}
                          placeholder={showMixed("billingState") ? MASS_EDIT_PLACEHOLDER : ""}
                        />
                      </Field>
                    </div>
                    <div className="profile-edit-row profile-edit-row-inline">
                      <Field label="City" className="field-w-grow">
                        <input
                          className={showMixed("billingCity") ? "mass-edit-mixed" : undefined}
                          value={mixedTextValue("billingCity", profile.address.city)}
                          onChange={(event) => setField("address.city", event.target.value, "billingCity")}
                          placeholder={showMixed("billingCity") ? MASS_EDIT_PLACEHOLDER : ""}
                        />
                      </Field>
                      <Field label="Zip Code" className="field-w-sm">
                        <input
                          className={showMixed("billingPostalCode") ? "mass-edit-mixed" : undefined}
                          value={mixedTextValue("billingPostalCode", profile.address.postalCode)}
                          onChange={(event) =>
                            setField("address.postalCode", event.target.value, "billingPostalCode")
                          }
                          placeholder={showMixed("billingPostalCode") ? MASS_EDIT_PLACEHOLDER : ""}
                        />
                      </Field>
                    </div>
                  </>
                ) : null}
              </div>
            </section>
          </div>

          {canDeleteDraftCategory ? (
            <div className="button-row compact">
              <button type="button" className="ghost-button danger" onClick={onDeleteDraftCategory}>
                Delete category
              </button>
            </div>
          ) : null}
          {status ? <p className="status-inline">{status}</p> : null}
          <div className="profile-edit-footer">
            <button type="button" className="btn-primary profile-edit-save" onClick={onSave}>
              {saveLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
