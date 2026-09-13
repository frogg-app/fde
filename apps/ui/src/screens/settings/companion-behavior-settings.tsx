import { useCallback } from "react";
import { ChevronDown } from "lucide-react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { Platform, Text, View } from "react-native";
import { useTranslation } from "react-i18next";
import { useSettings } from "@/hooks/use-settings";
import { Switch } from "@/components/ui/switch";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { settingsStyles } from "@/styles/settings";

const ThemedChevronDown = withUnistyles(ChevronDown, (theme) => ({
  color: theme.colors.foregroundMuted,
}));

function Choice<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
      <Text style={[settingsStyles.rowTitle, styles.label]}>{label}</Text>
      <DropdownMenu>
        <DropdownMenuTrigger
          style={styles.choice}
          accessibilityRole="button"
          accessibilityLabel={label}
        >
          <Text style={[settingsStyles.rowHint, styles.value]}>
            {options.find((option) => option.value === value)?.label}
          </Text>
          <ThemedChevronDown size={14} />
        </DropdownMenuTrigger>
        <DropdownMenuContent>
          {options.map((option) => (
            <ChoiceItem
              key={option.value}
              option={option}
              selected={option.value === value}
              onChange={onChange}
            />
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

const styles = StyleSheet.create({
  label: { flex: 1, marginRight: 12 },
  choice: { flexDirection: "row", alignItems: "center", gap: 6, maxWidth: "55%", minHeight: 44 },
  value: { flexShrink: 1, textAlign: "right" },
});

function ChoiceItem<T extends string | number>({
  option,
  selected,
  onChange,
}: {
  option: { value: T; label: string };
  selected: boolean;
  onChange: (value: T) => void;
}) {
  const select = useCallback(() => onChange(option.value), [onChange, option.value]);
  return (
    <DropdownMenuItem selected={selected} onSelect={select}>
      {option.label}
    </DropdownMenuItem>
  );
}

export function CompanionBehaviorSettings() {
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettings();
  const changeVerbosity = useCallback(
    (companionVerbosity: "brief" | "detailed") => {
      void updateSettings({ companionVerbosity });
    },
    [updateSettings],
  );
  const changeUpdates = useCallback(
    (companionUpdates: "important" | "completion" | "off") => {
      void updateSettings({ companionUpdates });
    },
    [updateSettings],
  );
  const changeAcknowledgeTasks = useCallback(
    (companionAcknowledgeTasks: boolean) => {
      void updateSettings({ companionAcknowledgeTasks });
    },
    [updateSettings],
  );
  const changeAudioMode = useCallback(
    (companionAudioMode: "call" | "media") => {
      void updateSettings({ companionAudioMode });
    },
    [updateSettings],
  );
  const changeSpeechSpeed = useCallback(
    (companionSpeechSpeed: number) => {
      void updateSettings({ companionSpeechSpeed });
    },
    [updateSettings],
  );
  const changePauseMs = useCallback(
    (companionPauseMs: number) => {
      void updateSettings({ companionPauseMs });
    },
    [updateSettings],
  );
  const changeInterruptible = useCallback(
    (companionInterruptible: boolean) => {
      void updateSettings({ companionInterruptible });
    },
    [updateSettings],
  );
  if (!settings.companionEnabled) return null;
  return (
    <>
      <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
        <Text style={settingsStyles.rowHint}>{t("companion.behavior.nextSession")}</Text>
      </View>
      {Platform.OS !== "web" ? (
        <>
          <Choice<"call" | "media">
            label={t("companion.behavior.audioMode")}
            value={settings.companionAudioMode}
            options={[
              { value: "call", label: t("companion.behavior.callMode") },
              { value: "media", label: t("companion.behavior.mediaMode") },
            ]}
            onChange={changeAudioMode}
          />
          <View style={settingsStyles.row}>
            <Text style={settingsStyles.rowHint}>{t("companion.behavior.audioModeHint")}</Text>
          </View>
        </>
      ) : null}
      <Choice<"brief" | "detailed">
        label={t("companion.behavior.verbosity")}
        value={settings.companionVerbosity}
        options={[
          { value: "brief", label: t("companion.behavior.brief") },
          { value: "detailed", label: t("companion.behavior.detailed") },
        ]}
        onChange={changeVerbosity}
      />
      <Choice<"important" | "completion" | "off">
        label={t("companion.behavior.updates")}
        value={settings.companionUpdates}
        options={[
          { value: "important", label: t("companion.behavior.important") },
          { value: "completion", label: t("companion.behavior.completion") },
          { value: "off", label: t("companion.behavior.off") },
        ]}
        onChange={changeUpdates}
      />
      <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
        <View style={settingsStyles.rowContent}>
          <Text style={settingsStyles.rowTitle}>{t("companion.behavior.acknowledge")}</Text>
          <Text style={settingsStyles.rowHint}>{t("companion.behavior.permissions")}</Text>
        </View>
        <Switch
          value={settings.companionAcknowledgeTasks}
          onValueChange={changeAcknowledgeTasks}
          accessibilityLabel={t("companion.behavior.acknowledge")}
        />
      </View>
      {!settings.companionNativeVoice ? (
        <>
          <Choice<number>
            label={t("companion.behavior.speechSpeed")}
            value={settings.companionSpeechSpeed}
            options={[0.75, 1, 1.15, 1.3, 1.5, 1.75, 2].map((value) => ({
              value,
              label: `${value}×`,
            }))}
            onChange={changeSpeechSpeed}
          />
          <Choice<number>
            label={t("companion.behavior.pause")}
            value={settings.companionPauseMs}
            options={[
              { value: 800, label: t("companion.behavior.quick") },
              { value: 1400, label: t("companion.behavior.natural") },
              { value: 2400, label: t("companion.behavior.relaxed") },
            ]}
            onChange={changePauseMs}
          />
          <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
            <Text style={settingsStyles.rowTitle}>{t("companion.behavior.interruptible")}</Text>
            <Switch
              value={settings.companionInterruptible}
              onValueChange={changeInterruptible}
              accessibilityLabel={t("companion.behavior.interruptible")}
            />
          </View>
        </>
      ) : null}
    </>
  );
}
