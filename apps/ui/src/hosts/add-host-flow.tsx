import { router } from "expo-router";
import { useCallback } from "react";
import { create } from "zustand";
import { AddHostMethodModal } from "@/components/add-host-method-modal";
import { AddHostModal } from "@/components/add-host-modal";
import { AddRemoteSshHostModal } from "@/components/add-remote-ssh-host-modal";
import { PairLinkModal } from "@/components/pair-link-modal";

export type AddHostStep = "methods" | "direct" | "remote-ssh" | "pair-link";

interface AddHostFlowState {
  step: AddHostStep | null;
  open: (step?: AddHostStep) => void;
  close: () => void;
  setStep: (step: AddHostStep) => void;
}

const useAddHostFlowStore = create<AddHostFlowState>((set) => ({
  step: null,
  open: (step = "methods") => set({ step }),
  close: () => set({ step: null }),
  setStep: (step) => set({ step }),
}));

/** Opens the add-host flow on the method picker, or straight on one method's form. */
export function openAddHostFlow(step?: AddHostStep): void {
  useAddHostFlowStore.getState().open(step);
}

export function openPairScan(): void {
  router.push("/pair-scan?source=workspace");
}

export function AddHostFlowHost() {
  const step = useAddHostFlowStore((state) => state.step);
  const close = useAddHostFlowStore((state) => state.close);
  const setStep = useAddHostFlowStore((state) => state.setStep);

  const selectDirect = useCallback(() => setStep("direct"), [setStep]);
  const selectRemoteSsh = useCallback(() => setStep("remote-ssh"), [setStep]);
  const selectPairLink = useCallback(() => setStep("pair-link"), [setStep]);
  const returnToMethods = useCallback(() => setStep("methods"), [setStep]);
  const scanQr = useCallback(() => {
    close();
    openPairScan();
  }, [close]);

  const visible = step !== null;
  return (
    <>
      <AddHostMethodModal
        visible={visible && step === "methods"}
        onClose={close}
        onDirectConnection={selectDirect}
        onRemoteSsh={selectRemoteSsh}
        onPasteLink={selectPairLink}
        onScanQr={scanQr}
      />
      <AddHostModal
        visible={visible && step === "direct"}
        onClose={close}
        onCancel={returnToMethods}
        onSaved={close}
      />
      <AddRemoteSshHostModal
        visible={visible && step === "remote-ssh"}
        onClose={close}
        onCancel={returnToMethods}
        onSaved={close}
      />
      <PairLinkModal
        visible={visible && step === "pair-link"}
        onClose={close}
        onCancel={returnToMethods}
        onSaved={close}
      />
    </>
  );
}
