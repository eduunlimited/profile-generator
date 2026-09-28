import { GeneratePanel } from "./GeneratePanel";

import type {

  Credential,

  CardCategory,

  CreditCard,

  EmailCategory,

  GenerateFromMasterOptions,

  JigPreset,

  MasterProfile,

  PoolEmail,

  ProfileCategory,

  ProfileSummary,

} from "../lib/types";



interface GenerateModalProps {

  open: boolean;

  masterProfiles: MasterProfile[];

  initialMasterId?: string | null;

  initialMasterIds?: string[];

  initialCategoryId?: string | null;

  profileCategories: ProfileCategory[];

  jigPresets: JigPreset[];

  creditCards: CreditCard[];

  cardCategories?: CardCategory[];

  poolEmails?: PoolEmail[];

  emailCategories?: EmailCategory[];

  profiles?: ProfileSummary[];

  credentials?: Credential[];

  onSaveCategory: (category: ProfileCategory) => Promise<void>;

  onClose: () => void;

  onGenerate: (masterIds: string[], options: GenerateFromMasterOptions) => Promise<number>;

  onSuccess?: (count: number, masterIds: string[]) => void;

}



export function GenerateModal({

  open,

  masterProfiles,

  initialMasterId,

  initialMasterIds,

  initialCategoryId,

  profileCategories,

  jigPresets,

  creditCards,

  cardCategories,

  poolEmails,

  emailCategories,

  profiles,

  credentials,

  onSaveCategory,

  onClose,

  onGenerate,

  onSuccess,

}: GenerateModalProps) {

  if (!open) return null;



  return (

    <div className="modal-overlay">

      <div className="modal-dialog modal-dialog-generate" onClick={(event) => event.stopPropagation()}>

        <div className="modal-header">

          <strong>Generate jig profiles</strong>

          <button type="button" className="tool-btn tool-btn-cyan" onClick={onClose}>

            Close

          </button>

        </div>

        <GeneratePanel

          masterProfiles={masterProfiles}

          initialMasterId={initialMasterId}

          initialMasterIds={initialMasterIds}

          initialCategoryId={initialCategoryId}

          profileCategories={profileCategories}

          jigPresets={jigPresets}

          creditCards={creditCards}

          cardCategories={cardCategories}

          poolEmails={poolEmails}

          emailCategories={emailCategories}

          profiles={profiles}

          credentials={credentials}

          onSaveCategory={onSaveCategory}

          onGenerate={onGenerate}

          onSuccess={onSuccess}

        />

      </div>

    </div>

  );

}

