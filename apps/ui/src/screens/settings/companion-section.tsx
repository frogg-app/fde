import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Platform, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useCompanionHost } from "@/companion/use-companion-host";
import { useCompanionStore, type CompanionSession } from "@/companion/store";
import { Button } from "@/components/ui/button";
import { buildSettingsHostSectionRoute } from "@/utils/host-routes";
import { Switch } from "@/components/ui/switch";
import { useSettings } from "@/hooks/use-settings";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";
import { CompanionBehaviorSettings } from "./companion-behavior-settings";

/** Client-side preferences for the Companion; the daemon decides whether it runs at all. */
export function CompanionSection() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettings();
  const host = useCompanionHost();
  const router = useRouter();
  const session = useCompanionStore((state) => state.session);
  const status = t(
    companionStatus({
      enabled: settings.companionEnabled,
      status: session.status,
      available: host.isAvailable,
    }),
  );

  const handleEnabledChange = useCallback(
    (companionEnabled: boolean) => {
      void updateSettings({ companionEnabled });
    },
    [updateSettings],
  );

  const handleReplyTextChange = useCallback(
    (companionShowReplyText: boolean) => {
      void updateSettings({ companionShowReplyText });
    },
    [updateSettings],
  );

  const changeAnimated = useCallback(
    (companionAnimated: boolean) => {
      void updateSettings({ companionAnimated });
    },
    [updateSettings],
  );

  const changeNativeVoice = useCallback(
    (companionNativeVoice: boolean) => {
      void updateSettings({ companionNativeVoice });
    },
    [updateSettings],
  );
  const openProviders = useCallback(() => {
    if (host.serverId) router.push(buildSettingsHostSectionRoute(host.serverId, "providers"));
  }, [host.serverId, router]);

  return (
    <SettingsSection title={t("companion.title")} testID="companion-section">
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("companion.settings.enabled.label")}</Text>
            <Text style={settingsStyles.rowHint}>
              {t("companion.settings.enabled.description")}
            </Text>
          </View>
          <Switch
            value={settings.companionEnabled}
            onValueChange={handleEnabledChange}
            accessibilityLabel={t("companion.settings.enabled.label")}
            testID="settings-companion-enabled"
          />
        </View>
        {settings.companionEnabled && Platform.OS === "web" ? (
          <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>
                {t("companion.settings.nativeVoice.label")}
              </Text>
              <Text style={settingsStyles.rowHint}>
                {t("companion.settings.nativeVoice.description")}
              </Text>
            </View>
            <Switch
              value={settings.companionNativeVoice}
              onValueChange={changeNativeVoice}
              accessibilityLabel={t("companion.settings.nativeVoice.label")}
            />
          </View>
        ) : null}
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{status}</Text>
            {settings.companionEnabled ? (
              <>
                <Text style={settingsStyles.rowHint}>{host.unavailableReason}</Text>
                <Text style={settingsStyles.rowHint}>
                  {settings.companionNativeVoice
                    ? t("companion.settings.nativeVoice.label")
                    : (host.details?.model ?? t("companion.setup.unknown"))}
                </Text>
                <Text style={settingsStyles.rowHint}>
                  {t(
                    !settings.companionNativeVoice && host.details?.backend === "api"
                      ? "companion.setup.api"
                      : "companion.setup.subscription",
                  )}
                </Text>
                {!host.details?.conversationControls ? (
                  <Text style={settingsStyles.rowHint}>
                    {t("companion.reason.companion_update_required")}
                  </Text>
                ) : null}
                {!host.details?.localSpeechReady && !settings.companionNativeVoice ? (
                  <Text style={settingsStyles.rowHint}>
                    {t("companion.reason.companion_speech_unavailable")}
                  </Text>
                ) : null}
              </>
            ) : null}
          </View>
          {settings.companionEnabled && host.serverId ? (
            <Button size="sm" variant="ghost" onPress={openProviders}>
              {t("companion.setup.providers")}
            </Button>
          ) : null}
        </View>
        {settings.companionEnabled ? (
          <>
            <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>
                  {t("companion.settings.replyText.label")}
                </Text>
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
            <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
              <View style={settingsStyles.rowContent}>
                <Text style={settingsStyles.rowTitle}>
                  {t("companion.settings.animated.label")}
                </Text>
                <Text style={settingsStyles.rowHint}>
                  {t("companion.settings.animated.description")}
                </Text>
              </View>
              <Switch
                value={settings.companionAnimated}
                onValueChange={changeAnimated}
                accessibilityLabel={t("companion.settings.animated.label")}
                testID="settings-companion-animated"
              />
            </View>
            <CompanionBehaviorSettings />
          </>
        ) : null}
      </View>
    </SettingsSection>
  );
}

interface CompanionStatusInput {
  enabled: boolean;
  status: CompanionSession["status"];
  available: boolean;
}
function companionStatus(input: CompanionStatusInput) {
  if (!input.enabled) return "companion.setup.disabled";
  if (input.status === "starting") return "companion.status.connecting";
  if (input.status === "reconnecting") return "agentPanel.states.reconnecting";
  if (input.status === "open") return "companion.setup.active";
  if (input.status === "failed") return "companion.error.startFailed";
  return input.available ? "companion.setup.ready" : "companion.setup.required";
}
