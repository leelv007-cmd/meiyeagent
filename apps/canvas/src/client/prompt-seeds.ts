export const CANVAS_PROMPT_SEED_MANIFEST = {
	a3EvidenceStatus: "pending",
	catalogVersion: "2026-07-14",
	owner: "product",
	source: "docs/design/seed-visual-pack-prompts-2026-07-14.md",
} as const;

export interface CanvasPromptSeed {
	a3EvidenceStatus: typeof CANVAS_PROMPT_SEED_MANIFEST.a3EvidenceStatus;
	catalogVersion: typeof CANVAS_PROMPT_SEED_MANIFEST.catalogVersion;
	fileName: string;
	group: string;
	id: string;
	operation: "image.generate";
	owner: typeof CANVAS_PROMPT_SEED_MANIFEST.owner;
	prompt: string;
	ratio: string;
	source: typeof CANVAS_PROMPT_SEED_MANIFEST.source;
}

export const CANVAS_PROMPT_SEEDS: CanvasPromptSeed[] = [
	seed(
		"A1",
		"场景货架",
		"scene-lead-gen-nail",
		"16:10",
		"美甲店橱窗视角，一只刚做好的奶油白猫眼美甲手部特写搭在大理石台面，背景虚化的温暖门店灯光，画面通透明亮，商业摄影，浅景深，画面下方光线渐暗",
	),
	seed(
		"A2",
		"场景货架",
		"scene-seeding-nail",
		"16:10",
		"俯拍平铺：一只展示渐变粉猫眼美甲的手轻握一杯拿铁，旁边散落干花与杂志，小红书生活方式风格，柔和窗光，奶油色调，画面下方留暗",
	),
	seed(
		"A3",
		"场景货架",
		"scene-promo-nail",
		"16:10",
		"美甲样品色板墙特写，数十枚甲片呈扇形排列，前景一枚镭射猫眼甲片被指尖拿起，高级感影棚光，景深虚化，下方渐暗",
	),
	seed(
		"A4",
		"场景货架",
		"scene-retention-nail",
		"16:10",
		"顾客与美甲师隔桌相对的手部近景，美甲师正为顾客修型，温馨门店氛围，逆光柔和，传递熟客回访的亲切感，下方渐暗",
	),
	seed(
		"A5",
		"场景货架",
		"scene-lead-gen-hair",
		"16:10",
		"美发沙龙内景，发型师手持吹风机为长卷发顾客定型，发丝在暖光中飞扬，电影感侧逆光，背景虚化，下方渐暗",
	),
	seed(
		"A6",
		"场景货架",
		"scene-seeding-hair",
		"16:10",
		"奶茶色波浪卷发背影特写，发丝光泽细腻，米色极简背景，杂志级质感，柔光，下方渐暗",
	),
	seed(
		"A7",
		"场景货架",
		"scene-lead-gen-skin",
		"16:10",
		"皮肤管理室，美容师戴手套为躺卧顾客做面部护理，仪器蓝光点缀，洁净高级的诊所感，浅景深，下方渐暗",
	),
	seed(
		"A8",
		"场景货架",
		"scene-seeding-skin",
		"16:10",
		"素颜亚洲女性面部特写，水光肌质感，手指轻触脸颊，纯净白背景，护肤广告级打光，下方渐暗",
	),
	seed(
		"B1",
		"命名预设",
		"preset-before-after",
		"4:3",
		"左右对称双联画构图：左侧素甲手部、右侧同一角度做完猫眼美甲的手部，同一大理石背景同一光线，中间自然分界，商业对比摄影，无文字",
	),
	seed(
		"B2",
		"命名预设",
		"preset-package-flatlay",
		"4:3",
		"俯拍平铺：美甲套餐物料整齐排列——甲片色板、养护油、修型工具、一杯茶，米白桌布，秩序感构图，柔和顶光",
	),
	seed(
		"B3",
		"命名预设",
		"preset-price-card",
		"4:3",
		"门店前台一角，木质台面上立着一块空白的亚麻质感立牌（无字），旁边一瓶小雏菊与甲油胶瓶，浅景深，温暖门店光",
	),
	seed(
		"C1",
		"示例店素材",
		"store-cateye-texture",
		"1:1",
		"猫眼美甲极限微距：单枚甲面的磁吸光带纹理，深棕底色中一道流动的金色光束，光带随角度变化，微距镜头，锐利细节",
	),
	seed(
		"C2",
		"示例店素材",
		"store-natural-light",
		"1:1",
		"美甲店室内环境：靠窗双人操作台，午后自然光洒在米色桌面与绿植上，整洁温馨，空景无人，广角但不变形",
	),
	seed(
		"C3",
		"示例店素材",
		"store-artist-working",
		"1:1",
		"美甲师双手为顾客涂胶操作特写，握笔姿势专业，台灯暖光聚焦指尖，工作场景纪实感，浅景深",
	),
	seed(
		"C4",
		"示例店素材",
		"store-final-result",
		"1:1",
		"完成效果实拍：五指展开的透亮猫眼美甲，甲面光带清晰，手部姿态放松自然搭在深色丝绒布上，商业成片级",
	),
	seed(
		"D1",
		"示例内容封面",
		"store-content-cloudy-cateye",
		"3:4",
		"阴天窗边的手部特写，显白奶咖色猫眼美甲在柔和天光下依然透亮，冷调环境暖调手部的对比，小红书封面构图，上 1/3 留白",
	),
	seed(
		"D2",
		"示例内容封面",
		"store-content-lightband",
		"9:16",
		"竖幅：手指缓缓转动展示猫眼光带流动的瞬间感，深色背景金色光带，微距动感虚化边缘，视频封面构图，中央留白",
	),
	seed(
		"D3",
		"示例内容封面",
		"store-content-howtochoose",
		"3:4",
		"三只不同色系猫眼甲片（棕/灰/粉）被指尖呈扇形捏起对比，纯色背景，选择感构图，上方留白",
	),
	seed(
		"E1",
		"资产库种子",
		"asset-nail-milkwhite",
		"3:4",
		"奶白色圆头短甲手部成片，戒指点缀，米色针织衫袖口入镜，温柔风商业摄影",
	),
	seed(
		"E2",
		"资产库种子",
		"asset-nail-frenchtip",
		"3:4",
		"细边法式美甲特写，裸粉底白色甲尖，手持香槟杯，晚宴氛围虚化背景",
	),
	seed(
		"E3",
		"资产库种子",
		"asset-nail-chrome",
		"3:4",
		"镜面镀铬银色美甲，未来感，深灰背景硬光，时尚大片风",
	),
	seed(
		"E4",
		"资产库种子",
		"asset-nail-floral",
		"3:4",
		"手绘小雏菊贴花美甲，奶油底色，手部搭在草编包上，春日户外柔光",
	),
	seed(
		"E5",
		"资产库种子",
		"asset-nail-aurora",
		"3:4",
		"极光渐变甲（紫蓝粉），深色丝绒背景，甲面高光锐利，梦幻商业风",
	),
	seed(
		"E6",
		"资产库种子",
		"asset-nail-tortoise",
		"3:4",
		"焦糖玳瑁纹美甲，复古金戒指叠戴，咖啡馆木桌背景，秋日暖调",
	),
	seed(
		"E7",
		"资产库种子",
		"asset-hair-bob",
		"3:4",
		"齐下巴法式波波头侧面成片，深棕发色光泽感，米白背景，沙龙作品集风格",
	),
	seed(
		"E8",
		"资产库种子",
		"asset-hair-curl",
		"3:4",
		"蓬松羊毛卷长发正面微侧成片，奶茶色，暖调影棚光，发丝细节清晰",
	),
	seed(
		"E9",
		"资产库种子",
		"asset-skin-glow",
		"3:4",
		"护理后水光肌面部斜侧特写，闭眼放松表情，湿润高光质感，纯白背景",
	),
	seed(
		"E10",
		"资产库种子",
		"asset-skin-spa",
		"3:4",
		"敷面膜的顾客躺卧俯拍，毛巾包发，双手交叠胸前，spa 氛围暖光（画面干净无品牌）",
	),
	seed(
		"F1",
		"模板画廊",
		"template-store-visit",
		"3:4",
		"探店视角：推开美甲店玻璃门的第一人称视角，室内暖光与绿植，纵深构图，上 1/3 留白",
	),
	seed(
		"F2",
		"模板画廊",
		"template-tutorial",
		"3:4",
		"教程感俯拍：美甲工具在米色桌面一字排开，一只手正拿起其中一支笔刷，步骤感构图",
	),
	seed(
		"F3",
		"模板画廊",
		"template-before-after",
		"3:4",
		"同 B1 双联对比构图但更紧凑，适合小卡",
	),
	seed(
		"F4",
		"模板画廊",
		"template-checklist",
		"3:4",
		"平铺若干枚甲片呈网格整齐排列，颜色由浅到深渐变过渡，秩序感俯拍",
	),
	seed(
		"F5",
		"模板画廊",
		"template-qna",
		"3:4",
		"一只手托腮沉思、另一只手展示美甲的半身构图，疑问氛围，浅色背景大留白",
	),
	seed(
		"F6",
		"模板画廊",
		"template-event",
		"3:4",
		"节日氛围美甲平铺：甲片与礼物丝带、灯串散落，浅景深虚化光斑，喜庆但克制",
	),
	seed(
		"G1",
		"模型预览",
		"model-copy-planning",
		"16:10",
		"抽象概念图：米色桌面上散开的手写笔记本、钢笔与便签呈思维导图状排布，顶光俯拍，知性安静氛围",
	),
	seed(
		"G2",
		"模型预览",
		"model-image-beauty",
		"16:10",
		'抽象概念图：一张美甲照片从半透明玻璃质感的画框中"显影"而出的超现实构图，柔光，创意广告风',
	),
	seed(
		"G3",
		"模型预览",
		"model-video-storyboard",
		"16:10",
		"抽象概念图：桌面上按顺序排列的宝丽来照片组成分镜序列，最后一张微微翘起，电影感侧光",
	),
	seed(
		"H1",
		"视频海报",
		"video-poster-vertical",
		"9:16",
		"竖幅门店项目展示封面：美甲师双手展示成品甲片板，面向镜头构图，门店灯箱虚化背景，短视频封面感，中央偏上留白",
	),
	seed(
		"H2",
		"视频海报",
		"video-poster-wide",
		"16:9",
		"横幅：美甲操作台全景，双手操作中，环境光层次丰富，纪录片定场镜头感",
	),
	seed(
		"I1",
		"开场氛围",
		"hero-ambient",
		"21:9",
		"极暗调抽象背景：深墨绿色底上一道若隐若现的金色猫眼光带弧线划过，大面积留黑，细腻噪点质感，奢侈品官网背景风格",
	),
];

function seed(
	id: string,
	group: string,
	fileName: string,
	ratio: string,
	prompt: string,
): CanvasPromptSeed {
	return {
		...CANVAS_PROMPT_SEED_MANIFEST,
		fileName,
		group,
		id,
		operation: "image.generate",
		prompt,
		ratio,
	};
}
