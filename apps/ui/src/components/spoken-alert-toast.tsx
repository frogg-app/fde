import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Play } from "lucide-react-native";
import { Button } from "@/components/ui/button";
import type { SpokenAlert } from "@/spoken-alerts/state";
import type { SpokenAlertPlayer } from "@/spoken-alerts/use-spoken-alert-player";

interface SpokenAlertToastContentProps {
  alert: SpokenAlert;
  player: SpokenAlertPlayer;
}

/** Toast body for a spoken alert that arrived while the user was elsewhere in the app. */
export function SpokenAlertToastContent({ alert, player }: SpokenAlertToastContentProps) {
  const { t } = useTranslation();
  const handlePlay = useCallback(() => {
    void player.play(alert);
  }, [alert, player]);
  return (
    <View style={styles.row}>
      <Text style={styles.text} numberOfLines={2}>
        {alert.spokenText}
      </Text>
      <Button
        size="xs"
        variant="secondary"
        leftIcon={Play}
        onPress={handlePlay}
        accessibilityLabel={t("spokenAlerts.toast.play")}
        testID="spoken-alert-toast-play"
      >
        {t("spokenAlerts.toast.play")}
      </Button>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[3],
    flexShrink: 1,
  },
  text: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
}));
