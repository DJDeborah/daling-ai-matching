import type { Gender, ProfileRow } from "./profile";

export const DEMO_VERSION = 1;

type DemoSpec = {
  id: string; name: string; gender: Gender; age: number; city: string;
  height: number; interests: string[]; about: string; partnerNote: string;
  preferredCity?: string;
};

// All records are invented. They never enter the real profiles, likes or blocks tables.
const specs: DemoSpec[] = [
  { id: "demo-01", name: "样例·林远", gender: "man", age: 28, city: "上海", height: 178, interests: ["徒步", "阅读", "电影"], about: "周末喜欢徒步，平日会读历史和看电影。", partnerNote: "希望一起探索城市，也尊重彼此的独处时间。" },
  { id: "demo-02", name: "样例·知夏", gender: "woman", age: 26, city: "上海", height: 165, interests: ["摄影", "咖啡", "旅行"], about: "喜欢用相机记录城市角落，也爱找安静的咖啡馆。", partnerNote: "希望对方愿意真诚交流。" },
  { id: "demo-03", name: "样例·青禾", gender: "nonbinary", age: 27, city: "杭州", height: 172, interests: ["音乐", "桌游", "旅行"], about: "喜欢现场音乐和桌游，假期会坐火车去新城市。", partnerNote: "期待轻松且尊重边界的相处。" },
  { id: "demo-04", name: "样例·沐川", gender: "man", age: 31, city: "北京", height: 181, interests: ["跑步", "烹饪", "纪录片"], about: "晨跑后会研究新菜谱，也喜欢看自然纪录片。", partnerNote: "希望彼此有稳定的沟通节奏。" },
  { id: "demo-05", name: "样例·南星", gender: "woman", age: 30, city: "北京", height: 168, interests: ["阅读", "展览", "徒步"], about: "常去看展，喜欢读小说，也愿意到郊外走走。", partnerNote: "期待有好奇心、能认真倾听的人。" },
  { id: "demo-06", name: "样例·可岚", gender: "nonbinary", age: 25, city: "上海", height: 170, interests: ["绘画", "电影", "烘焙"], about: "喜欢画速写，周末会烘焙或看老电影。", partnerNote: "希望可以互相尊重兴趣和生活空间。" },
  { id: "demo-07", name: "样例·启明", gender: "man", age: 24, city: "深圳", height: 174, interests: ["羽毛球", "科技", "海边"], about: "下班后常打羽毛球，休息时喜欢去海边散步。", partnerNote: "想认识能分享日常的人。" },
  { id: "demo-08", name: "样例·微澜", gender: "woman", age: 23, city: "深圳", height: 162, interests: ["瑜伽", "阅读", "旅行"], about: "喜欢读散文和短途旅行，也保持规律运动。", partnerNote: "期待坦诚而有耐心的交流。" },
  { id: "demo-09", name: "样例·月白", gender: "woman", age: 34, city: "杭州", height: 169, interests: ["园艺", "茶", "徒步"], about: "喜欢照顾植物，也会去山里走轻松路线。", partnerNote: "希望彼此理解不同的生活节奏。" },
  { id: "demo-10", name: "样例·闻舟", gender: "man", age: 35, city: "杭州", height: 176, interests: ["摄影", "骑行", "音乐"], about: "爱骑行和拍街景，闲时会听爵士乐。", partnerNote: "期待能一起分享新发现。" },
  { id: "demo-11", name: "样例·晴川", gender: "woman", age: 28, city: "广州", height: 164, interests: ["美食", "游泳", "电影"], about: "喜欢研究食物，也会在周末游泳和看电影。", partnerNote: "希望相处时可以直接表达想法。" },
  { id: "demo-12", name: "样例·阿澈", gender: "man", age: 29, city: "广州", height: 180, interests: ["篮球", "音乐", "烹饪"], about: "常和朋友打篮球，平时爱做饭和听音乐。", partnerNote: "期待互相支持各自的目标。" },
  { id: "demo-13", name: "样例·星野", gender: "nonbinary", age: 32, city: "成都", height: 175, interests: ["露营", "桌游", "阅读"], about: "偶尔露营，也喜欢桌游和科幻小说。", partnerNote: "重视平等沟通和共同成长。" },
  { id: "demo-14", name: "样例·锦书", gender: "woman", age: 38, city: "成都", height: 167, interests: ["阅读", "烹饪", "戏剧"], about: "喜欢做家常菜，关注小剧场演出，也爱读书。", partnerNote: "希望可以慢慢认识，保持诚实。" },
  { id: "demo-15", name: "样例·云开", gender: "man", age: 40, city: "成都", height: 173, interests: ["茶", "徒步", "摄影"], about: "周末常去近郊徒步，随手拍风景。", partnerNote: "期待稳定、自在的陪伴。" },
  { id: "demo-16", name: "样例·小满", gender: "woman", age: 22, city: "上海", height: 160, interests: ["舞蹈", "电影", "咖啡"], about: "喜欢练舞，休息时会找电影和咖啡店。", partnerNote: "想认识愿意分享生活的人。" },
  { id: "demo-17", name: "样例·朝雨", gender: "man", age: 27, city: "上海", height: 171, interests: ["展览", "阅读", "骑行"], about: "喜欢看设计展，也常在城市里骑行。", partnerNote: "期待真诚、有边界感的关系。" },
  { id: "demo-18", name: "样例·木棉", gender: "nonbinary", age: 36, city: "北京", height: 168, interests: ["旅行", "纪录片", "烹饪"], about: "爱探索不同地方的食物，也喜欢纪录片。", partnerNote: "希望能认真交流，并接受彼此的不同。" },
];

export const demoRows: ProfileRow[] = specs.map(spec => ({
  profile_id: spec.id, user_id: `synthetic:${spec.id}`, name: spec.name,
  gender: spec.gender, seeking: "any", age: spec.age, min_age: 18, max_age: 80,
  city: spec.city, preferred_city: spec.preferredCity ?? "", height_cm: spec.height,
  preferred_height_min: null, preferred_height_max: null, body_type: "", preferred_body_type: "",
  school: "", mbti: "", zodiac: "", preferred_zodiac: "",
  interests_json: JSON.stringify(spec.interests), about: spec.about, partner_note: spec.partnerNote,
  contact_kind: "other", contact_value: "", contact_share: 0, visible: 1,
  adult_confirmed_at: "synthetic", pool_consented_at: null,
  created_at: "synthetic", updated_at: "synthetic",
}));
