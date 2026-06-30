import type { Metadata } from "next";
import { cookies } from "next/headers";
import { LegalDocument } from "@/app/legal-document";
import { defaultLocale, supportedLocales, type Locale } from "@/i18n/copy";

const metadataByLocale: Record<Locale, Metadata> = {
  "zh-CN": {
    title: "用户协议 | 优爱思",
    description: "优爱思用户协议，说明账号使用、课程服务、人工智能生成内容、知识产权和服务边界。",
  },
  "en-US": {
    title: "Terms of Use | UAIS",
    description:
      "UAIS terms of use for accounts, course services, AI-generated content, intellectual property, and service boundaries.",
  },
};

export async function generateMetadata(): Promise<Metadata> {
  const cookieStore = await cookies();
  return metadataByLocale[getSupportedLocale(cookieStore.get("uais-locale")?.value)];
}

const termsSectionsZh = [
  {
    title: "定义与适用范围",
    paragraphs: [
      "本协议适用于您访问、注册、登录或使用优爱思（大学人工智能系统 / 大学自适应交互系统）提供的教学网站、课程广场、学习工作区、人工智能协作聊天、教师管理空间、导出工具以及后续新增的相关服务。",
      "“用户”包括教师、学生、课程助教、受邀访客以及由学校或课程负责人授权的其他使用者。“课程内容”包括教师上传、编辑、生成或展示的文字、图片、课件、练习、反馈、学习记录和课堂活动材料。“人工智能生成内容”指系统根据用户输入、课程上下文或学习记录由人工智能模型辅助生成的回答、建议、摘要、脚本、评语或其他材料。",
    ],
  },
  {
    title: "账号、权限与使用边界",
    paragraphs: [
      "您应使用真实、合法、被授权的身份访问优爱思。教师账号、学生账号、演示账号和受邀访问链接仅可由被授权人员使用，不得出售、出租、共享给无关第三方，也不得绕过课程、班级、角色或组织权限边界。",
      "如果您发现账号被盗用、异常登录、权限错误或课程数据暴露，应立即通知课程负责人或平台管理员。因您主动泄露账号、弱密码、共享设备未退出登录或违规转让权限导致的后果，由您在法律允许范围内承担相应责任。",
      "优爱思可以根据教学安排、学校要求、安全事件或系统维护需要调整账号权限、暂停异常会话、要求重新认证，或限制高风险操作，例如导出、批量下载、人工智能调用和教师管理操作。",
    ],
  },
  {
    title: "课程服务与学习行为",
    paragraphs: [
      "优爱思旨在支持大学课程展示、学习进度管理、人机协作讨论、教师教学管理和课程材料播放。平台不替代教师的课程设计、学业评价、学校正式教务系统或线下教学管理决定。",
      "学生应独立完成课程要求，合理使用人工智能辅助解释、讨论和练习反馈，不得将人工智能输出冒充为完全由本人完成的作业、考试答案、论文或其他需独立完成的成果。教师可根据课程规则要求披露人工智能使用情况。",
      "教师应确认课程材料、评分规则、学习活动和导出内容适合其教学情境，并在正式使用前审阅关键材料。平台提供的学习进度、参与度和人工智能分析线索仅作为教学参考，不应作为唯一评价依据。",
    ],
  },
  {
    title: "人工智能生成内容与教学责任",
    paragraphs: [
      "人工智能可能产生不完整、不准确、过时、带有偏差或不适合特定教学情境的内容。您在采纳人工智能解释、评分建议、研究建议、代码、数学推导、写作反馈或课堂活动方案前，应进行人工核验。",
      "优爱思会努力通过提示词、上下文约束、权限控制和安全策略提升人工智能输出质量，但不承诺人工智能内容始终正确、可用或适合所有课程。涉及学术诚信、医疗、法律、财务、安全、就业或重大人生决策的信息，应咨询具备相应资格的专业人士。",
      "教师在课堂或课程管理中使用人工智能生成内容时，应保留必要的人类判断，向学生说明适用范围，并避免把模型输出作为未经审阅的正式评价、处分或身份判断依据。",
    ],
  },
  {
    title: "知识产权与内容许可",
    paragraphs: [
      "您保留对自己合法拥有的课程材料、作业、讨论内容、反馈和上传文件的权利。您授予优爱思在提供、维护、展示、备份、处理、转码、导出和改进相关课程服务所必需范围内使用这些内容的许可。",
      "您不得上传、展示、复制或分发未获授权的教材、论文、图片、音视频、软件、数据集、考试题库、学生作品或其他受保护内容。若课程确需使用第三方材料，您应确保拥有适当授权、引用或合理使用依据。",
      "优爱思的界面设计、代码、系统流程、品牌标识、文档结构和平台生成的模板材料，除另有说明外，由平台或相应权利人享有权利。未经许可，您不得反向工程、复制平台核心代码、移除权利标识或将平台作为竞品服务的训练、抓取或复制对象。",
    ],
  },
  {
    title: "用户行为规范",
    paragraphs: [
      "您不得利用优爱思发布违法、侵权、歧视、骚扰、仇恨、暴力、色情、欺诈、恶意代码、垃圾信息或干扰教学秩序的内容，不得攻击、扫描、压测、绕过认证、批量抓取、干扰服务，或尝试访问自己无权访问的数据。",
      "您不得要求人工智能生成用于作弊、伪造身份、规避学校纪律、盗取凭证、攻击系统、侵犯隐私或其他违法违规目的的内容。发现相关行为时，优爱思可采取限制账号、删除内容、保留证据、通知课程负责人或依法配合主管机关等措施。",
    ],
  },
  {
    title: "数据、记录与系统安全",
    paragraphs: [
      "为支持教学运行，优爱思可能记录登录状态、课程访问、学习进度、课堂互动、人工智能对话、导出请求、错误日志和安全审计信息。相关处理以提供服务、维护安全、满足课程管理和改进体验为目的，并受隐私政策约束。",
      "您应避免在聊天、作业、课件或导出内容中提交无关的敏感个人信息、真实身份证件、银行资料、健康诊断、家庭隐私、未授权学生数据或平台明确禁止提交的信息。",
      "平台会采取合理的技术和管理措施保护数据，但互联网服务无法保证绝对安全。因不可抗力、第三方基础设施故障、用户设备受损、凭证泄露或超出合理控制范围的事件导致的服务中断或数据风险，优爱思将按适用规则及时处理和通知。",
    ],
  },
  {
    title: "费用、试用与服务可用性",
    paragraphs: [
      "当前模板可能包含演示账号、试用能力、模拟数据或待接入的人工智能、存储、导出服务。演示环境用于产品体验、教学样例和功能验证，不代表正式商用服务的全部可用性、容量、响应速度或持续开放承诺。",
      "如果未来提供付费服务、机构订阅、增值人工智能调用、导出额度或外部存储能力，相关价格、额度、结算、退款和服务等级将以单独页面、订单、合同或学校采购文件为准。",
    ],
  },
  {
    title: "服务变更、暂停与终止",
    paragraphs: [
      "优爱思可根据产品迭代、课程需求、安全维护、法律要求或第三方服务变更，对功能、界面、模型、数据结构、访问方式和服务范围进行调整。重大变更将尽可能通过页面提示、管理员通知或课程渠道说明。",
      "若用户违反本协议、侵犯他人权益、危害系统安全、长期不活跃、授权关系终止或课程结束，优爱思可在合理范围内暂停、限制或终止相关账号和服务，并根据课程管理需要保留、归档或删除相关数据。",
    ],
  },
  {
    title: "免责声明与责任限制",
    paragraphs: [
      "在法律允许范围内，优爱思按现状和可用状态提供服务，不对服务完全无错误、不中断、永远兼容所有设备、满足所有个性化需求或人工智能输出完全准确作出保证。",
      "因用户违反协议、错误配置、未经授权上传内容、过度依赖人工智能输出、未审阅导出材料、第三方服务故障、网络问题或不可抗力导致的损失，优爱思将在法律允许范围内限制责任。任何平台责任均不排除法律不得排除的强制性责任。",
    ],
  },
  {
    title: "条款更新与争议处理",
    paragraphs: [
      "优爱思可能不时更新本协议。更新后的条款会在本页面显示新的生效日期。若变更显著影响用户权利义务，平台会尽合理努力通过显著提示或课程管理渠道通知。",
      "您继续使用服务即表示接受更新后的条款；若不同意更新，应停止使用相关服务并联系课程负责人处理课程数据、账号和学习安排。争议应优先通过友好沟通、课程或机构管理渠道解决；无法解决的，按适用法律和双方另行约定处理。",
    ],
  },
  {
    title: "联系我们",
    paragraphs: [
      "如您对本协议、账号权限、课程内容、人工智能使用边界或服务安全有疑问，请联系您的课程负责人、学校指定管理员或优爱思项目维护人员。为了保护隐私，请不要在非安全渠道提交密码、密钥或完整身份证件信息。",
    ],
  },
] as const;

