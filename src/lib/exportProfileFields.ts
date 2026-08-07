import type { Profile, ProfileAddress, ProfileName } from "./types";

/** Export name fields only — never jig overlays. */
export function exportProfileName(profile: Profile): ProfileName {
  return {
    first: profile.name.first,
    last: profile.name.last,
    full: profile.name.full,
  };
}

/** Export address fields only — never jig overlays. */
export function exportProfileAddress(profile: Profile): ProfileAddress {
  return {
    street: profile.address.street,
    unit: profile.address.unit,
    city: profile.address.city,
    state: profile.address.state,
    postalCode: profile.address.postalCode,
    country: profile.address.country,
    formatted: profile.address.formatted,
  };
}

export function exportShippingName(profile: Profile): ProfileName {
  if (profile.billingSameAsShipping !== false) {
    return exportProfileName(profile);
  }
  if (profile.shippingName) {
    return {
      first: profile.shippingName.first,
      last: profile.shippingName.last,
      full: profile.shippingName.full,
    };
  }
  return exportProfileName(profile);
}

export function exportShippingAddress(profile: Profile): ProfileAddress {
  if (profile.billingSameAsShipping !== false) {
    return exportProfileAddress(profile);
  }
  if (profile.shippingAddress) {
    return {
      street: profile.shippingAddress.street,
      unit: profile.shippingAddress.unit,
      city: profile.shippingAddress.city,
      state: profile.shippingAddress.state,
      postalCode: profile.shippingAddress.postalCode,
      country: profile.shippingAddress.country,
      formatted: profile.shippingAddress.formatted,
    };
  }
  return exportProfileAddress(profile);
}
