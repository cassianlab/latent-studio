export const QUICK_PROMPT_CATEGORIES = [
  { id: 'style', label: '风格' },
  { id: 'composition', label: '构图' },
  { id: 'camera', label: '镜头' },
  { id: 'lighting', label: '光线' },
  { id: 'texture', label: '质感' },
  { id: 'template', label: '模板' },
] as const

export type QuickPromptCategory = typeof QUICK_PROMPT_CATEGORIES[number]['id']

export interface QuickPrompt {
  id: string
  title: string
  prompt: string
  category: QuickPromptCategory
  description?: string
  sourcePromptId?: string
  updatedAt: string
}

export interface QuickPromptInput {
  id?: string
  title: string
  prompt: string
  category: QuickPromptCategory
  description?: string
  sourcePromptId?: string
}

interface QuickPromptFile {
  version: 1
  items: QuickPrompt[]
}

export const QUICK_PROMPT_STORAGE_KEY = 'latent-studio:quick-prompts:v1'
const categoryIds = new Set<string>(QUICK_PROMPT_CATEGORIES.map((item) => item.id))

const defaults: Array<Omit<QuickPrompt, 'updatedAt'>> = [
  { id: 'style-cinematic-realism', title: '电影写实', category: 'style', prompt: '电影剧照式写实风格，自然色彩分级，细腻肤质与材质细节，光影服务于叙事，避免过度锐化' },
  { id: 'style-editorial-photo', title: '编辑摄影', category: 'style', prompt: '高端杂志编辑摄影，克制的色彩系统，明确的视觉主题，真实细节与精准造型，画面干净但不空洞' },
  { id: 'style-ink-contemporary', title: '当代水墨', category: 'style', prompt: '当代中国水墨表达，留白控制节奏，墨色有浓淡干湿层次，主体边缘虚实相生，保留手工纸张纤维感' },
  { id: 'style-retro-film', title: '纪实胶片', category: 'style', prompt: '纪实胶片摄影，柔和颗粒与自然高光滚降，略带时代感的色偏，不追求过度完美，保留现场气息' },
  { id: 'style-premium-3d', title: '高级 3D', category: 'style', prompt: '高级商业 3D 视觉，准确的材质物理响应，柔和全局照明，形体边缘干净，控制反射强度，避免廉价塑料感' },

  { id: 'composition-environmental-wide', title: '环境大远景', category: 'composition', prompt: '环境大远景，主体占画面约五分之一，使用前景、中景、背景建立空间层次，环境信息参与叙事' },
  { id: 'composition-negative-space', title: '留白主体', category: 'composition', prompt: '单一主体偏离中心布置，保留大面积有意义的负空间，视线方向与留白一致，画面安静且有张力' },
  { id: 'composition-frame-within-frame', title: '框中框', category: 'composition', prompt: '利用门窗、建筑缺口或前景遮挡形成框中框，视线自然汇聚到主体，同时增加窥视感和空间深度' },
  { id: 'composition-symmetry', title: '中轴对称', category: 'composition', prompt: '严谨的中轴对称构图，主体位于视觉中心，左右结构秩序明确，通过局部小变化避免画面僵硬' },
  { id: 'composition-diagonal-motion', title: '对角线动势', category: 'composition', prompt: '利用道路、肢体或光影建立对角线动势，主体朝画面内部运动，前后景关系清晰，增强速度与方向感' },

  { id: 'camera-24mm-wide', title: '24mm 广角', category: 'camera', prompt: '24mm 广角镜头，机位靠近主体，前景张力明显，环境尺度感强，保持垂直线稳定，避免无意义的边缘畸变' },
  { id: 'camera-50mm-natural', title: '50mm 标准', category: 'camera', prompt: '50mm 标准镜头视角，透视关系自然，主体与环境比例均衡，中等景深，适合真实人物与日常叙事' },
  { id: 'camera-85mm-portrait', title: '85mm 人像', category: 'camera', prompt: '85mm 人像镜头，中近景取景，面部比例自然，背景适度压缩与柔化，眼神清晰，保留真实皮肤细节' },
  { id: 'camera-overhead', title: '垂直俯拍', category: 'camera', prompt: '镜头与地面完全垂直的俯拍视角，强调物件排列、形状与色块关系，边缘保持整齐，画面重心稳定' },
  { id: 'camera-handheld-follow', title: '手持跟拍', category: 'camera', prompt: '纪实式手持跟拍机位，轻微运动模糊体现现场速度，主体保持可识别，取景略带呼吸感，不做夸张抖动' },

  { id: 'lighting-window-soft', title: '窗光侧照', category: 'lighting', prompt: '大面积窗光从侧前方柔和照入，明暗过渡自然，背光侧保留细节，环境反射光很弱，形成安静真实的空间感' },
  { id: 'lighting-rembrandt', title: '伦勃朗光', category: 'lighting', prompt: '单一柔质主光从人物侧上方入射，背光面脸颊保留小型三角亮区，暗部有层次，突出面部结构和情绪' },
  { id: 'lighting-overcast', title: '阴天散射', category: 'lighting', prompt: '阴天大面积散射光，反差较低但不灰暗，颜色还原准确，材质细节均匀可见，适合纪实与商业产品表达' },
  { id: 'lighting-neon-rain', title: '雨夜霓虹', category: 'lighting', prompt: '多色霓虹作为环境光，潮湿地面产生方向明确的反射，主体轮廓与背景分离，控制饱和度，避免红蓝颜色污染' },
  { id: 'lighting-sunset-backlight', title: '日落逆光', category: 'lighting', prompt: '低角度日落逆光，主体边缘出现温暖轮廓光，前景用环境反光保留细节，高光柔和滚降，不产生过度光晕' },

  { id: 'texture-natural-skin', title: '自然肤质', category: 'texture', prompt: '保留真实皮肤纹理、毛孔和细微瑕疵，明暗面过渡细腻，不过度磨皮，不塑料化，眼周与唇部细节自然' },
  { id: 'texture-brushed-metal', title: '拉丝金属', category: 'texture', prompt: '细密单向拉丝金属材质，反射随表面曲率连续变化，高光边缘干净，保留轻微使用痕迹，避免镜面塑料感' },
  { id: 'texture-paper-print', title: '纸张印刷', category: 'texture', prompt: '可见的天然纸张纤维和轻微吸墨边缘，套色略有手工印刷偏差，颜料遮盖关系真实，整体保持清晰可读' },
  { id: 'texture-soft-fabric', title: '织物细节', category: 'texture', prompt: '织物经纬、缝线和褪皱结构清晰，柔软度通过受力形变表现，绒面反光克制，颜色在明暗面保持一致' },
  { id: 'texture-weathered-surface', title: '风化表面', category: 'texture', prompt: '真实的风化、掉漆与细小划痕，损耗集中在边缘和高频接触区，污渍符合重力方向，不使用随机噪点代替材质' },

  { id: 'template-character-portrait', title: '角色定妆照', category: 'template', description: '稳定人物外观与服装设定', prompt: '为【角色身份】制作定妆照：【年龄与外貌特征】，穿着【服装与材质】，表情为【核心情绪】。中近景、85mm 人像镜头、简洁中性背景，同时清楚呈现面部、发型、服装剪裁和关键配饰，保留真实肤质。' },
  { id: 'template-cinematic-scene', title: '电影叙事镜头', category: 'template', description: '用一个镜头交代人物、环境与冲突', prompt: '【主体】正在【动作】，位于【场景与时间】，环境中的【关键线索】暗示【冲突或故事背景】。使用【景别】、【镜头焦段】和【机位】，【主光方向】建立情绪，前中后景层次清晰，画面像真实电影剧照。' },
  { id: 'template-product-hero', title: '商品主视觉', category: 'template', description: '可直接用于商品海报的主画面', prompt: '以【产品】为唯一视觉主体，准确保留【品牌识别特征】。产品置于【台面或环境】，周围使用【与卖点相关的元素】建立使用情境。三分之四视角，材质反射准确，主光勾勒轮廓，保留【文案区域】留白，不生成虚假品牌文字。' },
  { id: 'template-landscape-atmosphere', title: '风景氛围图', category: 'template', description: '风景、旅行和场景概念图', prompt: '【地貌或地点】在【季节与时间】的广阔风景，【前景元素】建立尺度，【中景主体】承载视觉重心，【远景】通过空气透视逐渐减弱。【天气】改变光线和地表状态，使用 24mm 广角但不夸张畸变，画面具有可到达的真实感。' },
  { id: 'template-storyboard-panel', title: '分镜关键帧', category: 'template', description: '按叙事任务制作可连续的单帧', prompt: '这是【场次名称】的第【镜头编号】个关键帧。保持【角色外观不变量】和【场景不变量】，本镜头表现【具体动作】与【情绪转折】。使用【景别】、【机位】、【视线方向】，光线承接上一镜，动作方向保持轴线连续，不在画面中生成分镜文字。' },
]

