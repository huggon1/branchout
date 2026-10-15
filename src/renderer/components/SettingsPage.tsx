import { FeishuSettings } from "./FeishuSettings";
import { TelegramSettings } from "./TelegramSettings";
import { useLanguage, selectLanguage } from "../i18n";
import { t } from "../i18n";
import { useEffect, useState, type ReactNode } from "react";
import type { UiSettings } from "../product-ui";
import { ModelSettings } from "./ModelSettings";
import { XSettings } from "./XSettings";

export function SettingsPage({
  updateSection,
  settings,
  busy,
  onSaveTelegramToken,
  onClearTelegramBotToken,
  onVerifyTelegramBot,
  onAuthorizeTelegramChat,
  onRevokeTelegramChat,
  onOpenContent,
}: {
  updateSection?: ReactNode;
  onOpenContent: () => void;
  settings?: UiSettings;
  busy: boolean;
  onSaveTelegramToken: (token: string) => Promise<boolean>;
  onClearTelegramBotToken: () => Promise<boolean>;
  onVerifyTelegramBot: () => Promise<boolean>;
  onAuthorizeTelegramChat: (chatId: string) => Promise<boolean>;
  onRevokeTelegramChat: (chatId: string) => Promise<boolean>;
}) {
  const language = useLanguage();
  const [statusMessage, setStatusMessage] = useState("");
  const [taskBrowserVisible, setTaskBrowserVisible] = useState(false);
  const [savingBrowserMode, setSavingBrowserMode] = useState(false);
  const [browserModeError, setBrowserModeError] = useState("");
  useEffect(() => {
    let active = true;
    const refresh = () =>
      void window.postrove
        .preferences()
        .then((value) => {
          if (active) setTaskBrowserVisible(value.taskBrowserVisible);
        })
        .catch(() => {
          if (active) setBrowserModeError(t("设置读取失败"));
        });
    refresh();
    const unsubscribe = window.postrove.onChanged(refresh);
    return () => {
      active = false;
      unsubscribe();
    };
  }, []);
  return (
    <div className="settings-page">
      {updateSection}
      <section className="settings-section">
        <label className="settings-field">
          <span>{t("语言")}</span>
          <select
            aria-label="Language"
            value={language}
            onChange={async (event) => {
              const value = event.target.value as "en" | "zh-CN";
              try {
                await window.postrove.saveLanguage(value);
                selectLanguage(value);
              } catch {
                setStatusMessage(t("设置保存失败"));
              }
            }}
          >
            <option value="zh-CN">简体中文</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="settings-field">
          <span>{t("任务浏览器")}</span>
          <select
            aria-label={t("任务浏览器")}
            value={taskBrowserVisible ? "visible" : "headless"}
            disabled={savingBrowserMode}
            onChange={async (event) => {
              const visible = event.target.value === "visible";
              setSavingBrowserMode(true);
              setBrowserModeError("");
              try {
                const saved =
                  await window.postrove.saveTaskBrowserVisible(visible);
                setTaskBrowserVisible(saved.taskBrowserVisible);
              } catch {
                setBrowserModeError(t("设置保存失败"));
              } finally {
                setSavingBrowserMode(false);
              }
            }}
          >
            <option value="headless">{t("后台运行（默认）")}</option>
            <option value="visible">{t("显示窗口")}</option>
          </select>
          <small>
            {t(
              "搜索和解析按此设置运行。登录时打开窗口；修改在下一次浏览器任务开始时生效。",
            )}
          </small>
          {browserModeError && <small role="status">{browserModeError}</small>}
        </label>
      </section>
      <ModelSettings />
      <TelegramSettings
        settings={settings}
        busy={busy}
        onSaveTelegramToken={onSaveTelegramToken}
        onClearTelegramBotToken={onClearTelegramBotToken}
        onVerifyTelegramBot={onVerifyTelegramBot}
        onAuthorizeTelegramChat={onAuthorizeTelegramChat}
        onRevokeTelegramChat={onRevokeTelegramChat}
        onOpenContent={onOpenContent}
      />
      <FeishuSettings onOpenContent={onOpenContent} />
      <section
        className="settings-section sources-settings"
        aria-labelledby="sources-title"
      >
        <h3 id="sources-title">{t("需要登录的平台")}</h3>
        <XSettings />
      </section>
    </div>
  );
}
