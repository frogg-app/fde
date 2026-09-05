import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Text, View } from "react-native";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/use-settings";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";

/** Client-side preferences for the Companion; the daemon decides whether it runs at all. */
export function CompanionSection() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettings();

  const handleAutoStartChange = useCallback(
    (companionAutoStart: boolean) => {
      void updateSettings({ companionAutoStart });
    },
    [updateSettings],
  );

  const handleReplyTextChange = useCallback(
    (companionShowReplyText: boolean) => {
      void updateSettings({ companionShowReplyText });
    },
    [updateSettings],
  );

  return (
    <SettingsSection title={t("companion.title")} testID="companion-section">
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("companion.settings.autoStart.label")}</Text>
            <Text style={settingsStyles.rowHint}>
              {t("companion.settings.autoStart.description")}
            </Text>
          </View>
          <Switch
            value={settings.companionAutoStart}
            onValueChange={handleAutoStartChange}
            accessibilityLabel={t("companion.settings.autoStart.label")}
            testID="settings-companion-auto-start"
          />
        </View>
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("companion.settings.replyText.label")}</Text>
            <Text style={settingsStyles.rowHint}>
              {t("companion.settings.replyText.description")}
            </Text>
          </View>
          <Switch
            value={settings.companionShowReplyText}
            onValueChange={handleReplyTextChange}
            accessibilityLabel={t("companion.settings.replyText.label")}
            testID="settings-companion-show-reply-text"
          />
        </View>
      </View>
    </SettingsSection>
  );
}
