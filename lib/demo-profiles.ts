import { blankProfile, matchingDocument, type Gender, type ProfileRow } from "./profile";
import type { DepthProfile } from "./depth";

export const DEMO_VERSION = 3;
export const EXPERIMENT_CITIES = ["上海", "北京", "杭州", "深圳", "广州", "成都", "南京", "苏州", "武汉", "西安", "重庆", "天津"];

type DemoSpec = {
  id: string; name: string; gender: Gender; age: number; city: string;
  height: number; interests: string[]; about: string; partnerNote: string;
  preferredCity?: string;
  seeking?: Gender | "any"; minAge?: number; maxAge?: number;
};

// All records are invented. They never enter the real profiles, likes or blocks tables.
const baseSpecs: DemoSpec[] = [
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

const specs: DemoSpec[] = EXPERIMENT_CITIES.flatMap((city, cityIndex) => Array.from({length:8}, (_, slot) => {
  const gender: Gender = slot === 7 ? "nonbinary" : slot % 2 ? "woman" : "man";
  const variants = baseSpecs.filter(item => item.gender === gender);
  const index = cityIndex * 8 + slot;
  const base = variants[(cityIndex + slot) % variants.length];
  return { ...base, id: `demo-${String(index+1).padStart(3,"0")}`, name:base.name.replace(/^样例·/,""), city, gender,
    age:[24,25,28,29,31,32,34,27][slot] + (cityIndex >= 9 ? cityIndex - 7 : 0),
    height:gender === "man" ? [174,178,182,186][slot/2] : gender === "woman" ? [162,166,169][Math.floor(slot/2)] : 172,
    seeking:index % 3 === 0 && gender !== "nonbinary" ? gender === "man" ? "woman" : "man" : "any",
    minAge:index % 4 === 0 ? 22 : 18, maxAge:index % 4 === 0 ? 42 : 80, preferredCity:index % 5 === 0 ? city : "" };
}));

function demoDepth(index: number): DepthProfile {
  const n = index % 12;
  const calm = n % 3 !== 1;
  const independent = n % 4 === 0 || n === 7;
  const practical = n % 3 === 2;
  const meta = (summary: string) => ({ status: "answered" as const, summary, answer: summary });
  const result: DepthProfile = { version: 1, topics: {
    values: { ...meta(independent ? "重视坦诚、独立，也希望共同成长。" : "重视平等、稳定和家人，也愿意探索新体验。"), priorities: independent ? ["honesty","independence","growth"] : ["equality","stability","family","exploration"] },
    conflict: { ...meta(calm ? "希望先冷静，再认真倾听并落实行动，也接受先写下想法。" : "希望尽早聊清楚，也接受约定时间冷静后再谈。"), approach: calm ? "cooldown_then_talk" : "talk_now", accepts: calm ? ["cooldown_then_talk","write_then_talk"] : ["talk_now","cooldown_then_talk"], repairNeeds: ["listening","practical_help"] },
    support: { ...meta(practical ? "需要实际帮助和安慰，愿意提供倾听与实际帮助。" : "低落时需要倾听和陪伴，愿意倾听、陪伴，也给彼此空间。"), needs: practical ? ["practical_help","reassurance"] : ["listening","companionship"], offers: practical ? ["listening","practical_help"] : ["listening","companionship","space"] },
    rhythm: { ...meta(independent ? "联系可以灵活安排，也接受每日简短沟通，希望保留较多独处时间。" : "喜欢每天联系，共同时间和独处保持平衡，也接受灵活安排。"), contact: independent ? "flexible" : "daily", acceptsContact: ["daily","flexible"], time: independent ? "independent" : "balanced", acceptsTime: independent ? ["independent","balanced"] : ["balanced","frequent"] },
    future: { ...meta(n === 3 ? "希望先了解彼此，暂不考虑婚姻或孩子，居住安排可讨论。" : n === 1 ? "期待长期关系，想结婚和有孩子，可以讨论迁居。" : "期待长期关系，婚育保持开放，迁居愿意讨论。"), goal: n === 3 ? "exploring" : "long_term", acceptsGoals: n === 3 ? ["exploring"] : ["long_term","exploring"], marriage: n === 3 ? "not_want" : n === 1 ? "want" : "open", children: n === 3 ? "not_want" : n === 1 ? "want" : "open", relocation: "discuss" },
    boundaries: { ...meta(independent ? "重视独立隐私，慢慢了解也接受自然推进，消费各自管理也可灵活商量。" : "重视独立隐私，自然推进关系，共同消费灵活商量。"), privacy: "independent", acceptsPrivacy: ["independent"], pace: independent ? "slow" : "balanced", acceptsPace: ["slow","balanced"], money: independent ? "separate" : "flexible", acceptsMoney: ["separate","flexible"] },
  } };
  if (n % 4 === 3) result.topics.conflict = { ...meta("希望先写下想法，再约时间认真沟通，需要倾听和安慰。"), approach:"write_then_talk", accepts:["write_then_talk","cooldown_then_talk"], repairNeeds:["listening","reassurance"] };
  if (n % 3 === 1) result.topics.rhythm = { ...meta("希望每周认真联系几次，也接受每天沟通，共同时间与独处平衡。"), contact:"several_per_week", acceptsContact:["several_per_week","daily"], time:"balanced", acceptsTime:["balanced","independent"] };
  if (n >= 6) result.topics.future = { ...meta("希望先了解彼此，对婚姻保持开放，不想要孩子，居住安排可以协商。"), goal:"exploring", acceptsGoals:["exploring","companionship"], marriage:"open", children:"not_want", relocation:"discuss" };
  if (!independent) result.topics.boundaries = { ...meta("隐私愿意协商，关系自然推进，消费灵活分担。"), privacy:"discuss", acceptsPrivacy:["independent","shared","discuss"], pace:"balanced", acceptsPace:["slow","balanced"], money:"flexible", acceptsMoney:["separate","flexible"] };
  if (index > 0 && index % 11 === 0) delete result.topics.future;
  if (index > 0 && index % 13 === 0) delete result.topics.boundaries;
  return result;
}

export const demoRows: ProfileRow[] = specs.map((spec, index) => ({
  profile_id: spec.id, user_id: `synthetic:${spec.id}`, name: spec.name,
  gender: spec.gender, seeking: spec.seeking ?? "any", age: spec.age, min_age: spec.minAge ?? 18, max_age: spec.maxAge ?? 80,
  city: spec.city, preferred_city: spec.preferredCity ?? "", height_cm: spec.height,
  preferred_height_min: null, preferred_height_max: null, body_type: "", preferred_body_type: "",
  school: "", mbti: "", zodiac: "", preferred_zodiac: "",
  interests_json: JSON.stringify(spec.interests), about: spec.about, partner_note: spec.partnerNote,
  contact_kind: "other", contact_value: "", contact_share: 0, visible: 1,
  adult_confirmed_at: "synthetic", pool_consented_at: null,
  created_at: "synthetic", updated_at: "synthetic",
  matching_json: JSON.stringify(matchingDocument({...blankProfile,name:spec.name,gender:spec.gender,seeking:spec.seeking ?? "any",age:spec.age,minAge:spec.minAge ?? 18,maxAge:spec.maxAge ?? 80,city:spec.city,preferredCity:spec.preferredCity ?? "",heightCm:spec.height,interests:spec.interests,about:spec.about,partnerNote:spec.partnerNote,depth:demoDepth(index)})),
}));
