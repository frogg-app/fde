import { Gift } from "lucide-react-native";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useUnistyles } from "react-native-unistyles";
import {
  type SidebarCalloutAction,
  SidebarCalloutDescriptionText,
} from "@/components/sidebar-callout";
import { useSidebarCallouts } from "@/contexts/sidebar-callout-context";
import { useDesktopSettings } from "@/desktop/settings/desktop-settings";
import {
  resolveUpdateCalloutDescriptor,
  type UpdateCalloutActionDescriptor,
  type UpdateCalloutBody,
} from "@/desktop/updates/resolve-update-callout";
import { useDesktopAppUpdater } from "@/desktop/updates/use-desktop-app-updater";
import { useStableEvent } from "@/hooks/use-stable-event";
import { openExternalUrl } from "@/utils/open-external-url";

import { UpdateToast } from "./update-toast";
import { updateToastVersion } from "./update-toast-state";
import { describeAppUpdateProgress } from "./app-update-progress";

const CHECK_INTERVAL_MS = 30 * 60 * 1000;
const CHANGELOG_URL = "https://github.com/frogg-app/fde/releases";

function renderBody(body: UpdateCalloutBody, t: ReturnType<typeof useTranslation>["t"]): ReactNode {
  if (body.kind === "installing") return t("desktop.updates.callout.installingDescription");
  if (body.kind === "error") return body.message;
  return <UpdateAvailableDescription versionLabel={body.versionLabel ?? undefined} t={t} />;
}

function materializeActions(
  actions: readonly UpdateCalloutActionDescriptor[],
  handlers: { changelog: () => void; install: () => void; retry: () => void },
): SidebarCalloutAction[] {
  return actions.map((action) => ({
    label: action.label,
    onPress: handlers[action.role],
    variant: action.variant,
    disabled: action.disabled,
  }));
}

export function UpdateCalloutSource() {
  const { t } = useTranslation();
  const callouts = useSidebarCallouts();
  const { theme } = useUnistyles();
  const autoCheck = useDesktopSettings().settings.updates.autoCheck;
  const {
    isDesktopApp,
    status,
    availableUpdate,
    errorMessage,
    checkForUpdates,
    installUpdate,
    isInstalling,
    progress,
  } = useDesktopAppUpdater();
  const [dismissedVersions, setDismissedVersions] = useState<ReadonlySet<string>>(() => new Set());
  const toastVersion = updateToastVersion({
    isDesktopApp,
    status,
    latestVersion: availableUpdate?.latestVersion ?? null,
    dismissedVersions,
  });
  const dismissToast = useStableEvent(() => {
    if (!toastVersion) return;
    setDismissedVersions((previous) => new Set([...previous, toastVersion]));
  });
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const openChangelog = useStableEvent(() => {
    void openExternalUrl(CHANGELOG_URL);
  });
  const install = useStableEvent(() => {
    void installUpdate();
  });
  const retry = useStableEvent(() => {
    void checkForUpdates();
  });
  // The shell runs its own periodic check and announces results through
  // `app-update-available` (handled inside useDesktopAppUpdater); this
  // interval only re-reads the shell's cached answer, so it is cheap, and it
  // stops when the user turns automatic checks off.
  useEffect(() => {
    if (!isDesktopApp) return;

    if (!autoCheck) return;

    intervalRef.current = setInterval(() => {
      void checkForUpdates({ intent: "automatic", silent: true });
    }, CHECK_INTERVAL_MS);

    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
      }
    };
  }, [autoCheck, isDesktopApp, checkForUpdates]);

  useEffect(() => {
    if (toastVersion) return;
    const descriptor = resolveUpdateCalloutDescriptor({
      isDesktopApp,
      status,
      isInstalling,
      availableUpdate,
      errorMessage,
    });
    if (!descriptor) return;

    return callouts.show({
      id: descriptor.id,
      dismissalKey: descriptor.dismissalKey,
      priority: descriptor.priority,
      title: descriptor.title,
      description: renderBody(descriptor.body, t),
      icon: descriptor.showGiftIcon ? (
        <Gift size={theme.iconSize.sm} color={theme.colors.foregroundMuted} />
      ) : undefined,
      variant: descriptor.variant,
      actions: materializeActions(descriptor.actions, {
        changelog: openChangelog,
        install,
        retry,
      }),
      testID: descriptor.testID,
    });
  }, [
    availableUpdate,
    callouts,
    errorMessage,
    install,
    isDesktopApp,
    isInstalling,
    openChangelog,
    retry,
    status,
    theme.colors.foregroundMuted,
    theme.iconSize.sm,
    t,
    toastVersion,
  ]);

  if (!toastVersion) return null;
  const descriptor = resolveUpdateCalloutDescriptor({
    isDesktopApp,
    status,
    isInstalling,
    availableUpdate,
    errorMessage,
  });
  if (!descriptor) return null;
  const canInstall = availableUpdate?.readyToInstall === true;
  let installLabel = t("desktop.updates.section.downloadAndInstall");
  if (isInstalling) installLabel = t("desktop.updates.callout.installingAction");
  else if (status === "error") installLabel = t("common.actions.retry");
  const toastActions: SidebarCalloutAction[] = [
    { label: t("desktop.updates.callout.whatsNew"), onPress: openChangelog },
    {
      label: installLabel,
      onPress: install,
      variant: "primary",
      disabled: isInstalling || !canInstall,
      testID: "desktop-update-toast-install",
    },
  ];
  let description = renderBody(descriptor.body, t);
  if (isInstalling && progress.status === "active") {
    description = describeAppUpdateProgress(progress);
  } else if (status === "available" && !canInstall) {
    description = t("desktop.updates.section.noAsset");
  }
  return (
    <UpdateToast
      title={descriptor.title}
      description={description}
      variant={descriptor.variant}
      actions={toastActions}
      onDismiss={dismissToast}
    />
  );
}

function UpdateAvailableDescription({
  versionLabel,
  t,
}: {
  versionLabel?: string;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  return (
    <>
      <SidebarCalloutDescriptionText>
        {versionLabel
          ? t("desktop.updates.callout.versionReady", { version: versionLabel })
          : t("desktop.updates.callout.newVersionReady")}
      </SidebarCalloutDescriptionText>
      <SidebarCalloutDescriptionText>
        {t("desktop.updates.callout.restartWarning")}
      </SidebarCalloutDescriptionText>
    </>
  );
}
