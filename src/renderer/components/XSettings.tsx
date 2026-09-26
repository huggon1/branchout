import { useEffect, useState } from "react";
import { bridge } from "../bridge";
import { Button } from "./Primitives";

export function XSettings() {
  const [signedIn, setSignedIn] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const reply = await bridge.xStatus();
      if (alive && reply.ok) setSignedIn(reply.value.signedIn);
    };
    const off = bridge.onChanged(() => void load());
    void load();
    return () => {
      alive = false;
      off();
    };
  }, []);
  const action = async (
    run: () => Promise<{ ok: boolean; message?: string }>,
  ) => {
    setBusy(true);
    setError("");
    try {
      const reply = await run();
      if (!reply.ok) setError(reply.message ?? "操作未完成");
      else {
        const status = await bridge.xStatus();
        if (status.ok) setSignedIn(status.value.signedIn);
      }
    } catch {
      setError("X 登录状态操作未完成");
    } finally {
      setBusy(false);
    }
  };
  return (
    <section className="platform-settings">
      <div className="setting-row">
        <div>
          <strong>X 帖子读取</strong>
          <p>读取受支持的公开帖子 · {signedIn ? "账号已连接" : "需要登录"}</p>
        </div>
        <Button onClick={() => setExpanded(!expanded)}>
          {expanded ? "收起" : "配置"}
        </Button>
      </div>
      {expanded && (
        <div className="platform-details">
          <p>在独立窗口登录 X。应用使用已连接账号读取当前可访问的帖子内容。</p>
          <div className="inline-actions">
            <Button disabled={busy} onClick={() => void action(bridge.loginX)}>
              {signedIn ? "打开 X" : "登录 X"}
            </Button>
            {signedIn && (
              <Button
                disabled={busy}
                onClick={() => void action(bridge.logoutX)}
              >
                退出登录
              </Button>
            )}
            <Button
              disabled={busy}
              onClick={() =>
                void action(async () => {
                  const status = await bridge.xStatus();
                  if (status.ok) setSignedIn(status.value.signedIn);
                  return status;
                })
              }
            >
              刷新状态
            </Button>
          </div>
          {error && (
            <p role="alert" className="model-error">
              {error}
            </p>
          )}
        </div>
      )}
      <XhsSettings />
    </section>
  );
}

function XhsSettings() {
  const [status, setStatus] = useState({ installed: false, signedIn: false });
  const [expanded, setExpanded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [qr, setQr] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const reply = await bridge.xhsStatus();
        if (alive && reply.ok) {
          setStatus(reply.value);
          if (reply.value.signedIn) setQr("");
        }
      } catch {
        /* connection can be retried explicitly */
      }
    };
    const off = bridge.onChanged(() => void load());
    void load();
    return () => {
      alive = false;
      off();
    };
  }, []);
  const act = async (kind: "login" | "logout" | "refresh") => {
    setBusy(true);
    setError("");
    try {
      if (kind === "login") {
        const reply = await bridge.loginXhs();
        if (!reply.ok) setError(reply.message);
        else {
          setStatus({ installed: true, signedIn: reply.value.signedIn });
          setQr(reply.value.qr);
        }
      } else if (kind === "logout") {
        const reply = await bridge.logoutXhs();
        if (!reply.ok) setError(reply.message);
        else {
          setStatus({ installed: true, signedIn: false });
          setQr("");
        }
      } else {
        const reply = await bridge.xhsStatus();
        if (!reply.ok) setError(reply.message);
        else {
          setStatus(reply.value);
          if (reply.value.signedIn) setQr("");
        }
      }
    } catch {
      setError("小红书登录状态操作未完成");
    } finally {
      setBusy(false);
    }
  };
  const qrImage = /^data:image\/(?:png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(qr)
    ? qr
    : /^[A-Za-z0-9+/=]+$/.test(qr)
      ? `data:image/png;base64,${qr}`
      : "";
  return (
    <>
      <div className="setting-row">
        <div>
          <strong>小红书图文笔记读取</strong>
          <p>
            图文笔记搜索与读取 ·{" "}
            {status.signedIn
              ? "已登录"
              : status.installed
                ? "需要登录"
                : "需要安装本地组件"}
          </p>
        </div>
        <Button onClick={() => setExpanded(!expanded)}>
          {expanded ? "收起" : "配置"}
        </Button>
      </div>
      {expanded && (
        <div className="platform-details">
          <p>在独立窗口连接小红书账号，用于读取受支持的图文笔记。</p>
          <div className="inline-actions">
            {!status.signedIn && (
              <Button
                disabled={busy || !status.installed}
                onClick={() => void act("login")}
              >
                显示登录二维码
              </Button>
            )}
            {status.signedIn && (
              <Button disabled={busy} onClick={() => void act("logout")}>
                退出登录
              </Button>
            )}
            <Button disabled={busy} onClick={() => void act("refresh")}>
              刷新状态
            </Button>
          </div>
          {!status.installed && (
            <p>先在项目目录运行 npm run setup:xhs，然后返回这里刷新状态。</p>
          )}
          {qrImage && !status.signedIn && (
            <img className="xhs-qr" src={qrImage} alt="小红书登录二维码" />
          )}
          {qrImage && !status.signedIn && (
            <p>用小红书 App 扫码后点击“刷新状态”。</p>
          )}
          {error && (
            <p role="alert" className="model-error">
              {error}
            </p>
          )}
        </div>
      )}
    </>
  );
}