const termsSectionsEn = [
  {
    title: "Definitions and Scope",
    paragraphs: [
      "These Terms apply when you access, sign in to, or use UAIS, including the course plaza, learner workspace, human-AI chatroom, teacher workspace, export tools, and related teaching services that may be added later.",
      "“User” means teachers, students, teaching assistants, invited guests, and other people authorized by a course owner or institution. “Course content” includes text, images, slides, exercises, feedback, learning records, and classroom activity materials. “AI-generated content” means responses, suggestions, summaries, scripts, comments, or other materials produced with model assistance.",
    ],
  },
  {
    title: "Accounts, Permissions, and Boundaries",
    paragraphs: [
      "You must use UAIS with a real, lawful, and authorized identity. Teacher accounts, student accounts, demo accounts, and invitation links may only be used by authorized people and must not be sold, rented, shared with unrelated third parties, or used to bypass course, class, role, or organization boundaries.",
      "If you discover account misuse, abnormal login activity, incorrect permissions, or exposure of course data, notify the course owner or platform administrator promptly. To the extent permitted by law, you are responsible for consequences caused by voluntarily disclosing credentials, using weak passwords, failing to sign out on shared devices, or transferring access without authorization.",
      "UAIS may adjust permissions, suspend abnormal sessions, require re-authentication, or limit high-risk actions such as exporting, bulk downloading, AI calls, and teacher-management operations when needed for teaching arrangements, security, institutional requirements, or maintenance.",
    ],
  },
  {
    title: "Course Services and Learning Conduct",
    paragraphs: [
      "UAIS is designed to support university course presentation, learning-progress management, human-AI discussion, teacher operations, and course-material playback. It does not replace teacher judgment, official academic administration systems, or formal offline teaching decisions.",
      "Students should complete required work independently and use AI assistance responsibly for explanation, discussion, and practice feedback. AI output must not be passed off as wholly self-authored work where independent completion is required, including assignments, exams, papers, or assessed submissions.",
      "Teachers should review course materials, grading rules, learning activities, and exported materials before formal use. Learning progress, participation signals, and AI analysis are teaching references and should not be used as the sole basis for academic evaluation.",
    ],
  },
  {
    title: "AI-Generated Content and Teaching Responsibility",
    paragraphs: [
      "AI may produce incomplete, inaccurate, outdated, biased, or context-inappropriate content. You should verify AI explanations, grading suggestions, research advice, code, mathematical reasoning, writing feedback, and classroom activity plans before relying on them.",
      "UAIS works to improve output quality through prompts, contextual constraints, permission controls, and safety measures, but it does not guarantee that AI content is always correct, available, or suitable for every course. For academic-integrity, medical, legal, financial, safety, employment, or other high-stakes matters, consult qualified professionals.",
      "When teachers use AI-generated content in class or course management, they should preserve human judgment, explain the applicable scope to students, and avoid treating model output as an unreviewed basis for official evaluation, discipline, or identity decisions.",
    ],
  },
  {
    title: "Intellectual Property and Content License",
    paragraphs: [
      "You retain rights in course materials, assignments, discussions, feedback, and uploaded files that you lawfully own. You grant UAIS the limited permission needed to provide, maintain, display, back up, process, convert, export, and improve the relevant course services.",
      "You must not upload, display, copy, or distribute textbooks, papers, images, audio, video, software, datasets, exam banks, student work, or other protected materials without authorization. If third-party materials are needed for a course, you are responsible for ensuring an appropriate license, citation, or lawful basis.",
      "UAIS interface design, code, system flows, brand assets, documentation structures, and platform templates are owned by UAIS or the relevant rightsholders unless otherwise stated. You may not reverse engineer, copy core code, remove rights notices, or use the platform to scrape or train competing services.",
    ],
  },
  {
    title: "User Conduct",
    paragraphs: [
      "You may not use UAIS to publish unlawful, infringing, discriminatory, harassing, hateful, violent, sexual, fraudulent, malicious, spam-like, or classroom-disruptive content. You may not attack, scan, stress test, bypass authentication, scrape at scale, interfere with service, or access data that you are not authorized to access.",
      "You may not ask AI systems to generate content for cheating, identity forgery, disciplinary evasion, credential theft, system attacks, privacy invasion, or other unlawful or improper purposes. UAIS may restrict accounts, remove content, preserve evidence, notify course owners, or cooperate with lawful authorities when needed.",
    ],
  },
  {
    title: "Data, Records, and System Security",
    paragraphs: [
      "To support teaching operations, UAIS may record login state, course access, learning progress, classroom interactions, AI conversations, export requests, error logs, and security-audit information. Such processing is governed by the Privacy Policy and is used to provide services, maintain security, support course management, and improve the experience.",
      "Avoid submitting unnecessary sensitive personal information, identity documents, bank details, health diagnoses, family privacy, unauthorized student data, or prohibited information in chats, assignments, slides, or exports.",
      "UAIS takes reasonable technical and organizational measures to protect data, but no internet service can be absolutely secure. UAIS will address and notify relevant parties as required when service interruptions or data risks arise from events beyond reasonable control, third-party infrastructure failures, compromised user devices, or leaked credentials.",
    ],
  },
  {
    title: "Fees, Trials, and Service Availability",
    paragraphs: [
      "This template may include demo accounts, trial capabilities, mocked data, or AI, storage, and export services that are still pending connection. Demo environments are for product experience, teaching examples, and feature validation; they do not represent a guarantee of all formal commercial features, capacity, response speed, or continued availability.",
      "If paid services, institutional subscriptions, extra AI usage, export quotas, or external storage are offered later, pricing, quota, billing, refunds, and service levels will be governed by separate pages, orders, contracts, or institutional procurement documents.",
    ],
  },
  {
    title: "Service Changes, Suspension, and Termination",
    paragraphs: [
      "UAIS may adjust features, interfaces, models, data structures, access methods, and service scope due to product iteration, course needs, security maintenance, legal requirements, or third-party service changes. Material changes will be explained through page notices, administrator notifications, or course channels where practical.",
      "If a user violates these Terms, infringes rights, endangers system security, remains inactive for a long period, loses authorization, or reaches the end of a course, UAIS may suspend, limit, or terminate the related account and service, and may retain, archive, or delete data as needed for course management.",
    ],
  },
  {
    title: "Disclaimers and Limitation of Liability",
    paragraphs: [
      "To the extent permitted by law, UAIS is provided on an as-is and as-available basis. UAIS does not guarantee that the service will be error-free, uninterrupted, permanently compatible with every device, tailored to every individual need, or that AI output will always be accurate.",
      "UAIS limits liability to the extent permitted by law for losses caused by user violations, misconfiguration, unauthorized uploads, overreliance on AI output, unreviewed exports, third-party service failures, network issues, or force majeure. Nothing in these Terms excludes liabilities that cannot lawfully be excluded.",
    ],
  },
  {
    title: "Updates and Dispute Handling",
    paragraphs: [
      "UAIS may update these Terms from time to time. The updated page will show a new effective date. Where changes materially affect user rights or obligations, UAIS will make reasonable efforts to notify users through prominent page notices or course-management channels.",
      "Your continued use of the service means you accept the updated Terms. If you disagree, stop using the service and contact the course owner to handle course data, account access, and learning arrangements. Disputes should first be handled through good-faith communication and course or institutional management channels.",
    ],
  },
  {
    title: "Contact",
    paragraphs: [
      "If you have questions about these Terms, account permissions, course content, AI-use boundaries, or service security, contact your course owner, institutional administrator, or UAIS project maintainer. To protect privacy, do not send passwords, keys, or full identity-document details through unsecured channels.",
    ],
  },
] as const;

