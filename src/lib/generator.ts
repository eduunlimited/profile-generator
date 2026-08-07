import { faker, fakerEN_CA, fakerEN_GB, fakerEN_US, type Faker } from "@faker-js/faker";
import { CARD_UNCATEGORIZED_CATEGORY_ID } from "./cardCategoryUtils";
import { PROFILE_UNCATEGORIZED_CATEGORY_ID } from "./profileCategoryUtils";
import { normalizeUsPhone } from "./phoneUtils";
import type {
  CreditCard,
  GenerateOptions,
  Locale,
  Profile,
  ProfileLogin,
  ProfilePayment,
} from "./types";
import { applyJigPreset } from "./jigEngine";
import { getJigPresetById } from "./presets";

const LOCALE_FAKERS: Record<Locale, Faker> = {
  en_US: fakerEN_US,
  en_GB: fakerEN_GB,
  en_CA: fakerEN_CA,
};

const TEST_CARDS = [
  { brand: "Visa", prefix: "4111", length: 16 },
  { brand: "Mastercard", prefix: "5555", length: 16 },
  { brand: "Amex", prefix: "3782", length: 15 },
] as const;

function luhnChecksum(digits: number[]): number {
  let sum = 0;
  let alternate = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let n = digits[i];
    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alternate = !alternate;
  }
  return sum % 10;
}

function generateTestCard(): ProfilePayment {
  const template = faker.helpers.arrayElement(TEST_CARDS);
  const bodyLength = template.length - 1;
  let number: string = template.prefix;
  while (number.length < bodyLength) {
    number += faker.number.int({ min: 0, max: 9 }).toString();
  }
  const digits = number.split("").map(Number);
  for (let check = 0; check < 10; check += 1) {
    const candidate = [...digits, check];
    if (luhnChecksum(candidate) === 0) {
      number = candidate.join("");
      break;
    }
  }

  const month = faker.number.int({ min: 1, max: 12 }).toString().padStart(2, "0");
  const year = faker.number.int({ min: 2028, max: 2032 }).toString();
  const cvvLength = template.brand === "Amex" ? 4 : 3;

  return {
    brand: template.brand,
    number,
    expiry: `${month}/${year}`,
    cvv: faker.string.numeric(cvvLength),
  };
}

function randomCardProfileName(brand: string, usedNames: Set<string>): string {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const name = faker.helpers.arrayElement([
      `${brand} ${faker.word.adjective()} ${faker.number.int({ min: 10, max: 999 })}`,
      `${faker.location.city()} ${brand}`,
      `${faker.commerce.productAdjective()} ${brand}`,
      `${brand} ${faker.string.alpha({ length: 4, casing: "upper" })}`,
    ]);
    if (!usedNames.has(name)) {
      usedNames.add(name);
      return name;
    }
  }

  const fallback = `${brand} ${faker.string.alphanumeric({ length: 8, casing: "upper" })}`;
  usedNames.add(fallback);
  return fallback;
}

export function generateTestCreditCards(count: number): CreditCard[] {
  const limit = Math.max(1, Math.min(500, Math.floor(count)));
  const usedNames = new Set<string>();
  const now = new Date().toISOString();

  return Array.from({ length: limit }, () => {
    const payment = generateTestCard();
    return {
      id: crypto.randomUUID(),
      profileName: randomCardProfileName(payment.brand, usedNames),
      number: payment.number,
      expiry: payment.expiry,
      cvv: payment.cvv,
      brand: payment.brand,
      accountStatus: "good",
      notes: "",
      categoryId: CARD_UNCATEGORIZED_CATEGORY_ID,
      createdAt: now,
    };
  });
}

function createLogins(
  count: number,
  firstName: string,
  lastName: string,
): ProfileLogin[] {
  const slug = `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z0-9.]/g, "");
  return Array.from({ length: count }, (_, index) => {
    const label = index === 0 ? "default" : `account-${index + 1}`;
    const suffix = index === 0 ? "" : index.toString();
    return {
      id: crypto.randomUUID(),
      label,
      username: `${slug}${suffix}`,
      email: `${slug}${suffix}@test.local`,
      password: faker.internet.password({ length: 12 }),
    };
  });
}

export function generateProfile(options: Partial<GenerateOptions> = {}): Profile {
  const locale = options.locale ?? "en_US";
  const loginCount = options.loginCount ?? 1;
  const now = new Date().toISOString();
  const localFaker = LOCALE_FAKERS[locale];

  const firstName = localFaker.person.firstName();
  const lastName = localFaker.person.lastName();
  const slug = `${firstName}.${lastName}`.toLowerCase().replace(/[^a-z0-9.]/g, "");
  const logins = createLogins(loginCount, firstName, lastName);
  const street = localFaker.location.streetAddress();
  const city = localFaker.location.city();
  const state = localFaker.location.state({ abbreviated: true });
  const postalCode = localFaker.location.zipCode();
  const country =
    locale === "en_GB"
      ? "United Kingdom"
      : locale === "en_CA"
        ? "Canada"
        : "United States";

  let profile: Profile = {
    id: crypto.randomUUID(),
    locale,
    email: logins[0]?.email ?? `${slug}@test.local`,
    phone: normalizeUsPhone(localFaker.phone.number()),
    name: {
      first: firstName,
      last: lastName,
      full: `${firstName} ${lastName}`,
    },
    address: {
      street,
      city,
      state,
      postalCode,
      country,
    },
    payment: generateTestCard(),
    categoryId: PROFILE_UNCATEGORIZED_CATEGORY_ID,
    accountStatus: "good",
    notes: "",
    billingSameAsShipping: true,
    oneCheckoutPerProfile: true,
    cardHolderSameAsShipping: true,
    cardHolderName: `${firstName} ${lastName}`.trim(),
    credentialIds: [],
    logins,
    createdAt: now,
    updatedAt: now,
  };

  if (options.jigPresetId) {
    const preset = getJigPresetById(options.jigPresetId);
    if (preset) {
      profile = applyJigPreset(profile, preset);
    }
  }

  return profile;
}

export function generateProfiles(options: GenerateOptions): Profile[] {
  return Array.from({ length: options.count }, () => generateProfile(options));
}
