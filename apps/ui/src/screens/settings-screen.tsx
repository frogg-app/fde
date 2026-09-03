import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { ScrollView, Text, View, type PressableStateCallbackType } from "react-native";
import { EditingTextInput as TextInput } from "@/components/ui/text-input";
import { useFocusEffect } from "@react-navigation/native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Buffer } from "buffer";
import { FolderGit2 } from "lucide-react-native";
import { DropdownTrigger } from "@/components/ui/dropdown-trigger";
import { ScreenTitle } from "@/components/headers/screen-title";
import { HeaderIconBadge } from "@/components/headers/header-icon-badge";
import { SettingsSection } from "@/screens/settings/settings-section";
import { AppearanceSection } from "@/screens/settings/appearance/appearance-section";
import { LayoutSection } from "@/screens/settings/layout/layout-section";
import {
  useAppSettings,
  parseTerminalScrollbackLines,
  type AppSettings,
  type SendBehavior,
  type ServiceUrlBehavior,
} from "@/hooks/use-settings";
import { useHosts } from "@/runtime/host-runtime";
import { resolveActiveHostServerId } from "@/types/host-connection";
import { BackHeader } from "@/components/headers/back-header";
import { ScreenHeader } from "@/components/headers/screen-header";
import { AddHostMethodModal } from "@/components/add-host-method-modal";
import { AddHostModal } from "@/components/add-host-modal";
import { AddRemoteSshHostModal } from "@/components/add-remote-ssh-host-modal";
import { PairLinkModal } from "@/components/pair-link-modal";
import { KeyboardShortcutsSection } from "@/screens/settings/keyboard-shortcuts-section";
import { EditorSection } from "@/screens/settings/editor-section";
import { AboutSection } from "@/screens/settings/about-section";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { DesktopPermissionsSection } from "@/desktop/components/desktop-permissions-section";
import { DesktopNotificationsSection } from "@/desktop/components/desktop-notifications-section";
import { VoiceAlertsSection } from "@/screens/settings/voice-alerts-section";
import { BrowserDataSection } from "@/desktop/browser/settings/browser-data-section";
import { IntegrationsSection } from "@/desktop/components/integrations-section";
import { isElectronRuntime } from "@/desktop/host";
import { formatVersionWithPrefix } from "@/desktop/updates/desktop-updates";
import { resolveAppVersion } from "@/utils/app-version";
import { useAppDiagnosticStore } from "@/diagnostics/store";
import { settingsStyles } from "@/styles/settings";
import { THINKING_TONE_NATIVE_PCM_BASE64 } from "@/utils/thinking-tone.native-pcm";
import { useVoiceAudioEngineOptional } from "@/contexts/voice-context";
import {
  LANGUAGE_OPTIONS,
  formatLanguageOptionLabel,
  parseAppLanguage,
  type AppLanguage,
  type SupportedLocale,
} from "@/i18n/locales";
import {
  HostConnectionsPage,
  HostPairDevicePage,
  HostAgentsPage,
  HostSettingsPage,
  HostProvidersPage,
  HostUsagePage,
  HostWorkspacesPage,
  HostTerminalsPage,
} from "@/screens/settings/host-page";
import { HostPluginsPage } from "@/screens/settings/plugins-page";
import { MetadataGenerationPage } from "@/screens/settings/metadata-generation-page";
import ProjectsScreen from "@/screens/projects-screen";
import ProjectSettingsScreen from "@/screens/project-settings-screen";
import { useIsCompactFormFactor } from "@/constants/layout";
import { useLocalDaemonServerId } from "@/hooks/use-is-local-daemon";
import { useKeyboardShortcutsAvailable } from "@/keyboard/availability";
import type { HostSectionSlug, SettingsSectionSlug } from "@/utils/host-routes";
import { useLastWorkspaceSelection } from "@/stores/navigation-active-workspace-store";
import {
  leaveSettings,
  leaveSettingsFor,
  navigateSettings,
  returnFromSettings,
  type SettingsView,
} from "@/navigation/settings-navigation";
import { SettingsSidebar, useSortedHosts } from "@/screens/settings/settings-sidebar";
import { HOST_SECTION_ITEMS, SIDEBAR_SECTION_ITEMS } from "@/screens/settings/section-items";
import { isNative, isWeb } from "@/constants/platform";

