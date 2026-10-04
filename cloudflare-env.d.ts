declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    DEEPSEEK_API_KEY?: string;
    WECHAT_ENABLED?: string;
    WECHAT_CORP_ID?: string;
    WECHAT_OPEN_KFID?: string;
    DALING_WECHAT_BRIDGE_SECRET?: string;
  }
}
