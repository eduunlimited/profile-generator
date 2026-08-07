import { GeneratePanel } from "./GeneratePanel";

import type {

  CreditCard,

  GenerateFromMasterOptions,

  JigPreset,

  MasterProfile,

} from "../lib/types";



interface GenerateModalProps {

  open: boolean;

  masterProfiles: MasterProfile[];

  initialMasterId: string | null;

  jigPresets: JigPreset[];

  creditCards: CreditCard[];

  onClose: () => void;

  onGenerate: (masterId: string, options: GenerateFromMasterOptions) => Promise<number>;

  onSuccess?: (count: number, masterId: string) => void;

}



export function GenerateModal({

  open,

  masterProfiles,

  initialMasterId,

  jigPresets,

  creditCards,

  onClose,

  onGenerate,

  onSuccess,

}: GenerateModalProps) {

  if (!open) return null;



  return (

    <div className="modal-overlay" onClick={onClose}>

      <div className="modal-dialog" onClick={(event) => event.stopPropagation()}>

        <div className="modal-header">

          <strong>Generate jig profiles</strong>

          <button type="button" className="tool-btn tool-btn-cyan" onClick={onClose}>

            Close

          </button>

        </div>

        <GeneratePanel

          masterProfiles={masterProfiles}

          initialMasterId={initialMasterId}

          jigPresets={jigPresets}

          creditCards={creditCards}

          onGenerate={onGenerate}

          onSuccess={onSuccess}

        />

      </div>

    </div>

  );

}

