import { Mic, MicOff, Minimize2, PhoneOff } from "lucide-react-native";
import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";

interface CompanionControlsProps {
  isOpen: boolean;
  isMuted: boolean;
  canStop: boolean;
  isStopping: boolean;
  onMinimize: () => void;
  onToggleMute: () => void;
  onEnd: () => void;
}

/** Keep microphone, dismissal and conversation lifetime explicit beside the abstract artwork. */
export function CompanionControls({
  isOpen,
  isMuted,
  canStop,
  isStopping,
  onMinimize,
  onToggleMute,
  onEnd,
}: CompanionControlsProps) {
  const { t } = useTranslation();
  return (
    <View style={styles.controls}>
      <Button
        size="sm"
        variant="ghost"
        leftIcon={Minimize2}
        style={styles.action}
        disabled={!isOpen}
        onPress={onMinimize}
        testID="companion-minimize"
      >
        {t("companion.actions.minimize")}
      </Button>
      <Button
        size="sm"
        variant="secondary"
        leftIcon={isMuted ? MicOff : Mic}
        style={styles.action}
        disabled={!isOpen}
        onPress={onToggleMute}
        testID="companion-mute"
      >
        {isMuted ? t("companion.actions.unmute") : t("companion.actions.mute")}
      </Button>
      <Button
        size="sm"
        variant="destructive"
        leftIcon={PhoneOff}
        style={styles.action}
        disabled={!canStop}
        loading={isStopping}
        onPress={onEnd}
        testID="companion-stop"
      >
        {t("companion.actions.stop")}
      </Button>
    </View>
  );
}
const styles = StyleSheet.create((theme) => ({
  controls: {
    flexDirection: "row",
    justifyContent: "center",
    flexWrap: "wrap",
    gap: theme.spacing[2],
  },
  action: { minHeight: 44, borderRadius: theme.borderRadius.full },
}));