// ---------------------------------------------------------------------------
// View model
// ---------------------------------------------------------------------------

function renderHostSettingsContent(
  view: Extract<SettingsView, { kind: "host" }>,
  onHostRemoved: () => void,
): ReactNode {
  switch (view.section) {
    case "projects":
      return <ProjectsScreen serverId={view.serverId} />;
    case "connections":
      return <HostConnectionsPage serverId={view.serverId} />;
    case "pair-device":
      return <HostPairDevicePage serverId={view.serverId} />;
    case "agents":
      return <HostAgentsPage serverId={view.serverId} />;
    case "metadata":
      return <MetadataGenerationPage serverId={view.serverId} />;
    case "workspaces":
      return <HostWorkspacesPage serverId={view.serverId} />;
    case "providers":
      return <HostProvidersPage serverId={view.serverId} />;
    case "usage":
      return <HostUsagePage serverId={view.serverId} />;
    case "terminals":
      return <HostTerminalsPage serverId={view.serverId} />;
    case "plugins":
      return <HostPluginsPage serverId={view.serverId} />;
    case "host":
      return <HostSettingsPage serverId={view.serverId} onHostRemoved={onHostRemoved} />;
  }
}

// ---------------------------------------------------------------------------
// Trigger + sidebar style helpers
// ---------------------------------------------------------------------------

function themeTriggerStyle({ pressed }: PressableStateCallbackType) {
  return [styles.themeTrigger, pressed && { opacity: 0.85 }];
}

function getSendBehaviorOptions(t: TFunction) {
  return [
    { value: "interrupt" as const, label: t("settings.general.defaultSend.options.interrupt") },
    { value: "steer" as const, label: t("settings.general.defaultSend.options.steer") },
    { value: "queue" as const, label: t("settings.general.defaultSend.options.queue") },
  ];
}

function getServiceUrlBehaviorLabel(t: TFunction, value: ServiceUrlBehavior): string {
  const labels: Record<ServiceUrlBehavior, string> = {
    ask: t("settings.general.serviceUrls.options.ask"),
    "in-app": t("settings.general.serviceUrls.options.inApp"),
    external: t("settings.general.serviceUrls.options.external"),
  };
  return labels[value];
}

function getActiveLocale(language: string | undefined): SupportedLocale {
  const parsed = parseAppLanguage(language);
  return parsed && parsed !== "system" ? parsed : "en";
}

const SERVICE_URL_BEHAVIOR_VALUES: ServiceUrlBehavior[] = ["ask", "in-app", "external"];

// ---------------------------------------------------------------------------
// Section components
// ---------------------------------------------------------------------------

interface GeneralSectionProps {
  settings: AppSettings;
  isDesktopApp: boolean;
  handleSendBehaviorChange: (behavior: SendBehavior) => void;
  handleServiceUrlBehaviorChange: (behavior: ServiceUrlBehavior) => void;
  handleLanguageChange: (language: AppLanguage) => void;
  handleTerminalScrollbackLinesChange: (lines: number) => void;
}

interface ServiceUrlBehaviorMenuItemProps {
  value: ServiceUrlBehavior;
  label: string;
  selected: boolean;
  onChange: (value: ServiceUrlBehavior) => void;
}

interface SendBehaviorMenuItemProps {
  value: SendBehavior;
  label: string;
  selected: boolean;
  onChange: (value: SendBehavior) => void;
}

function SendBehaviorMenuItem({ value, label, selected, onChange }: SendBehaviorMenuItemProps) {
  const handleSelect = useCallback(() => {
    onChange(value);
  }, [onChange, value]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {label}
    </DropdownMenuItem>
  );
}

function ServiceUrlBehaviorMenuItem({
  value,
  label,
  selected,
  onChange,
}: ServiceUrlBehaviorMenuItemProps) {
  const handleSelect = useCallback(() => {
    onChange(value);
  }, [onChange, value]);
  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {label}
    </DropdownMenuItem>
  );
}

interface LanguageMenuItemProps {
  value: AppLanguage;
  activeLocale: SupportedLocale;
  selected: boolean;
  onChange: (value: AppLanguage) => void;
}