export default function TermsPage() {
  return (
    <LegalDocument
      updatedAt="2026-06-22"
      content={{
        "zh-CN": {
          title: "用户协议",
          eyebrow: "优爱思法务",
          effectiveDateLabel: "生效日期：",
          effectiveDateText: "2026年6月22日",
          backToLogin: "返回登录",
          regionLabel: "用户协议详细条款",
          intro:
            "欢迎使用优爱思。请在登录、访问课程或使用人工智能辅助功能前仔细阅读本协议。本协议说明您与优爱思之间关于账号、课程服务、人工智能生成内容、知识产权、数据安全和服务边界的基本约定。",
          sections: termsSectionsZh,
        },
        "en-US": {
          title: "Terms of Use",
          eyebrow: "UAIS Legal",
          effectiveDateLabel: "Effective date:",
          effectiveDateText: "June 22, 2026",
          backToLogin: "Back to login",
          regionLabel: "Terms of Use details",
          intro:
            "Welcome to UAIS. Please read these Terms before signing in, accessing courses, or using AI-assisted features. These Terms explain the basic agreement between you and UAIS on accounts, course services, AI-generated content, intellectual property, data security, and service boundaries.",
          sections: termsSectionsEn,
        },
      }}
    />
  );
}

function getSupportedLocale(locale: string | undefined): Locale {
  return supportedLocales.includes(locale as Locale) ? (locale as Locale) : defaultLocale;
}
