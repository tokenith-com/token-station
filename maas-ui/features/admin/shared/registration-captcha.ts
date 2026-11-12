import type { CaptchaProof } from "../core/registration-api";

type Captcha = {
  onReady: (handler: () => void) => Captcha;
  onSuccess: (handler: () => void) => Captcha;
  onError: (handler: () => void) => Captcha;
  onClose: (handler: () => void) => Captcha;
  getValidate: () => CaptchaProof | false;
  showCaptcha: () => void;
  destroy: () => void;
};
type CaptchaWindow = Window & {
  initAlicom4?: (config: Record<string, unknown>, ready: (captcha: Captcha) => void) => void;
};

let sdkPromise: Promise<void> | undefined;

function loadSDK() {
  const target = window as CaptchaWindow;
  if (target.initAlicom4) return Promise.resolve();
  if (!sdkPromise) {
    sdkPromise = new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      const timeout = setTimeout(() => { script.remove(); reject(new Error("图形验证加载超时，请重试")); }, 20_000);
      script.src = "/vendor/ct4.js";
      // Dynamically loaded SDK and its child scripts inherit the nonce trust chain.
      const nonce = document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce;
      if (nonce) script.nonce = nonce;
      script.onload = () => { clearTimeout(timeout); if (target.initAlicom4) resolve(); else { script.remove(); reject(new Error("图形验证加载失败，请重试")); } };
      script.onerror = () => { clearTimeout(timeout); script.remove(); reject(new Error("图形验证加载失败，请检查网络后重试")); };
      document.head.appendChild(script);
    }).catch(error => { sdkPromise = undefined; throw error; });
  }
  return sdkPromise;
}

export async function verifyRegistrationCaptcha(captchaID: string, signal: AbortSignal): Promise<CaptchaProof | null> {
  if (!captchaID) throw new Error("短信注册暂不可用，请联系管理员");
  await loadSDK();
  if (signal.aborted) return null;
  return new Promise((resolve, reject) => {
    let instance: Captcha | undefined;
    let settled = false;
    const finish = (error?: Error, proof: CaptchaProof | null = null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
      instance?.destroy();
      if (error) reject(error); else resolve(proof);
    };
    const abort = () => finish();
    const timeout = setTimeout(() => finish(new Error("图形验证超时，请重试")), 120_000);
    signal.addEventListener("abort", abort, { once: true });
    try {
      (window as CaptchaWindow).initAlicom4!({ captchaId: captchaID, product: "bind", language: "zho", protocol: "https://" }, captcha => {
        if (settled) { captcha.destroy(); return; }
        instance = captcha;
        captcha.onReady(() => captcha.showCaptcha())
          .onSuccess(() => {
            const proof = captcha.getValidate();
            finish(proof ? undefined : new Error("请先完成图形验证"), proof || null);
          })
          .onClose(() => finish())
          .onError(() => finish(new Error("图形验证失败，请重试")));
      });
    } catch {
      finish(new Error("图形验证加载失败，请重试"));
    }
  });
}