function LanguageMenuItem({ value, activeLocale, selected, onChange }: LanguageMenuItemProps) {
  const { t } = useTranslation();
  const handleSelect = useCallback(() => {
    onChange(value);
  }, [onChange, value]);
  const option = LANGUAGE_OPTIONS.find((entry) => entry.value === value);
  const label = option
    ? formatLanguageOptionLabel(option, activeLocale, t(option.labelKey))
    : value;

  return (
    <DropdownMenuItem selected={selected} onSelect={handleSelect}>
      {label}
    </DropdownMenuItem>
  );
}

function GeneralSection({
  settings,
  isDesktopApp,
  handleSendBehaviorChange,
  handleServiceUrlBehaviorChange,
  handleLanguageChange,
  handleTerminalScrollbackLinesChange,
}: GeneralSectionProps) {
  const { t, i18n } = useTranslation();
  const activeLocale = getActiveLocale(i18n.language);
  const sendBehaviorOptions = useMemo(() => getSendBehaviorOptions(t), [t]);
  const selectedSendBehaviorLabel =
    sendBehaviorOptions.find((option) => option.value === settings.sendBehavior)?.label ??
    settings.sendBehavior;
  const sendBehaviorDescriptionKey = `settings.general.defaultSend.descriptions.${settings.sendBehavior}`;
  const selectedLanguageOption = LANGUAGE_OPTIONS.find(
    (option) => option.value === settings.language,
  );
  const selectedLanguageLabel = selectedLanguageOption
    ? formatLanguageOptionLabel(
        selectedLanguageOption,
        activeLocale,
        t(selectedLanguageOption.labelKey),
      )
    : settings.language;
  const [terminalScrollbackValue, setTerminalScrollbackValue] = useState(
    String(settings.terminalScrollbackLines),
  );

  const handleTerminalScrollbackChangeText = useCallback((value: string) => {
    setTerminalScrollbackValue(value.replace(/[^\d]/g, ""));
  }, []);

  const commitTerminalScrollback = useCallback(() => {
    const parsed = parseTerminalScrollbackLines(terminalScrollbackValue);
    const nextValue = parsed ?? settings.terminalScrollbackLines;
    setTerminalScrollbackValue(String(nextValue));
    if (nextValue !== settings.terminalScrollbackLines) {
      handleTerminalScrollbackLinesChange(nextValue);
    }
  }, [
    handleTerminalScrollbackLinesChange,
    settings.terminalScrollbackLines,
    terminalScrollbackValue,
  ]);

  useEffect(() => {
    setTerminalScrollbackValue(String(settings.terminalScrollbackLines));
  }, [settings.terminalScrollbackLines]);

  return (
    <SettingsSection title={t("settings.general.title")}>
      <View style={settingsStyles.card}>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.general.defaultSend.label")}</Text>
            <Text style={settingsStyles.rowHint}>{t(sendBehaviorDescriptionKey)}</Text>
          </View>
          <DropdownMenu>
            <DropdownTrigger
              accessibilityRole="button"
              accessibilityLabel={`${t("settings.general.defaultSend.label")}: ${selectedSendBehaviorLabel}`}
              style={themeTriggerStyle}
            >
              <Text style={styles.themeTriggerText}>{selectedSendBehaviorLabel}</Text>
            </DropdownTrigger>
            <DropdownMenuContent side="bottom" align="end" width={200}>
              {sendBehaviorOptions.map((option) => (
                <SendBehaviorMenuItem
                  key={option.value}
                  value={option.value}
                  label={option.label}
                  selected={settings.sendBehavior === option.value}
                  onChange={handleSendBehaviorChange}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </View>
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.general.language.label")}</Text>
            <Text style={settingsStyles.rowHint}>{t("settings.general.language.description")}</Text>
          </View>
          <DropdownMenu>
            <DropdownTrigger
              accessibilityRole="button"
              accessibilityLabel={selectedLanguageLabel}
              style={themeTriggerStyle}
            >
              <Text style={styles.themeTriggerText}>{selectedLanguageLabel}</Text>
            </DropdownTrigger>
            <DropdownMenuContent side="bottom" align="end" width={300}>
              {LANGUAGE_OPTIONS.map((option) => (
                <LanguageMenuItem
                  key={option.value}
                  value={option.value}
                  activeLocale={activeLocale}
                  selected={settings.language === option.value}
                  onChange={handleLanguageChange}
                />
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
        </View>
        {isDesktopApp ? (
          <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>{t("settings.general.serviceUrls.label")}</Text>
              <Text style={settingsStyles.rowHint}>
                {t("settings.general.serviceUrls.description")}
              </Text>
            </View>
            <DropdownMenu>
              <DropdownTrigger style={themeTriggerStyle}>
                <Text style={styles.themeTriggerText}>
                  {getServiceUrlBehaviorLabel(t, settings.serviceUrlBehavior)}
                </Text>
              </DropdownTrigger>
              <DropdownMenuContent side="bottom" align="end" width={200}>
                {SERVICE_URL_BEHAVIOR_VALUES.map((value) => (
                  <ServiceUrlBehaviorMenuItem
                    key={value}
                    value={value}
                    label={getServiceUrlBehaviorLabel(t, value)}
                    selected={settings.serviceUrlBehavior === value}
                    onChange={handleServiceUrlBehaviorChange}
                  />
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </View>
        ) : null}
        <View style={[settingsStyles.row, settingsStyles.rowBorder]}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>
              {t("settings.general.terminalScrollback.label")}
            </Text>
            <Text style={settingsStyles.rowHint}>
              {t("settings.general.terminalScrollback.description")}
            </Text>
          </View>
          <TextInput
            initialValue={terminalScrollbackValue}
            onChangeText={handleTerminalScrollbackChangeText}
            onBlur={commitTerminalScrollback}
            onSubmitEditing={commitTerminalScrollback}
            keyboardType="number-pad"
            inputMode="numeric"
            selectTextOnFocus
            style={styles.terminalScrollbackInput}
            accessibilityLabel={t("settings.general.terminalScrollback.accessibilityLabel")}
          />
        </View>
      </View>
    </SettingsSection>
  );
}

interface DiagnosticsSectionProps {
  useLegacyTerminalRenderer: boolean;
  onUseLegacyTerminalRendererChange: (value: boolean) => void;
  voiceAudioEngine: ReturnType<typeof useVoiceAudioEngineOptional>;
  isPlaybackTestRunning: boolean;
  playbackTestResult: string | null;
  handlePlaybackTest: () => Promise<void>;
}

function DiagnosticsSection({
  useLegacyTerminalRenderer,
  onUseLegacyTerminalRendererChange,
  voiceAudioEngine,
  isPlaybackTestRunning,
  playbackTestResult,
  handlePlaybackTest,
}: DiagnosticsSectionProps) {
  const { t } = useTranslation();
  const openAppDiagnostic = useAppDiagnosticStore((state) => state.open);
  const handlePlayPress = useCallback(() => {
    void handlePlaybackTest();
  }, [handlePlaybackTest]);
  return (
    <SettingsSection title={t("settings.diagnostics.title")}>
      <View style={settingsStyles.card}>
        {isNative ? (
          <View style={settingsStyles.row} testID="legacy-terminal-renderer-row">
            <View style={settingsStyles.rowContent}>
              <Text style={settingsStyles.rowTitle}>
                {t("settings.diagnostics.legacyTerminalRenderer.label")}
              </Text>
              <Text style={settingsStyles.rowHint}>
                {t("settings.diagnostics.legacyTerminalRenderer.description")}
              </Text>
            </View>
            <Switch
              value={useLegacyTerminalRenderer}
              onValueChange={onUseLegacyTerminalRendererChange}
              accessibilityLabel={t(
                "settings.diagnostics.legacyTerminalRenderer.accessibilityLabel",
              )}
              testID="legacy-terminal-renderer-switch"
            />
          </View>
        ) : null}
        <View style={settingsStyles.row} testID="app-diagnostic-row">
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.diagnostics.app.rowTitle")}</Text>
            <Text style={settingsStyles.rowHint}>{t("settings.diagnostics.app.rowHint")}</Text>
          </View>
          <Button variant="secondary" size="sm" onPress={openAppDiagnostic}>
            {t("settings.diagnostics.app.run")}
          </Button>
        </View>
        <View style={settingsStyles.row}>
          <View style={settingsStyles.rowContent}>
            <Text style={settingsStyles.rowTitle}>{t("settings.diagnostics.testAudio")}</Text>
            {playbackTestResult ? (
              <Text style={settingsStyles.rowHint}>{playbackTestResult}</Text>
            ) : null}
          </View>
          <Button
            variant="secondary"
            size="sm"
            onPress={handlePlayPress}
            disabled={!voiceAudioEngine || isPlaybackTestRunning}
          >
            {isPlaybackTestRunning
              ? t("settings.diagnostics.playing")
              : t("settings.diagnostics.playTest")}
          </Button>
        </View>
      </View>
    </SettingsSection>
  );
}

// ---------------------------------------------------------------------------
// Main screen
// ---------------------------------------------------------------------------

export interface SettingsScreenProps {
  view: SettingsView;
  openAddHostIntent?: string | null;
}

export default function SettingsScreen({ view, openAddHostIntent = null }: SettingsScreenProps) {
  const { theme } = useUnistyles();
  const { t } = useTranslation();
  const voiceAudioEngine = useVoiceAudioEngineOptional();
  const { settings, isLoading: settingsLoading, updateSettings } = useAppSettings();
  const [isAddHostMethodVisible, setIsAddHostMethodVisible] = useState(false);
  const [isDirectHostVisible, setIsDirectHostVisible] = useState(false);
  const [isRemoteSshVisible, setIsRemoteSshVisible] = useState(false);
  const [isPasteLinkVisible, setIsPasteLinkVisible] = useState(false);
  const [isPlaybackTestRunning, setIsPlaybackTestRunning] = useState(false);
  const [playbackTestResult, setPlaybackTestResult] = useState<string | null>(null);
  const lastOpenedAddHostIntentRef = useRef<string | null>(null);
  const isDesktopApp = isElectronRuntime();
  const appVersion = resolveAppVersion();
  const appVersionText = formatVersionWithPrefix(appVersion);
  const isCompactLayout = useIsCompactFormFactor();
  const shortcutsAvailable = useKeyboardShortcutsAvailable();
  const insets = useSafeAreaInsets();
  const insetBottomStyle = useMemo(() => ({ paddingBottom: insets.bottom }), [insets.bottom]);
  const hosts = useHosts();
  const localServerId = useLocalDaemonServerId();
  const sortedHosts = useSortedHosts(hosts, localServerId);
  const lastWorkspaceSelection = useLastWorkspaceSelection();
  const routedSettingsHostServerId =
    view.kind === "host" || view.kind === "project" ? view.serverId : null;
  const [selectedSettingsHostServerId, setSelectedSettingsHostServerId] = useState<string | null>(
    routedSettingsHostServerId ?? lastWorkspaceSelection?.serverId ?? null,
  );
  useFocusEffect(
    useCallback(() => {
      setSelectedSettingsHostServerId(
        routedSettingsHostServerId ?? lastWorkspaceSelection?.serverId ?? null,
      );
    }, [lastWorkspaceSelection?.serverId, routedSettingsHostServerId]),
  );

  // The host the four sections scope to: the host on the active view, otherwise
  // the picker choice, otherwise the connected local daemon, otherwise the first host.
  const activeHostServerId = useMemo(() => {
    if (view.kind === "host" || view.kind === "project") return view.serverId;
    return resolveActiveHostServerId({
      selectedServerId: selectedSettingsHostServerId,
      localServerId,
      hosts,
      orderedHosts: sortedHosts,
    });
  }, [view, selectedSettingsHostServerId, localServerId, hosts, sortedHosts]);

  const handleSendBehaviorChange = useCallback(
    (behavior: SendBehavior) => {
      void updateSettings({ sendBehavior: behavior });
    },
    [updateSettings],
  );

  const handleServiceUrlBehaviorChange = useCallback(
    (behavior: ServiceUrlBehavior) => {
      void updateSettings({ serviceUrlBehavior: behavior });
    },
    [updateSettings],
  );

  const handleLanguageChange = useCallback(
    (language: AppLanguage) => {
      void updateSettings({ language });
    },
    [updateSettings],
  );

  const handleTerminalScrollbackLinesChange = useCallback(
    (terminalScrollbackLines: number) => {
      void updateSettings({ terminalScrollbackLines });
    },
    [updateSettings],
  );

  const handleUseLegacyTerminalRendererChange = useCallback(
    (useLegacyTerminalRenderer: boolean) => {
      void updateSettings({ useLegacyTerminalRenderer });
    },
    [updateSettings],
  );

  const handlePlaybackTest = useCallback(async () => {
    if (!voiceAudioEngine || isPlaybackTestRunning) {
      return;
    }

    setIsPlaybackTestRunning(true);
    setPlaybackTestResult(null);

    try {
      const bytes = Buffer.from(THINKING_TONE_NATIVE_PCM_BASE64, "base64");
      await voiceAudioEngine.initialize();
      voiceAudioEngine.stop();
      await voiceAudioEngine.play({
        type: "audio/pcm;rate=16000;bits=16",
        size: bytes.byteLength,
        async arrayBuffer() {
          return Uint8Array.from(bytes).buffer;
        },
      });
      setPlaybackTestResult(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error("[Settings] Playback test failed", error);
      setPlaybackTestResult(t("settings.diagnostics.playbackFailed", { message }));
    } finally {
      setIsPlaybackTestRunning(false);
    }
  }, [isPlaybackTestRunning, t, voiceAudioEngine]);

  const closeAddConnectionFlow = useCallback(() => {
    setIsAddHostMethodVisible(false);
    setIsDirectHostVisible(false);
    setIsRemoteSshVisible(false);
    setIsPasteLinkVisible(false);
  }, []);

  const goBackToAddConnectionMethods = useCallback(() => {
    setIsDirectHostVisible(false);
    setIsRemoteSshVisible(false);
    setIsPasteLinkVisible(false);
    setIsAddHostMethodVisible(true);
  }, []);

  const handleAddHost = useCallback(() => {
    setIsAddHostMethodVisible(true);
  }, []);

  useEffect(() => {
    if (!openAddHostIntent || lastOpenedAddHostIntentRef.current === openAddHostIntent) {
      return;
    }
    lastOpenedAddHostIntentRef.current = openAddHostIntent;
    handleAddHost();
  }, [handleAddHost, openAddHostIntent]);

  const handleSelectDirectConnection = useCallback(() => {
    setIsAddHostMethodVisible(false);
    setIsDirectHostVisible(true);
  }, []);

  const handleSelectRemoteSsh = useCallback(() => {
    setIsAddHostMethodVisible(false);
    setIsRemoteSshVisible(true);
  }, []);

  const handleSelectPasteLink = useCallback(() => {
    setIsAddHostMethodVisible(false);
    setIsPasteLinkVisible(true);
  }, []);

  const handleHostAdded = useCallback(({ serverId }: { serverId: string }) => {
    navigateSettings({ kind: "host", serverId, section: "connections" });
  }, []);

  const handleSelectSection = useCallback((section: SettingsSectionSlug) => {
    navigateSettings({ kind: "section", section });
  }, []);

  // Picker: choose the host for host-section rows. If the user is already on a
  // host detail view, keep that detail section and swap only the host.
  const handleSelectHost = useCallback(
    (serverId: string) => {
      setSelectedSettingsHostServerId(serverId);
      if (view.kind === "project") {
        navigateSettings({ kind: "host", serverId, section: "projects" });
        return;
      }
      if (view.kind !== "host") {
        return;
      }
      navigateSettings({ kind: "host", serverId, section: view.section });
    },
    [view],
  );

  const handleSelectHostSection = useCallback(
    (section: HostSectionSlug) => {
      if (!activeHostServerId) {
        handleAddHost();
        return;
      }
      navigateSettings({ kind: "host", serverId: activeHostServerId, section });
    },
    [activeHostServerId, handleAddHost],
  );

  const handleScanQr = useCallback(() => {
    closeAddConnectionFlow();
    leaveSettingsFor({
      pathname: "/pair-scan",
      params: { source: "settings" },
    });
  }, [closeAddConnectionFlow]);

  // The removed host's routes must not stay in history, so the compact stack
  // replaces its way back to the root list.
  const handleHostRemoved = useCallback(() => {
    const target: SettingsView = isCompactLayout
      ? { kind: "root" }
      : { kind: "section", section: "general" };
    navigateSettings(target, { replace: true });
  }, [isCompactLayout]);

  const handleBackFromDetail = useCallback(() => {
    returnFromSettings(view);
  }, [view]);

  const handleBackToWorkspace = useCallback(() => {
    leaveSettings();
  }, []);

  const detailHeader = ((): {
    title: string;
    Icon: ComponentType<{ size: number; color: string }>;
    titleAccessory?: ReactNode;
  } | null => {
    if (view.kind === "host") {
      const item = HOST_SECTION_ITEMS.find((s) => s.id === view.section);
      if (!item) return null;
      return { title: t(item.labelKey), Icon: item.icon };
    }
    if (view.kind === "section") {
      const item = SIDEBAR_SECTION_ITEMS.find((s) => s.id === view.section);
      if (!item) return null;
      return { title: t(item.labelKey), Icon: item.icon };
    }
    if (view.kind === "project") {
      return { title: t("settings.projects"), Icon: FolderGit2 };
    }
    return null;
  })();

  let content: ReactNode;
  if (view.kind === "section" && view.section === "layout") {
    content = isDesktopApp ? <LayoutSection /> : null;
  } else {
    content = (() => {
      if (view.kind === "host") {
        return renderHostSettingsContent(view, handleHostRemoved);
      }
      if (view.kind === "project") {
        return (
          <ProjectSettingsScreen
            serverId={view.serverId}
            projectId={view.projectId}
            onBackToProjects={handleBackFromDetail}
            showBackToProjects={!isCompactLayout}
          />
        );
      }
      if (view.kind === "section") {
        switch (view.section) {
          case "general":
            return (
              <>
                <GeneralSection
                  settings={settings}
                  isDesktopApp={isDesktopApp}
                  handleSendBehaviorChange={handleSendBehaviorChange}
                  handleServiceUrlBehaviorChange={handleServiceUrlBehaviorChange}
                  handleLanguageChange={handleLanguageChange}
                  handleTerminalScrollbackLinesChange={handleTerminalScrollbackLinesChange}
                />
                <VoiceAlertsSection />
                {isDesktopApp ? <BrowserDataSection /> : null}
              </>
            );
          case "appearance":
            return <AppearanceSection />;
          case "editor":
            return isWeb ? <EditorSection /> : null;
          case "shortcuts":
            return shortcutsAvailable ? <KeyboardShortcutsSection /> : null;
          case "integrations":
            return isDesktopApp ? <IntegrationsSection /> : null;
          case "notifications":
            return isDesktopApp ? <DesktopNotificationsSection /> : null;
          case "permissions":
            return isDesktopApp ? <DesktopPermissionsSection /> : null;
          case "diagnostics":
            return (
              <DiagnosticsSection
                useLegacyTerminalRenderer={settings.useLegacyTerminalRenderer}
                onUseLegacyTerminalRendererChange={handleUseLegacyTerminalRendererChange}
                voiceAudioEngine={voiceAudioEngine}
                isPlaybackTestRunning={isPlaybackTestRunning}
                playbackTestResult={playbackTestResult}
                handlePlaybackTest={handlePlaybackTest}
              />
            );
          case "about":
            return (
              <AboutSection
                appVersion={appVersion}
                appVersionText={appVersionText}
                isDesktopApp={isDesktopApp}
              />
            );
        }
      }
      return null;
    })();
  }

  if (settingsLoading) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.loadingText}>{t("settings.loading")}</Text>
      </View>
    );
  }

  const desktopDetailHeaderLeft = detailHeader ? (
    <>
      <HeaderIconBadge>
        <detailHeader.Icon size={theme.iconSize.md} color={theme.colors.foregroundMuted} />
      </HeaderIconBadge>
      <ScreenTitle testID="settings-detail-header-title">{detailHeader.title}</ScreenTitle>
      {detailHeader.titleAccessory}
    </>
  ) : null;

  const addHostModals = (
    <>
      <AddHostMethodModal
        visible={isAddHostMethodVisible}
        onClose={closeAddConnectionFlow}
        onDirectConnection={handleSelectDirectConnection}
        onRemoteSsh={handleSelectRemoteSsh}
        onPasteLink={handleSelectPasteLink}
        onScanQr={handleScanQr}
      />
      <AddHostModal
        visible={isDirectHostVisible}
        onClose={closeAddConnectionFlow}
        onCancel={goBackToAddConnectionMethods}
        onSaved={handleHostAdded}
      />
      <AddRemoteSshHostModal
        visible={isRemoteSshVisible}
        onClose={closeAddConnectionFlow}
        onCancel={goBackToAddConnectionMethods}
        onSaved={handleHostAdded}
      />
      <PairLinkModal
        visible={isPasteLinkVisible}
        onClose={closeAddConnectionFlow}
        onCancel={goBackToAddConnectionMethods}
        onSaved={handleHostAdded}
      />
    </>
  );

  // Mobile root: full-screen sidebar-as-list.
  if (isCompactLayout && view.kind === "root") {
    return (
      <View style={styles.container}>
        <BackHeader title={t("settings.title")} onBack={handleBackToWorkspace} />
        <ScrollView style={styles.scrollView} contentContainerStyle={insetBottomStyle}>
          <SettingsSidebar
            view={view}
            onSelectSection={handleSelectSection}
            onSelectHostSection={handleSelectHostSection}
            onSelectHost={handleSelectHost}
            onAddHost={handleAddHost}
            activeHostServerId={activeHostServerId}
            layout="mobile"
          />
        </ScrollView>
        {addHostModals}
      </View>
    );
  }

  if (isCompactLayout) {
    return (
      <View style={styles.container}>
        <BackHeader
          title={detailHeader?.title}
          titleAccessory={detailHeader?.titleAccessory}
          onBack={handleBackFromDetail}
        />
        <ScrollView style={styles.scrollView} contentContainerStyle={insetBottomStyle}>
          <View style={styles.content}>{content}</View>
        </ScrollView>
        {addHostModals}
      </View>
    );
  }

  // Wide split view, rendered inside the settings modal (settings-modal/host.tsx):
  // the nav column on the left, the selected section's header and content on
  // the right. The modal owns the title bar and the close affordance.
  return (
    <View style={styles.container}>
      <View style={desktopStyles.row}>
        <SettingsSidebar
          view={view}
          onSelectSection={handleSelectSection}
          onSelectHostSection={handleSelectHostSection}
          onSelectHost={handleSelectHost}
          onAddHost={handleAddHost}
          activeHostServerId={activeHostServerId}
          layout="desktop"
        />
        <View style={desktopStyles.contentPane} testID="settings-detail-pane">
          <ScreenHeader
            borderless={!detailHeader}
            left={desktopDetailHeaderLeft}
            leftStyle={desktopStyles.detailLeft}
          />
          <ScrollView style={styles.scrollView}>
            <View style={styles.content}>{content}</View>
          </ScrollView>
        </View>
      </View>
      {addHostModals}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles = StyleSheet.create((theme) => ({
  loadingContainer: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
    alignItems: "center",
    justifyContent: "center",
  },
  loadingText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  container: {
    flex: 1,
    backgroundColor: theme.colors.surface0,
  },
  scrollView: {
    flex: 1,
  },
  content: {
    padding: theme.spacing[4],
    paddingTop: theme.spacing[6],
    width: "100%",
    maxWidth: 720,
    alignSelf: "center",
  },
  themeTrigger: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
    paddingVertical: theme.spacing[1],
    paddingHorizontal: theme.spacing[2],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
  },
  themeTriggerText: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  terminalScrollbackInput: {
    width: 112,
    minHeight: 36,
    paddingVertical: theme.spacing[2],
    paddingHorizontal: theme.spacing[3],
    borderRadius: theme.borderRadius.md,
    borderWidth: 1,
    borderColor: theme.colors.border,
    backgroundColor: theme.colors.surface2,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    textAlign: "right",
  },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: theme.spacing[8],
  },
  placeholderText: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.base,
  },
}));

const desktopStyles = StyleSheet.create((theme) => ({
  row: {
    flex: 1,
    flexDirection: "row",
  },
  contentPane: {
    flex: 1,
  },
  detailLeft: {
    gap: theme.spacing[2],
  },
}));
