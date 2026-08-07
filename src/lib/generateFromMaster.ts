import { generateProfile } from "./generator";

import { resolveGeneratedProfileName } from "./profileNameUtils";

import { applyJigRulesToMaster } from "./jigEngine";

import { addressJigPresetLabel } from "./jigPresetUtils";

import { generateUniqueProfileEmail } from "./profileEmailUtils";

import { PROFILE_UNCATEGORIZED_CATEGORY_ID } from "./profileCategoryUtils";

import type {

  CreditCard,

  GenerateFromMasterOptions,

  JigPreset,

  MasterProfile,

  Profile,

  ProfilePayment,

} from "./types";



function pickRandom<T>(items: T[]): T | null {

  if (items.length === 0) return null;

  return items[Math.floor(Math.random() * items.length)];

}



function paymentFromCard(card: CreditCard): ProfilePayment {

  return {

    number: card.number,

    expiry: card.expiry,

    cvv: card.cvv,

    brand: card.brand,

  };

}



function resolveCard(

  mode: GenerateFromMasterOptions["creditCardMode"],

  cards: CreditCard[],

  selectedId: string | undefined,

): { payment: ProfilePayment; creditCardId?: string } {

  if (mode === "none" || cards.length === 0) {

    return { payment: generateProfile().payment };

  }

  if (mode === "selected" && selectedId) {

    const card = cards.find((item) => item.id === selectedId);

    if (card) return { payment: paymentFromCard(card), creditCardId: card.id };

  }

  const card = pickRandom(cards);

  return card

    ? { payment: paymentFromCard(card), creditCardId: card.id }

    : { payment: generateProfile().payment };

}



export function generateProfilesFromMaster(

  master: MasterProfile,

  options: GenerateFromMasterOptions,

  namePreset: JigPreset | null,

  addressPresets: JigPreset[],

  creditCards: CreditCard[],

  existingChildCount = 0,

): Profile[] {

  const now = new Date().toISOString();

  const usedEmails = new Set<string>();



  return Array.from({ length: options.count }, (_, index) => {

    const jigged = applyJigRulesToMaster(master, namePreset, addressPresets);

    const email = generateUniqueProfileEmail(jigged.name, usedEmails);

    const { payment, creditCardId } = resolveCard(

      options.creditCardMode,

      creditCards,

      options.creditCardId,

    );



    return {

      id: crypto.randomUUID(),

      locale: "en_US",

      email,

      masterProfileId: master.id,

      generatedFromMaster: true,

      profileName: resolveGeneratedProfileName(master, existingChildCount + index),

      phone: master.phone ?? "",

      categoryId: PROFILE_UNCATEGORIZED_CATEGORY_ID,

      accountStatus: "good",

      notes: "",

      nameJigPresetId: namePreset?.id,

      nameJigPresetName: namePreset?.name,

      addressJigPresetIds: addressPresets.map((preset) => preset.id),

      addressJigPresetName: addressJigPresetLabel(addressPresets),

      jigPresetName:

        [namePreset?.name, addressJigPresetLabel(addressPresets)].filter(Boolean).join(" + ") || undefined,

      name: jigged.name,

      address: jigged.address,

      billingSameAsShipping: true,

      oneCheckoutPerProfile: true,

      cardHolderSameAsShipping: true,

      cardHolderName: `${jigged.name.first} ${jigged.name.last}`.trim(),

      payment,

      creditCardId,

      credentialIds: [],

      logins: [],

      createdAt: now,

      updatedAt: now,

    };

  });

}