export function defaultQuickPrompts(): QuickPrompt[] {
  return defaults.map((item) => ({ ...item, updatedAt: '2026-09-15T00:00:00.000Z' }))
}

export function isQuickPrompt(value: unknown): value is QuickPrompt {
  if (!value || typeof value !== 'object') return false
  const item = value as Partial<QuickPrompt>
  return typeof item.id === 'string' && Boolean(item.id.trim())
    && typeof item.title === 'string' && Boolean(item.title.trim())
    && typeof item.prompt === 'string' && Boolean(item.prompt.trim())
    && typeof item.category === 'string' && categoryIds.has(item.category)
    && typeof item.updatedAt === 'string'
}

export function parseLegacyQuickPrompts(raw: string | null): QuickPrompt[] | undefined {
  try {
    if (!raw) return undefined
    const parsed = JSON.parse(raw) as Partial<QuickPromptFile>
    if (parsed.version !== 1 || !Array.isArray(parsed.items) || !parsed.items.every(isQuickPrompt)) return undefined
    return parsed.items.map((item) => ({ ...item }))
  } catch {
    return undefined
  }
}

export function validQuickPromptText(value: string, field: string, max: number): string {
  const result = value.trim()
  if (!result || result.length > max) throw new Error(`${field}无效`)
  return result
}

export function isQuickPromptCategory(value: unknown): value is QuickPromptCategory {
  return typeof value === 'string' && categoryIds.has(value)
}
