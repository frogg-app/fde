import { useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { useToast } from "@/contexts/toast-context";
import { pickDirectory } from "@/desktop/pick-directory";
import { useDesktopSettings, type DownloadMode } from "@/desktop/settings/desktop-settings";
import { SettingsSection } from "@/screens/settings/settings-section";
import { settingsStyles } from "@/styles/settings";

const DOWNLOAD_MODES: readonly DownloadMode[] = ["ask", "directory"];

interface DownloadModeMenuItemProps {
  value: DownloadMode;
  label: string;
  selected: boolean;
  onChange: (value: DownloadMode) => void;
}

function DownloadModeMenuItem({ value, label, selected, onChange }: DownloadModeMenuItemProps) {
  const handleSelect = useCallback(() => {
    onChange(value);
  }, [onChange, value]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {label}
    </DropdownMenuItem>
  );
}

function triggerStyle({ pressed }: PressableStateCallbackType) {
  return [styles.trigger, pressed && { opacity: 0.85 }];
}

export function DesktopDownloadsSection() {
  const { t } = useTranslation();
  const toast = useToast();
  const { settings, isSaving, updateSettings } = useDesktopSettings();
  const { mode, directory, defaultDirectory } = settings.downloads;
  const modeLabel = t(`settings.general.downloads.modes.${mode}`);

  const handleModeChange = useCallback(
    (nextMode: DownloadMode) => {
      void updateSettings({ downloads: { mode: nextMode } }).catch(() => {
        // useDesktopSettings owns the user-visible IPC error.
      });
    },
    [updateSettings],
  );

  const handleChooseDirectory = useCallback(async () => {
    let selected: string | null;
    try {
      selected = await pickDirectory();
    } catch {
      toast.error(t("settings.general.downloads.pickFailed"));
      return;
    }
    if (!selected) return;
    void updateSettings({ downloads: { directory: selected } }).catch(() => {
      // useDesktopSettings owns the user-visible IPC error.
    });
  }, [t, toast, updateSettings]);

  const handleResetDirectory = useCallback(() => {
    void updateSettings({ downloads: { directory: null } }).catch(() => {
      // useDesktopSettings owns the user-visible IPC error.
    });
  }, [updateSettings]);

  return (
    <SettingsSection title={t("settings.general.downloads.title")}>
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.general.downloads.mode")}</Text>
            <Text style={settingsStyles.rowHint}>
              {t(`settings.general.downloads.modeDescriptions.${mode}`)}
            </Text>
          </View>
          <DropdownMenu>
            <DropdownTrigger
              accessibilityRole="button"
              accessibilityLabel={`${t("settings.general.downloads.mode")}: ${modeLabel}`}
              style={triggerStyle}
              disabled={isSaving}
              testID="desktop-downloads-mode-trigger"
            >
              <Text style={styles.triggerText}>{modeLabel}</Text>
            </DropdownTrigger>
            <DropdownMenuContent side="bottom" align="end" width={220}>
              {DOWNLOAD_MODES.map((value) => (
                <DownloadModeMenuItem
                  key={value}
                  value={value}
                  label={t(`settings.general.downloads.modes.${value}`)}
                  selected={mode === value}
                  onChange={handleModeChange}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </View>
        {mode === "directory" ? (
          <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>
                {t("settings.general.downloads.directory")}
              </Text>
              <Text style={settingsStyles.rowHint} numberOfLines={1} ellipsizeMode="middle">
                {directory ?? defaultDirectory}
              </Text>
            </View>
            <View style={styles.actions}>
              {directory ? (
                <Button
                  variant="ghost"
                  size="sm"
                  onPress={handleResetDirectory}
                  disabled={isSaving}
                >
                  {t("settings.general.downloads.useDefault")}
                </Button>
              ) : null}
              <Button
                variant="outline"
                size="sm"
                onPress={handleChooseDirectory}
                disabled={isSaving}
                testID="desktop-downloads-choose-directory"
              >
                {t("settings.general.downloads.choose")}
              </Button>
            </View>
          </View>
        ) : null}
      </View>
    </SettingsSection>
  );
}

const styles = StyleSheet.create((theme) => ({
  trigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  triggerText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  actions: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
  },
}));
