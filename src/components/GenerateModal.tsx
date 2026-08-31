import { GeneratePanel } from "./GeneratePanel";

import type {

  CreditCard,

  GenerateFromMasterOptions,

  JigPreset,

  MasterProfile,

  PoolEmail,

  ProfileCategory,

} from "../lib/types";



interface GenerateModalProps {

  open: boolean;

  masterProfiles: MasterProfile[];

  initialMasterId: string | null;

  initialCategoryId?: string | null;

  profileCategories: ProfileCategory[];

  jigPresets: JigPreset[];

  creditCards: CreditCard[];

  poolEmails?: PoolEmail[];

  onSaveCategory: (category: ProfileCategory) => Promise<void>;

  onClose: () => void;

  onGenerate: (masterId: string, options: GenerateFromMasterOptions) => Promise<number>;

  onSuccess?: (count: number, masterId: string) => void;

}



export function GenerateModal({

  open,

  masterProfiles,

  initialMasterId,

  initialCategoryId,

  profileCategories,

  jigPresets,

  creditCards,

  poolEmails,

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

          initialCategoryId={initialCategoryId}

          profileCategories={profileCategories}

          jigPresets={jigPresets}

          creditCards={creditCards}

          poolEmails={poolEmails}

          onSaveCategory={onSaveCategory}

          onGenerate={onGenerate}

          onSuccess={onSuccess}

        />

      </div>

    </div>

  );

}

