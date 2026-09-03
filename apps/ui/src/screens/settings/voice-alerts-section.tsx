import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/use-settings";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";

/** Client-side preferences for spoken agent alerts; the daemon decides whether it sends any. */
export function VoiceAlertsSection() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettings();

  const handleAutoPlayChange = useCallback(
    (spokenAlertsAutoPlay: boolean) => {
      void updateSettings({ spokenAlertsAutoPlay });
    },
    [updateSettings],
  );

  const handleReplyConfirmChange = useCallback(
    (voiceReplyConfirm: boolean) => {
      void updateSettings({ voiceReplyConfirm });
    },
    [updateSettings],
  );

  return (
    <SettingsSection title={t("settings.voiceAlerts.title")}>
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.voiceAlerts.autoPlay.label")}</Text>
            <Text style={settingsStyles.rowHint}>
              {t("settings.voiceAlerts.autoPlay.description")}
            </Text>
          </View>
          <Switch
            value={settings.spokenAlertsAutoPlay}
            onValueChange={handleAutoPlayChange}
            accessibilityLabel={t("settings.voiceAlerts.autoPlay.label")}
            testID="settings-spoken-alerts-auto-play"
          />
        </View>
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("settings.voiceAlerts.replyConfirm.label")}
            </Text>
            <Text style={settingsStyles.rowHint}>
              {t("settings.voiceAlerts.replyConfirm.description")}
            </Text>
          </View>
          <Switch
            value={settings.voiceReplyConfirm}
            onValueChange={handleReplyConfirmChange}
            accessibilityLabel={t("settings.voiceAlerts.replyConfirm.label")}
            testID="settings-voice-reply-confirm"
          />
        </View>
      </View>
    </SettingsSection>
  );
}
