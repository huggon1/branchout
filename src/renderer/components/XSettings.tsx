import { t } from "../i18n";
import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import { Button } from "./Primitives";
export function XSettings() {
  return (
    <section className="platform-settings">
      <PlatformSignIn platform="xiaohongshu" />
      <PlatformSignIn platform="x" />
    </section>
  );
}
function PlatformSignIn({ platform }: { platform: "x" | "xiaohongshu" }) {
  const [status, setStatus] = useState({ signedIn: false, installed: true });
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const read = () => (platform === "x" ? bridge.xStatus() : bridge.xhsStatus());
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const reply = await read();
        if (alive && reply.ok)
          setStatus({
            signedIn: reply.value.signedIn,
            installed:
              "installed" in reply.value
                ? reply.value.installed === true
                : true,
          });
      } catch {}
    };
    void load();
    const off = bridge.onChanged(() => void load());
    return () => {
      alive = false;
      off();
    };
  }, [platform]);
  const action = async (kind: "login" | "logout" | "refresh") => {
    setBusy(true);
    setError("");
    try {
      const reply =
        kind === "refresh"
          ? await read()
          : platform === "x"
            ? await (kind === "login" ? bridge.loginX() : bridge.logoutX())
            : await (kind === "login" ? bridge.loginXhs() : bridge.logoutXhs());
      if (!reply.ok) setError(reply.message);
      else {
        const next = await read();
        if (next.ok)
          setStatus({
            signedIn: next.value.signedIn,
            installed:
              "installed" in next.value ? next.value.installed === true : true,
          });
      }
    } catch {
      setError(t("平台登录操作未完成，请稍后重试"));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="setting-row">
        <div className="platform-identity">
          <span
            className={`platform-app-icon platform-app-icon--${platform}`}
            aria-hidden="true"
          >
            {platform === "x" ? (
              <svg
                viewBox="0 0 24 24"
                width="22"
                height="22"
                fill="currentColor"
              >
                <path d="M18.9 2H22l-6.8 7.8L23.2 22h-6.3L12 14.6 5.5 22H2.3l8.2-9.4L.8 2h6.5l4.5 6.8L18.9 2ZM17.8 20h1.7L6.3 4H4.5l13.3 16Z" />
              </svg>
            ) : (
              "小红书"
            )}
          </span>
          <div>
            <strong>{platform === "x" ? "X" : t("小红书")}</strong>
            <p>{status.signedIn ? t("已连接") : t("需要登录")}</p>
          </div>
        </div>
        <Button onClick={() => setExpanded(!expanded)}>
          {expanded ? t("收起") : t("配置")}
        </Button>
      </div>
      {expanded && (
        <div className="platform-details">
          <div className="inline-actions">
            <Button disabled={busy} onClick={() => void action("login")}>
              {status.signedIn ? t("打开平台") : t("登录")}
            </Button>
            {status.signedIn && (
              <Button disabled={busy} onClick={() => void action("logout")}>
                {t("退出登录")}
              </Button>
            )}
            <Button disabled={busy} onClick={() => void action("refresh")}>
              {t("刷新状态")}
            </Button>
          </div>
          {!status.installed && (
            <p>{t("请先安装 Google Chrome，再打开浏览器登录。")}</p>
          )}
          {error && (
            <p className="model-error" role="alert">
              {error}
            </p>
          )}
        </div>
      )}
    </>
  );
}
