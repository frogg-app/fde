import { router } from "expo-router";
import { useCallback } from "react";
import { create } from "zustand";
import { AddHostMethodModal } from "@/components/add-host-method-modal";
import { AddHostModal } from "@/components/add-host-modal";
import { AddRemoteSshHostModal } from "@/components/add-remote-ssh-host-modal";
import { PairLinkModal } from "@/components/pair-link-modal";

type AddHostStep = "methods" | "direct" | "remote-ssh" | "pair-link";

interface AddHostFlowState {
  step: AddHostStep | null;
  open: () => void;
  close: () => void;
  setStep: (step: AddHostStep) => void;
}

const useAddHostFlowStore = create<AddHostFlowState>((set) => ({
  step: null,
  open: () => set({ step: "methods" }),
  close: () => set({ step: null }),
  setStep: (step) => set({ step }),
}));

export function openAddHostFlow(): void {
  useAddHostFlowStore.getState().open();
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
    router.push("/pair-scan?source=workspace");
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
